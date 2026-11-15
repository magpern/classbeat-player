-- ADR 0010, section 7 (#495): the email link and passkeys are closed for every account kind
-- there is today. They stay built and tested, and open for `follower` alone, a kind that no
-- function makes yet (a later ADR does), so in practice they refuse every account.
--
-- - The email's unique index becomes partial for `kind = 'follower'` (ADR 0010, section 8): an
--   instructor's email is a display email, and an unlinked account signs in by no method.
-- - auth_request_login finds only a follower by its email. A link is usable only for a follower
--   and within the limits; the allowlist no longer makes one usable, since the email link signs
--   no one up. The answer is the same as before, whatever the address: the function returns
--   whether to mail, and the route answers `accepted` either way.
-- - auth_complete_login finds only a follower by its email and creates no account. A link for
--   an address with no follower is refused with no event, as for an address with no account.
-- - auth_complete_passkey refuses a passkey whose account is not a follower: `login.refused`
--   with reason `closed`, the pattern of its other refusals. Passkeys made before this change
--   are kept, not deleted (the reversible choice): they are listed and removable on the site,
--   and none signs in. Registering one is refused by the backend, which reads the account's
--   kind (player_backend/own_sign_in_policy.py).
--
-- Each body is the one it replaces (0014 for the two email link functions, 0012 for the passkey
-- one) but for the lines above. CREATE OR REPLACE keeps each function's owner and rights;
-- SECURITY DEFINER and the search_path are restated, as in 0004. No grant, role, table or
-- signature changes.

DROP INDEX player.accounts_email_not_instructor;
CREATE UNIQUE INDEX accounts_email_follower ON player.accounts (email) WHERE kind = 'follower';

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

  -- Section 7: only a follower. No other kind is found, and nothing is made.
  SELECT a.id INTO v_account FROM player.accounts a
  WHERE a.email = v_email AND a.kind = 'follower';
  v_usable := NOT v_over AND v_account IS NOT NULL;

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

-- Checks and uses up a link and creates the session, for a follower alone. A refusal for an
-- address that has a follower writes its event and leaves the link as it is.
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

  -- Section 7: only a follower. A link made usable before this change, for an account of
  -- another kind or for an allowlisted address, finds none and is refused.
  SELECT a.id INTO v_account FROM player.accounts a
  WHERE a.email = v_email AND a.kind = 'follower';
  IF v_account IS NULL THEN
    RETURN false;
  END IF;
  v_reason := CASE
    WHEN NOT v_usable THEN 'not_usable'
    WHEN v_expires <= now() THEN 'expired'
    WHEN v_asked <> v_browser THEN 'other_browser'
  END;
  IF v_reason IS NOT NULL THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, client_network, client_family, detail)
    VALUES (v_account, 'login.refused', 'link', (v_client).network, v_family,
            jsonb_build_object('reason', v_reason));
    RETURN false;
  END IF;

  DELETE FROM player.login_links l WHERE l.id = v_link_id;

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
          jsonb_build_object('method', 'link', 'account_created', false));
  RETURN true;
END
$$;

-- Called only after the backend has checked the signature (ADR 0002, section 4). Uses up the
-- challenge, whatever follows; refuses a passkey whose account is not a follower (ADR 0010,
-- section 7); checks the challenge's time and browser; applies the counter rule; creates the
-- session. A refusal for a passkey that exists writes that account's event and returns false:
-- `login.refused` for the kind or the challenge, `passkey.counter_refused` for the counter rule
-- (section 11). A credential id that matches no passkey sets no account and writes no event.
CREATE OR REPLACE FUNCTION player.auth_complete_passkey(
  credential_id bytea, challenge_hash bytea, browser_hash bytea, counter bigint,
  session_hash bytea, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_credential bytea := auth_complete_passkey.credential_id;
  v_challenge  bytea := auth_complete_passkey.challenge_hash;
  v_browser    bytea := auth_complete_passkey.browser_hash;
  v_counter    bigint := auth_complete_passkey.counter;
  v_session    bytea := auth_complete_passkey.session_hash;
  v_client     player.client_info := auth_complete_passkey.client;
  v_family     text := coalesce(left((v_client).family, 40), '');
  v_asked      bytea;
  v_expires    timestamptz;
  v_passkey    uuid;
  v_account    uuid;
  v_kind       text;
  v_stored     bigint;
  v_reason     text;
  v_session_id uuid;
  v_wait       text;
BEGIN
  IF v_credential IS NULL
     OR v_challenge IS NULL OR octet_length(v_challenge) <> 32
     OR v_browser IS NULL OR octet_length(v_browser) <> 32
     OR v_session IS NULL OR octet_length(v_session) <> 32
     OR v_counter IS NULL OR v_counter NOT BETWEEN 0 AND 4294967295 THEN
    RAISE EXCEPTION 'auth_complete_passkey: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Single use: the challenge is gone whatever happens next. A second caller with the same
  -- challenge waits on the row and then finds none.
  DELETE FROM player.login_challenges c WHERE c.challenge_hash = v_challenge
  RETURNING c.browser_hash, c.expires_at INTO v_asked, v_expires;

  -- The row lock takes sign-ins with one passkey one at a time, so the counter rule holds
  -- when two happen at once.
  SELECT p.id, p.account_id, p.sign_count, a.kind INTO v_passkey, v_account, v_stored, v_kind
  FROM player.passkeys p JOIN player.accounts a ON a.id = p.account_id
  WHERE p.credential_id = v_credential FOR UPDATE OF p;
  IF v_passkey IS NULL THEN
    RETURN false;
  END IF;

  -- Section 7 first: a passkey of any kind but follower signs in to nothing, whatever its
  -- challenge and its counter, and its counter is left as it is.
  v_reason := CASE
    WHEN v_kind IS DISTINCT FROM 'follower' THEN 'closed'
    WHEN v_asked IS NULL THEN 'unknown_challenge'
    WHEN v_expires <= now() THEN 'expired'
    WHEN v_asked <> v_browser THEN 'other_browser'
  END;
  IF v_reason IS NOT NULL THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
    VALUES (v_account, 'login.refused', 'passkey', v_passkey, (v_client).network, v_family,
            jsonb_build_object('method', 'passkey', 'reason', v_reason));
    RETURN false;
  END IF;

  -- The counter rule (section 4): when either counter is non-zero, the received one must be
  -- greater than the stored one.
  IF (v_stored <> 0 OR v_counter <> 0) AND v_counter <= v_stored THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
    VALUES (v_account, 'passkey.counter_refused', 'passkey', v_passkey, (v_client).network,
            v_family, jsonb_build_object('stored', v_stored, 'received', v_counter));
    RETURN false;
  END IF;

  UPDATE player.passkeys p SET sign_count = v_counter, last_used_at = now()
  WHERE p.id = v_passkey;

  -- One sign-in at a time per account, the same lock as auth_complete_login, with its wait
  -- bounded to 2 seconds (#158, 0012).
  v_wait := current_setting('lock_timeout');
  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM pg_advisory_xact_lock(
    7270003, ('x' || left(replace(v_account::text, '-', ''), 8))::bit(32)::integer);
  PERFORM set_config('lock_timeout', v_wait, true);

  INSERT INTO player.sessions (account_id, token_hash, client_family)
  VALUES (v_account, v_session, v_family)
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
          jsonb_build_object('method', 'passkey', 'account_created', false,
                             'passkey_id', v_passkey));
  RETURN true;
END
$$;
