-- ADR 0002, sections 4, 5, 9, 10 and 11: the bodies of the functions that email link sign-in and
-- site sessions need. The other functions of 0003 keep failing closed until their issues.
--
-- CREATE OR REPLACE keeps each function's owner (player_auth) and its rights (no EXECUTE for
-- PUBLIC, EXECUTE for player_app). SECURITY DEFINER and the search_path are restated, because a
-- replacement sets every other property anew. The guard tests read all of it back.
--
-- In the bodies a parameter is read once, by its qualified name, into a `v_` variable. Several
-- parameters share a name with a column, and PL/pgSQL refuses an ambiguous name at run time,
-- so a missed one fails instead of comparing a column with itself.
--
-- The numbers are ADR 0002's defaults, as in auth_purge_expired: sign-up by allowlist, a link
-- lives 15 minutes and works only in the browser that asked, a session lives 14 days without use
-- and 60 days in all, at most 20 sessions per account.

CREATE OR REPLACE FUNCTION player.rate_limit_hit(
  key_hash bytea, window_length interval, max_hits integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_key     bytea := rate_limit_hit.key_hash;
  v_window  interval := rate_limit_hit.window_length;
  v_max     integer := rate_limit_hit.max_hits;
  v_seconds double precision := extract(epoch FROM v_window);
  v_start   timestamptz;
  v_hits    integer;
BEGIN
  IF v_key IS NULL OR octet_length(v_key) <> 32 OR v_seconds IS NULL OR v_seconds < 1
     OR v_max IS NULL OR v_max < 0 THEN
    RAISE EXCEPTION 'rate_limit_hit: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- A fixed window: the same start for every caller, so several processes share one counter.
  v_start := to_timestamp(floor(extract(epoch FROM now()) / v_seconds) * v_seconds);
  INSERT INTO player.rate_limits AS r (key_hash, window_start, hits, expires_at)
  VALUES (v_key, v_start, 1, v_start + v_window)
  ON CONFLICT ON CONSTRAINT rate_limits_pkey DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;
  RETURN v_hits > v_max;
END
$$;

-- Finds a live session, writes "last used" at most once every 5 minutes and sets the account
-- for this transaction. A token that matches no live session sets no account and returns nothing.
CREATE OR REPLACE FUNCTION player.auth_enter_session(token_hash bytea)
RETURNS TABLE (session_id uuid, signed_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_hash    bytea := auth_enter_session.token_hash;
  v_id      uuid;
  v_account uuid;
  v_signed  timestamptz;
  v_used    timestamptz;
BEGIN
  PERFORM set_config('app.account_id', '', true);
  SELECT s.id, s.account_id, s.signed_in_at, s.last_used_at
    INTO v_id, v_account, v_signed, v_used
  FROM player.sessions s
  WHERE s.token_hash = v_hash
    AND s.last_used_at > now() - interval '14 days'
    AND s.created_at > now() - interval '60 days';
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  IF v_used < now() - interval '5 minutes' THEN
    UPDATE player.sessions s SET last_used_at = now() WHERE s.id = v_id;
  END IF;
  PERFORM set_config('app.account_id', v_account::text, true);
  session_id := v_id;
  signed_in_at := v_signed;
  RETURN NEXT;
END
$$;

-- The one call of a sign-in link request, the same for every address (section 4, step 2).
-- Returns true when a mail is to be sent. The requester's own limit (10 an hour per address,
-- answered 429) is counted by the caller with rate_limit_hit before this.
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
BEGIN
  IF v_email IS NULL OR length(v_email) NOT BETWEEN 3 AND 254
     OR v_link IS NULL OR octet_length(v_link) <> 32
     OR v_browser IS NULL OR octet_length(v_browser) <> 32
     OR v_address IS NULL OR octet_length(v_address) <> 32 THEN
    RAISE EXCEPTION 'auth_request_login: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Section 10: per email and requesting address together first (3 per 15 minutes, 10 a day),
  -- so one stranger uses up only their own. The total per email (30 a day) counts only requests
  -- that passed those. Keys are hashes, kept for every email, known or not.
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

  -- An address can sign in when it has an account or may create one (SIGNUP_MODE allowlist).
  SELECT a.id INTO v_account FROM player.accounts a WHERE a.email = v_email;
  v_usable := NOT v_over AND (
    v_account IS NOT NULL
    OR EXISTS (SELECT 1 FROM player.signup_allowlist l WHERE l.email = v_email));

  -- A newer link cancels older ones only when asked from the same browser, and only when the
  -- newer one works. The same statement runs for every address.
  DELETE FROM player.login_links l
  WHERE l.email = v_email AND l.browser_hash = v_browser AND v_usable;
  INSERT INTO player.login_links (link_hash, email, browser_hash, usable, expires_at)
  VALUES (v_link, v_email, v_browser, v_usable, now() + interval '15 minutes');

  -- The one row more for an address that has an account (section 11).
  IF v_account IS NOT NULL THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, client_network, client_family, detail)
    VALUES (v_account, 'login.link_requested', 'link', (v_client).network,
            coalesce(left((v_client).family, 40), ''), jsonb_build_object('mail', v_usable));
  END IF;
  RETURN v_usable;
END
$$;

-- Checks and uses up a link, creates the account if needed and allowed, creates the session.
-- A refusal for an address that has an account writes its event and leaves the link as it is.
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
BEGIN
  IF v_link IS NULL OR octet_length(v_link) <> 32
     OR v_browser IS NULL OR octet_length(v_browser) <> 32
     OR v_session IS NULL OR octet_length(v_session) <> 32 THEN
    RAISE EXCEPTION 'auth_complete_login: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The row lock makes the link single use: a second caller waits and then finds no row.
  SELECT l.id, l.email, l.browser_hash, l.usable, l.expires_at
    INTO v_link_id, v_email, v_asked, v_usable, v_expires
  FROM player.login_links l WHERE l.link_hash = v_link FOR UPDATE;
  IF v_link_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT a.id INTO v_account FROM player.accounts a WHERE a.email = v_email;
  v_reason := CASE
    WHEN NOT v_usable THEN 'not_usable'
    WHEN v_expires <= now() THEN 'expired'
    -- LOGIN_LINK_SAME_BROWSER: only the browser that asked.
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
    -- The passkey user handle: 32 bytes of two random UUIDs. An identifier, not a secret.
    INSERT INTO player.accounts (email, passkey_user_handle)
    VALUES (v_email, uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()))
    ON CONFLICT ON CONSTRAINT accounts_email_key DO NOTHING;
    GET DIAGNOSTICS v_made = ROW_COUNT;
    SELECT a.id INTO v_account FROM player.accounts a WHERE a.email = v_email;
  END IF;

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
          jsonb_build_object('method', 'link', 'account_created', v_made = 1));
  RETURN true;
END
$$;
