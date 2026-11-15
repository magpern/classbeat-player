-- ADR 0010, sections 1 to 6 and 9 (#481): instructors sign in with their classbeat account.
--
-- - accounts gain `kind` (instructor, unlinked; follower reserved) and, for an instructor, the
--   identity (classbeat_issuer, classbeat_subject): unique, required for an instructor, set by
--   auth_complete_classbeat or once by the operator's `admin account link`. Every existing
--   account becomes `unlinked`. The email is a nullable display column; it stays unique among
--   the accounts that are not instructors, because the email link still signs those in until
--   ADR 0010, section 7 closes it (its own issue narrows the index to `follower`).
-- - signup_allowlist entries bind to the first identity that uses them.
-- - Two closed tables: classbeat_sign_ins (one row per open flow, hashes only) and
--   classbeat_event_ids (made here, used by the events issue).
-- - Four new functions; auth_request_login and auth_complete_login replaced so that an email
--   never finds an instructor; auth_purge_expired replaced to purge the two new tables.
--
-- As in 0004: CREATE OR REPLACE keeps a function's owner and rights; SECURITY DEFINER and the
-- search_path are restated; a parameter is read once, by its qualified name, into a `v_`
-- variable. The numbers are constants here (ADR 0002, principle 7): a flow lives 10 minutes;
-- 20 starts per address and 10 re-authentication starts per session per 10 minutes; 30
-- callbacks per address per 10 minutes; 10 refused sign-ups per address an hour; the session
-- lifetimes and the cap of 20 sessions of 0004.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

ALTER TABLE player.accounts
  ADD COLUMN kind text NOT NULL DEFAULT 'unlinked'
    CHECK (kind IN ('instructor', 'unlinked', 'follower')),
  ADD COLUMN classbeat_issuer text CHECK (length(classbeat_issuer) BETWEEN 1 AND 255),
  ADD COLUMN classbeat_subject text CHECK (length(classbeat_subject) BETWEEN 1 AND 255),
  ADD CONSTRAINT accounts_classbeat_identity UNIQUE (classbeat_issuer, classbeat_subject),
  ADD CONSTRAINT accounts_instructor_identity CHECK (
    (classbeat_issuer IS NULL) = (classbeat_subject IS NULL)
    AND (kind = 'instructor') = (classbeat_issuer IS NOT NULL));
ALTER TABLE player.accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE player.accounts DROP CONSTRAINT accounts_email_key;
CREATE UNIQUE INDEX accounts_email_not_instructor ON player.accounts (email)
  WHERE kind <> 'instructor';

ALTER TABLE player.signup_allowlist
  ADD COLUMN bound_issuer text CHECK (length(bound_issuer) BETWEEN 1 AND 255),
  ADD COLUMN bound_subject text CHECK (length(bound_subject) BETWEEN 1 AND 255),
  ADD CONSTRAINT signup_allowlist_bound UNIQUE (bound_issuer, bound_subject),
  ADD CONSTRAINT signup_allowlist_bound_pair CHECK ((bound_issuer IS NULL) = (bound_subject IS NULL));

-- Closed: no grant and no policy for player_app. Nothing is kept in clear.
CREATE TABLE player.classbeat_sign_ins (
  binding_hash        bytea PRIMARY KEY CHECK (octet_length(binding_hash) = 32),
  state_hash          bytea NOT NULL CHECK (octet_length(state_hash) = 32),
  nonce_hash          bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
  purpose             text NOT NULL CHECK (purpose IN ('sign_in', 'reauth')),
  return_to           text CHECK (length(return_to) <= 64
                      AND return_to ~ '^(control|play)(\.[A-Za-z0-9-]{9,36})?$'),
  asking_session_hash bytea CHECK (octet_length(asking_session_hash) = 32),
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  CHECK ((purpose = 'reauth') = (asking_session_hash IS NOT NULL))
);

CREATE TABLE player.classbeat_event_ids (
  jti_hash   bytea PRIMARY KEY CHECK (octet_length(jti_hash) = 32),
  expires_at timestamptz NOT NULL
);

ALTER TABLE player.classbeat_sign_ins  ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.classbeat_sign_ins  FORCE ROW LEVEL SECURITY;
ALTER TABLE player.classbeat_event_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE player.classbeat_event_ids FORCE ROW LEVEL SECURITY;

-- ADR 0010, section 9: what player_auth gains. (DELETE on accounts comes with the events issue.)
GRANT SELECT, INSERT, UPDATE, DELETE ON player.classbeat_sign_ins  TO player_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON player.classbeat_event_ids TO player_auth;
GRANT UPDATE (email)                 ON player.accounts            TO player_auth;
GRANT UPDATE (bound_issuer, bound_subject) ON player.signup_allowlist TO player_auth;

-- ---------------------------------------------------------------------------------------------
-- The flow's start and its row (section 2, step 1)
-- ---------------------------------------------------------------------------------------------

-- Returns `started`, `limited` (429: no row) or `not_signed_in` (a re-authentication without a
-- live session). A start from a browser that held a binding drops that binding's row first.
CREATE FUNCTION player.auth_start_classbeat(
  binding_hash bytea, state_hash bytea, nonce_hash bytea, purpose text, return_to text,
  asking_session_hash bytea, held_binding_hash bytea, address_hash bytea)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_binding bytea := auth_start_classbeat.binding_hash;
  v_state   bytea := auth_start_classbeat.state_hash;
  v_nonce   bytea := auth_start_classbeat.nonce_hash;
  v_purpose text  := auth_start_classbeat.purpose;
  v_return  text  := auth_start_classbeat.return_to;
  v_asking  bytea := auth_start_classbeat.asking_session_hash;
  v_held    bytea := auth_start_classbeat.held_binding_hash;
  v_address bytea := auth_start_classbeat.address_hash;
BEGIN
  IF v_binding IS NULL OR octet_length(v_binding) <> 32
     OR v_state IS NULL OR octet_length(v_state) <> 32
     OR v_nonce IS NULL OR octet_length(v_nonce) <> 32
     OR v_purpose IS NULL OR v_purpose NOT IN ('sign_in', 'reauth')
     OR (v_asking IS NOT NULL AND octet_length(v_asking) <> 32)
     OR (v_purpose = 'reauth') <> (v_asking IS NOT NULL)
     OR (v_held IS NOT NULL AND octet_length(v_held) <> 32)
     OR v_address IS NULL OR octet_length(v_address) <> 32 THEN
    RAISE EXCEPTION 'auth_start_classbeat: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF player.rate_limit_hit(sha256(convert_to('classbeat.start:', 'UTF8') || v_address),
                           interval '10 minutes', 20) THEN
    RETURN 'limited';
  END IF;
  IF v_purpose = 'reauth' THEN
    -- The asking session must be live, as auth_enter_session finds one.
    IF NOT EXISTS (SELECT 1 FROM player.sessions s
                   WHERE s.token_hash = v_asking
                     AND s.last_used_at > now() - interval '14 days'
                     AND s.created_at > now() - interval '60 days') THEN
      RETURN 'not_signed_in';
    END IF;
    IF player.rate_limit_hit(sha256(convert_to('classbeat.reauth:', 'UTF8') || v_asking),
                             interval '10 minutes', 10) THEN
      RETURN 'limited';
    END IF;
  END IF;

  -- At most one flow open per browser.
  DELETE FROM player.classbeat_sign_ins c WHERE c.binding_hash = v_held;
  INSERT INTO player.classbeat_sign_ins
    (binding_hash, state_hash, nonce_hash, purpose, return_to, asking_session_hash, expires_at)
  VALUES (v_binding, v_state, v_nonce, v_purpose, v_return, v_asking,
          now() + interval '600 seconds');
  RETURN 'started';
END
$$;

-- Uses up the row of a callback, by the binding and the state together (section 2, step 2.1).
-- No row comes back for a callback over its limit (nothing is used up then), an unknown pair,
-- or a row older than 10 minutes (used up all the same).
CREATE FUNCTION player.auth_take_classbeat(
  binding_hash bytea, state_hash bytea, address_hash bytea)
RETURNS TABLE (purpose text, return_to text, nonce_hash bytea, asking_session_hash bytea,
               started_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_binding bytea := auth_take_classbeat.binding_hash;
  v_state   bytea := auth_take_classbeat.state_hash;
  v_address bytea := auth_take_classbeat.address_hash;
  v_purpose text;
  v_return  text;
  v_nonce   bytea;
  v_asking  bytea;
  v_created timestamptz;
  v_expires timestamptz;
BEGIN
  IF v_binding IS NULL OR octet_length(v_binding) <> 32
     OR v_state IS NULL OR octet_length(v_state) <> 32
     OR v_address IS NULL OR octet_length(v_address) <> 32 THEN
    RAISE EXCEPTION 'auth_take_classbeat: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Counted before the row is looked up (ADR 0010, section 9, "Limits").
  IF player.rate_limit_hit(sha256(convert_to('classbeat.callback:', 'UTF8') || v_address),
                           interval '10 minutes', 30) THEN
    RETURN;
  END IF;
  -- Single use: a second caller waits on the row and then finds none.
  DELETE FROM player.classbeat_sign_ins c
  WHERE c.binding_hash = v_binding AND c.state_hash = v_state
  RETURNING c.purpose, c.return_to, c.nonce_hash, c.asking_session_hash, c.created_at,
            c.expires_at
    INTO v_purpose, v_return, v_nonce, v_asking, v_created, v_expires;
  IF v_purpose IS NULL OR v_expires <= now() THEN
    RETURN;
  END IF;
  purpose := v_purpose;
  return_to := v_return;
  nonce_hash := v_nonce;
  asking_session_hash := v_asking;
  started_at := v_created;
  RETURN NEXT;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Sign-in and sign-up (section 4), re-authentication (section 5)
-- ---------------------------------------------------------------------------------------------

-- Called only after the backend has checked the ID token. Returns `signed_in` or `refused`.
CREATE FUNCTION player.auth_complete_classbeat(
  issuer text, subject text, email text, email_verified boolean, auth_time timestamptz,
  session_hash bytea, address_hash bytea, client player.client_info)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_issuer   text := auth_complete_classbeat.issuer;
  v_subject  text := auth_complete_classbeat.subject;
  v_email    text := CASE WHEN auth_complete_classbeat.email_verified IS TRUE
                          THEN lower(btrim(auth_complete_classbeat.email)) END;
  v_auth     timestamptz := auth_complete_classbeat.auth_time;
  v_session  bytea := auth_complete_classbeat.session_hash;
  v_address  bytea := auth_complete_classbeat.address_hash;
  v_client   player.client_info := auth_complete_classbeat.client;
  v_family   text := coalesce(left((v_client).family, 40), '');
  v_account  uuid;
  v_key      bytea;
  v_refused  integer;
  v_allowed  boolean := false;
  v_bound    integer := 0;
  v_made     integer := 0;
  v_session_id uuid;
  v_wait     text;
BEGIN
  IF v_issuer IS NULL OR length(v_issuer) NOT BETWEEN 1 AND 255
     OR v_subject IS NULL OR length(v_subject) NOT BETWEEN 1 AND 255
     OR v_auth IS NULL OR v_auth > now() + interval '60 seconds'
     OR v_session IS NULL OR octet_length(v_session) <> 32
     OR v_address IS NULL OR octet_length(v_address) <> 32 THEN
    RAISE EXCEPTION 'auth_complete_classbeat: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_email IS NOT NULL AND length(v_email) NOT BETWEEN 3 AND 254 THEN
    v_email := NULL;
  END IF;

  SELECT a.id INTO v_account FROM player.accounts a
  WHERE a.kind = 'instructor' AND a.classbeat_issuer = v_issuer AND a.classbeat_subject = v_subject;

  IF v_account IS NULL THEN
    -- Refused sign-ups per address: 10 an hour; beyond them every sign-up from that address is
    -- refused the same way. Read here, counted only when refused.
    v_key := sha256(convert_to('classbeat.signup_refused:', 'UTF8') || v_address);
    SELECT r.hits INTO v_refused FROM player.rate_limits r
    WHERE r.key_hash = v_key
      AND r.window_start = to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600);
    IF coalesce(v_refused, 0) < 10 THEN
      -- An entry bound to this identity, or else an unbound entry for its verified email,
      -- which this sign-in binds. The UPDATE takes the entry's row lock: of two sign-ins with
      -- the email at once, the second finds the entry bound and checks the identity again.
      v_allowed := EXISTS (SELECT 1 FROM player.signup_allowlist l
                           WHERE l.bound_issuer = v_issuer AND l.bound_subject = v_subject);
      IF NOT v_allowed AND v_email IS NOT NULL THEN
        UPDATE player.signup_allowlist l SET bound_issuer = v_issuer, bound_subject = v_subject
        WHERE l.email = v_email AND l.bound_subject IS NULL;
        GET DIAGNOSTICS v_bound = ROW_COUNT;
        v_allowed := v_bound = 1 OR EXISTS (
          SELECT 1 FROM player.signup_allowlist l
          WHERE l.bound_issuer = v_issuer AND l.bound_subject = v_subject);
      END IF;
    END IF;
    IF NOT v_allowed THEN
      PERFORM player.rate_limit_hit(v_key, interval '1 hour', 10);
      RETURN 'refused';
    END IF;
    -- The passkey user handle as in auth_complete_login: an identifier, not a secret.
    INSERT INTO player.accounts
      (kind, classbeat_issuer, classbeat_subject, email, passkey_user_handle)
    VALUES ('instructor', v_issuer, v_subject, v_email,
            uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()))
    ON CONFLICT ON CONSTRAINT accounts_classbeat_identity DO NOTHING;
    GET DIAGNOSTICS v_made = ROW_COUNT;
    SELECT a.id INTO v_account FROM player.accounts a
    WHERE a.kind = 'instructor' AND a.classbeat_issuer = v_issuer
      AND a.classbeat_subject = v_subject;
  ELSIF v_email IS NOT NULL THEN
    -- The display email follows classbeat's verified one; an unverified one changes nothing.
    UPDATE player.accounts a SET email = v_email
    WHERE a.id = v_account AND a.email IS DISTINCT FROM v_email;
  END IF;

  -- The account's sign-in lock of 0005, its wait bounded as in 0012.
  v_wait := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM pg_advisory_xact_lock(
    7270003, ('x' || left(replace(v_account::text, '-', ''), 8))::bit(32)::integer);
  PERFORM set_config('lock_timeout', v_wait, true);

  INSERT INTO player.sessions (account_id, token_hash, signed_in_at, client_family)
  VALUES (v_account, v_session, least(v_auth, now()), v_family)
  RETURNING id INTO v_session_id;

  -- At most 20 sessions per account: the oldest are dropped, never the new one.
  DELETE FROM player.sessions s
  WHERE s.account_id = v_account
    AND s.id IN (SELECT o.id FROM player.sessions o
                 WHERE o.account_id = v_account AND o.id <> v_session_id
                 ORDER BY o.created_at DESC, o.id
                 OFFSET 19);

  INSERT INTO player.audit_events
    (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
  VALUES (v_account, 'login.signed_in', 'session', v_session_id, (v_client).network, v_family,
          jsonb_build_object('method', 'classbeat', 'account_created', v_made = 1));
  RETURN 'signed_in';
END
$$;

-- Section 5. The asking session must be live, its account the instructor of this identity, and
-- classbeat's authentication no older than the flow's start minus 60 seconds. Returns
-- `reauthenticated` or `refused`; a refusal for a live session writes `reauth.refused` on its
-- account and changes no session.
CREATE FUNCTION player.auth_reauth_classbeat(
  asking_session_hash bytea, issuer text, subject text, auth_time timestamptz,
  started_at timestamptz, session_hash bytea, client player.client_info)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_asking   bytea := auth_reauth_classbeat.asking_session_hash;
  v_issuer   text := auth_reauth_classbeat.issuer;
  v_subject  text := auth_reauth_classbeat.subject;
  v_auth     timestamptz := auth_reauth_classbeat.auth_time;
  v_started  timestamptz := auth_reauth_classbeat.started_at;
  v_session  bytea := auth_reauth_classbeat.session_hash;
  v_client   player.client_info := auth_reauth_classbeat.client;
  v_family   text := coalesce(left((v_client).family, 40), '');
  v_asking_id uuid;
  v_account  uuid;
  v_same     boolean;
  v_reason   text;
  v_session_id uuid;
  v_wait     text;
BEGIN
  IF v_asking IS NULL OR octet_length(v_asking) <> 32
     OR v_issuer IS NULL OR length(v_issuer) NOT BETWEEN 1 AND 255
     OR v_subject IS NULL OR length(v_subject) NOT BETWEEN 1 AND 255
     OR v_auth IS NULL OR v_auth > now() + interval '60 seconds'
     OR v_started IS NULL
     OR v_session IS NULL OR octet_length(v_session) <> 32 THEN
    RAISE EXCEPTION 'auth_reauth_classbeat: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT s.id, s.account_id INTO v_asking_id, v_account
  FROM player.sessions s
  WHERE s.token_hash = v_asking
    AND s.last_used_at > now() - interval '14 days'
    AND s.created_at > now() - interval '60 days';
  IF v_account IS NULL THEN
    RETURN 'refused';
  END IF;

  SELECT a.kind = 'instructor' AND a.classbeat_issuer = v_issuer
         AND a.classbeat_subject = v_subject
    INTO v_same
  FROM player.accounts a WHERE a.id = v_account;
  v_reason := CASE
    WHEN v_same IS NOT TRUE THEN 'other_identity'
    WHEN v_auth < v_started - interval '60 seconds' THEN 'not_fresh'
  END;
  IF v_reason IS NOT NULL THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
    VALUES (v_account, 'reauth.refused', 'session', v_asking_id, (v_client).network, v_family,
            jsonb_build_object('method', 'classbeat', 'reason', v_reason));
    RETURN 'refused';
  END IF;

  v_wait := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM pg_advisory_xact_lock(
    7270003, ('x' || left(replace(v_account::text, '-', ''), 8))::bit(32)::integer);
  PERFORM set_config('lock_timeout', v_wait, true);

  INSERT INTO player.sessions (account_id, token_hash, signed_in_at, client_family)
  VALUES (v_account, v_session, least(v_auth, now()), v_family)
  RETURNING id INTO v_session_id;

  DELETE FROM player.sessions s
  WHERE s.account_id = v_account
    AND s.id IN (SELECT o.id FROM player.sessions o
                 WHERE o.account_id = v_account AND o.id <> v_session_id
                 ORDER BY o.created_at DESC, o.id
                 OFFSET 19);

  INSERT INTO player.audit_events
    (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
  VALUES (v_account, 'login.reauthenticated', 'session', v_session_id, (v_client).network,
          v_family, jsonb_build_object('method', 'classbeat'));
  RETURN 'reauthenticated';
END
$$;

-- Owner, PUBLIC and player_app for the four new functions, as 0003 does for its list.
GRANT CREATE ON SCHEMA player TO player_auth;
ALTER FUNCTION player.auth_start_classbeat(bytea, bytea, bytea, text, text, bytea, bytea, bytea)
  OWNER TO player_auth;
ALTER FUNCTION player.auth_take_classbeat(bytea, bytea, bytea) OWNER TO player_auth;
ALTER FUNCTION player.auth_complete_classbeat(
  text, text, text, boolean, timestamptz, bytea, bytea, player.client_info) OWNER TO player_auth;
ALTER FUNCTION player.auth_reauth_classbeat(
  bytea, text, text, timestamptz, timestamptz, bytea, player.client_info) OWNER TO player_auth;
REVOKE CREATE ON SCHEMA player FROM player_auth;
REVOKE ALL ON FUNCTION
  player.auth_start_classbeat(bytea, bytea, bytea, text, text, bytea, bytea, bytea),
  player.auth_take_classbeat(bytea, bytea, bytea),
  player.auth_complete_classbeat(
    text, text, text, boolean, timestamptz, bytea, bytea, player.client_info),
  player.auth_reauth_classbeat(
    bytea, text, text, timestamptz, timestamptz, bytea, player.client_info)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  player.auth_start_classbeat(bytea, bytea, bytea, text, text, bytea, bytea, bytea),
  player.auth_take_classbeat(bytea, bytea, bytea),
  player.auth_complete_classbeat(
    text, text, text, boolean, timestamptz, bytea, bytea, player.client_info),
  player.auth_reauth_classbeat(
    bytea, text, text, timestamptz, timestamptz, bytea, player.client_info)
  TO player_app;

-- ---------------------------------------------------------------------------------------------
-- The email link never finds an instructor (replaced: the body of 0005 and of 0012 each, but
-- for `kind <> 'instructor'` on every lookup of an account by email and the ON CONFLICT on the
-- partial index above).
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION player.auth_request_login(
  email text, link_hash bytea, browser_hash bytea, address_hash bytea, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_email   text := lower(btrim(auth_request_login.email));
  v_link    bytea := auth_request_login.link_hash;
  v_browser bytea := auth_request_login.browser_hash;
  v_address bytea := auth_request_login.address_hash;
  v_client  player.client_info := auth_request_login.client;
  v_pair    bytea;
  v_over    boolean;
  v_over_day boolean;
  v_account uuid;
  v_listed  boolean;
  v_usable  boolean;
  v_cancel  timestamptz;
BEGIN
  IF v_email IS NULL OR length(v_email) NOT BETWEEN 3 AND 254
     OR v_link IS NULL OR octet_length(v_link) <> 32
     OR v_browser IS NULL OR octet_length(v_browser) <> 32
     OR v_address IS NULL OR octet_length(v_address) <> 32 THEN
    RAISE EXCEPTION 'auth_request_login: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_pair := sha256(convert_to('login.pair:' || v_email || ':', 'UTF8') || v_address);
  v_over := player.rate_limit_hit(
    sha256(convert_to('15m:', 'UTF8') || v_pair), interval '15 minutes', 3);
  v_over_day := player.rate_limit_hit(
    sha256(convert_to('1d:', 'UTF8') || v_pair), interval '1 day', 10);
  v_over := v_over OR v_over_day;
  IF NOT v_over THEN
    v_over := player.rate_limit_hit(
      sha256(convert_to('login.email:' || v_email, 'UTF8')), interval '1 day', 30);
  END IF;

  SELECT a.id INTO v_account FROM player.accounts a
  WHERE a.email = v_email AND a.kind <> 'instructor';
  SELECT EXISTS (SELECT 1 FROM player.signup_allowlist l WHERE l.email = v_email) INTO v_listed;
  v_usable := NOT v_over AND (v_account IS NOT NULL OR v_listed);

  PERFORM pg_advisory_xact_lock(7270002, ('x' || encode(substring(sha256(
    convert_to('login.link:' || v_email || ':', 'UTF8') || v_browser) FROM 1 FOR 4), 'hex')
  )::bit(32)::integer);

  v_cancel := CASE WHEN v_over THEN '-infinity' ELSE 'infinity' END;
  DELETE FROM player.login_links l
  WHERE l.email = v_email AND l.browser_hash = v_browser AND l.created_at < v_cancel;
  INSERT INTO player.login_links (link_hash, email, browser_hash, usable, expires_at)
  VALUES (v_link, v_email, v_browser, v_usable, now() + interval '15 minutes');

  IF v_account IS NOT NULL THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, client_network, client_family, detail)
    VALUES (v_account, 'login.link_requested', 'link', (v_client).network,
            coalesce(left((v_client).family, 40), ''), jsonb_build_object('mail', v_usable));
  END IF;
  RETURN v_usable;
END
$$;

CREATE OR REPLACE FUNCTION player.auth_complete_login(
  link_hash bytea, browser_hash bytea, session_hash bytea, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_link    bytea := auth_complete_login.link_hash;
  v_browser bytea := auth_complete_login.browser_hash;
  v_session bytea := auth_complete_login.session_hash;
  v_client  player.client_info := auth_complete_login.client;
  v_family  text := coalesce(left((v_client).family, 40), '');
  v_link_id uuid;
  v_email   text;
  v_asked   bytea;
  v_usable  boolean;
  v_expires timestamptz;
  v_account uuid;
  v_reason  text;
  v_made    integer := 0;
  v_session_id uuid;
  v_wait       text;
BEGIN
  IF v_link IS NULL OR octet_length(v_link) <> 32
     OR v_browser IS NULL OR octet_length(v_browser) <> 32
     OR v_session IS NULL OR octet_length(v_session) <> 32 THEN
    RAISE EXCEPTION 'auth_complete_login: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT l.id, l.email, l.browser_hash, l.usable, l.expires_at
    INTO v_link_id, v_email, v_asked, v_usable, v_expires
  FROM player.login_links l WHERE l.link_hash = v_link FOR UPDATE;
  IF v_link_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT a.id INTO v_account FROM player.accounts a
  WHERE a.email = v_email AND a.kind <> 'instructor';
  v_reason := CASE
    WHEN NOT v_usable THEN 'not_usable'
    WHEN v_expires <= now() THEN 'expired'
    WHEN v_asked <> v_browser THEN 'other_browser'
    WHEN v_account IS NULL
         AND NOT EXISTS (SELECT 1 FROM player.signup_allowlist s WHERE s.email = v_email)
      THEN 'not_allowed'
  END;
  IF v_reason IS NOT NULL THEN
    IF v_account IS NOT NULL THEN
      INSERT INTO player.audit_events
        (account_id, event, credential_kind, client_network, client_family, detail)
      VALUES (v_account, 'login.refused', 'link', (v_client).network, v_family,
              jsonb_build_object('reason', v_reason));
    END IF;
    RETURN false;
  END IF;

  DELETE FROM player.login_links l WHERE l.id = v_link_id;

  IF v_account IS NULL THEN
    INSERT INTO player.accounts (email, passkey_user_handle)
    VALUES (v_email, uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()))
    ON CONFLICT (email) WHERE kind <> 'instructor' DO NOTHING;
    GET DIAGNOSTICS v_made = ROW_COUNT;
    SELECT a.id INTO v_account FROM player.accounts a
    WHERE a.email = v_email AND a.kind <> 'instructor';
  END IF;

  v_wait := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM pg_advisory_xact_lock(
    7270003, ('x' || left(replace(v_account::text, '-', ''), 8))::bit(32)::integer);
  PERFORM set_config('lock_timeout', v_wait, true);

  INSERT INTO player.sessions (account_id, token_hash, client_family)
  VALUES (v_account, v_session, v_family)
  RETURNING id INTO v_session_id;

  DELETE FROM player.sessions s
  WHERE s.account_id = v_account
    AND s.id IN (SELECT o.id FROM player.sessions o
                 WHERE o.account_id = v_account AND o.id <> v_session_id
                 ORDER BY o.created_at DESC, o.id
                 OFFSET 19);

  INSERT INTO player.audit_events
    (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
  VALUES (v_account, 'login.signed_in', 'session', v_session_id, (v_client).network, v_family,
          jsonb_build_object('method', 'link', 'account_created', v_made = 1));
  RETURN true;
END
$$;

-- The purge of 0003, and the two new closed tables.
CREATE OR REPLACE FUNCTION player.auth_purge_expired()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
BEGIN
  DELETE FROM player.login_links         WHERE expires_at < now();
  DELETE FROM player.login_challenges    WHERE expires_at < now();
  DELETE FROM player.pairings            WHERE expires_at < now();
  DELETE FROM player.source_link_codes   WHERE expires_at < now();
  DELETE FROM player.rate_limits         WHERE expires_at < now();
  DELETE FROM player.classbeat_sign_ins  WHERE expires_at < now();
  DELETE FROM player.classbeat_event_ids WHERE expires_at < now();
  DELETE FROM player.sessions
    WHERE last_used_at < now() - interval '14 days' OR created_at < now() - interval '60 days';
  DELETE FROM player.devices
    WHERE revoked_at < now() - interval '90 days'
       OR (last_used_at IS NULL AND created_at < now() - interval '24 hours');
  DELETE FROM player.audit_events        WHERE occurred_at < now() - interval '180 days';
END
$$;
