-- ADR 0002, sections 4, 5 and 10 (#158): the waits for the account's sign-in lock (7270003,
-- `lock_registry.ACCOUNT_SESSIONS`) are bounded. Two function bodies are replaced, each as it
-- was (auth_complete_login from 0005, auth_complete_passkey from 0011) but for that wait;
-- nothing else changes: no table, grant, role or signature. CREATE OR REPLACE keeps each
-- function's owner and rights; SECURITY DEFINER and the search_path are restated, as in 0004.
--
-- A sign-in that waits more than 2 seconds for another sign-in to the same account (or to an
-- account sharing the lock's 32 bits) fails with lock_not_available and changes nothing: the
-- link or the challenge is not used up, no account, session or event is written. The backend
-- answers it 429 with `Retry-After: 1` (passkey_policy.BUSY_RETRY_SECONDS), so a stuck
-- transaction holding the lock cannot hold every later sign-in's pool connection with it.


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
  v_wait       text;
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
  -- The wait for that lock is bounded (#158): 2 seconds, a constant here (principle 7), then
  -- lock_not_available (55P03), which rolls the whole call back; the backend answers 429 with
  -- Retry-After. The caller's own lock_timeout is put back once the lock is held, so the
  -- bound applies to this lock alone.
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
          jsonb_build_object('method', 'link', 'account_created', v_made = 1));
  RETURN true;
END
$$;

-- Called only after the backend has checked the signature (section 4). Uses up the challenge,
-- whatever follows; checks its time and its browser; applies the counter rule; creates the
-- session. A refusal for a passkey that exists writes that account's event and returns false:
-- `login.refused` for the challenge, `passkey.counter_refused` for the counter rule (section 11).
-- A credential id that matches no passkey sets no account and writes no event.
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
  SELECT p.id, p.account_id, p.sign_count INTO v_passkey, v_account, v_stored
  FROM player.passkeys p WHERE p.credential_id = v_credential FOR UPDATE;
  IF v_passkey IS NULL THEN
    RETURN false;
  END IF;

  v_reason := CASE
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

  -- One sign-in at a time per account, the same lock as auth_complete_login (0005), so link
  -- and passkey sign-ins at once cannot leave 21 sessions.
  -- The wait for that lock is bounded (#158): 2 seconds, a constant here (principle 7), then
  -- lock_not_available (55P03), which rolls the whole call back; the backend answers 429 with
  -- Retry-After. The caller's own lock_timeout is put back once the lock is held, so the
  -- bound applies to this lock alone.
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
