-- ADR 0002, sections 4, 5 and 10: sign-in hardening from the review of the first sign-in
-- migration (0004). Two function bodies are replaced; nothing else changes: no table, grant,
-- role or signature. CREATE OR REPLACE keeps each function's owner and rights; SECURITY DEFINER
-- and the search_path are restated, as in 0004.
--
-- auth_request_login: the allowlist lookup and the cancelling DELETE run for every address,
-- whatever its account and limits (section 4, step 2), and requests for one email from one
-- browser are taken one at a time.
-- auth_complete_login: sign-ins to one account are taken one at a time, so the cap of 20
-- sessions holds when two happen at once.
--
-- The advisory locks are transaction locks with two keys: a number of their own each (7270002,
-- 7270003; the migration runner's is the single key 7270001) and 32 bits of what is locked.
-- Two different emails or accounts that share those bits only wait for each other.

-- The sign-in call of a link request (section 4, step 2). Returns true when a mail is to be
-- sent. The requester's own limit (10 an hour per address, answered 429) is counted by the
-- caller with rate_limit_hit before this.
--
-- The same lookups and writes for every address, with two exceptions the ADR names: a request
-- over its per-pair limits does not count toward the total per email (section 10), and an
-- address that has an account gets its "link requested" event (section 11).
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
  -- Both lookups run for every address, each a statement of its own, so neither is skipped
  -- for what the other found or for the limits.
  SELECT a.id INTO v_account FROM player.accounts a WHERE a.email = v_email;
  SELECT EXISTS (SELECT 1 FROM player.signup_allowlist l WHERE l.email = v_email) INTO v_listed;
  v_usable := NOT v_over AND (v_account IS NOT NULL OR v_listed);

  -- One request at a time per email and browser: the second waits here and then sees the
  -- first one's link, so two requests at once cannot leave two usable links.
  PERFORM pg_advisory_xact_lock(7270002, ('x' || encode(substring(sha256(
    convert_to('login.link:' || v_email || ':', 'UTF8') || v_browser) FROM 1 FOR 4), 'hex')
  )::bit(32)::integer);

  -- A newer link cancels older ones only when asked from the same browser, and only when the
  -- newer one works. The statement finds the older links for every address: whether it deletes
  -- them is a comparison with a time, which the planner cannot fold away as it would a constant
  -- false.
  v_cancel := CASE WHEN v_usable THEN 'infinity' ELSE '-infinity' END;
  DELETE FROM player.login_links l
  WHERE l.email = v_email AND l.browser_hash = v_browser AND l.created_at < v_cancel;
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

  -- One sign-in at a time per account: the second waits here and then counts the first one's
  -- session, so two sign-ins at once cannot leave 21 sessions. (player_auth may not lock the
  -- account's row: it has no UPDATE on accounts.)
  PERFORM pg_advisory_xact_lock(
    7270003, ('x' || left(replace(v_account::text, '-', ''), 8))::bit(32)::integer);

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
