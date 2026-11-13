-- ADR 0002, sections 4, 9, 10 and 11: the bodies of the three passkey sign-in functions, which
-- failed closed until now (0003). No table, grant, role or signature changes; one index is added
-- to a closed table. CREATE OR REPLACE keeps each function's owner (player_auth) and its rights
-- (no EXECUTE for PUBLIC, EXECUTE for player_app); SECURITY DEFINER and the search_path are
-- restated, as in 0004.
--
-- The backend checks the WebAuthn signature (section 4). These functions check what the
-- database can itself: the challenge's hash, its 5 minutes, its single use, its browser and the
-- counter rule. The numbers are constants in the bodies (principle 7): a challenge lives
-- 5 minutes; a session lives as in 0004 and at most 20 are kept per account.
--
-- In the bodies a parameter is read once, by its qualified name, into a `v_` variable, and
-- every column is qualified: several parameters and output columns share a name with a column.

-- A browser's older sign-in challenges are found by its token's hash.
CREATE INDEX login_challenges_browser ON player.login_challenges (browser_hash);

-- Stores a passkey sign-in challenge, bound to the browser token, for 5 minutes. A browser has
-- one at a time: a newer one replaces its older ones, so one browser token holds one row.
CREATE OR REPLACE FUNCTION player.auth_new_login_challenge(challenge_hash bytea, browser_hash bytea)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_challenge bytea := auth_new_login_challenge.challenge_hash;
  v_browser   bytea := auth_new_login_challenge.browser_hash;
BEGIN
  IF v_challenge IS NULL OR octet_length(v_challenge) <> 32
     OR v_browser IS NULL OR octet_length(v_browser) <> 32 THEN
    RAISE EXCEPTION 'auth_new_login_challenge: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  DELETE FROM player.login_challenges c WHERE c.browser_hash = v_browser;
  INSERT INTO player.login_challenges (challenge_hash, browser_hash, expires_at)
  VALUES (v_challenge, v_browser, now() + interval '5 minutes');
END
$$;

-- The public key and the counter of a passkey, for the backend to check a signature with. No
-- account id, and no row for a credential id that matches none.
CREATE OR REPLACE FUNCTION player.auth_passkey_for_login(credential_id bytea)
RETURNS TABLE (public_key bytea, sign_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_credential bytea := auth_passkey_for_login.credential_id;
BEGIN
  IF v_credential IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.public_key, p.sign_count FROM player.passkeys p WHERE p.credential_id = v_credential;
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
          jsonb_build_object('method', 'passkey', 'account_created', false,
                             'passkey_id', v_passkey));
  RETURN true;
END
$$;
