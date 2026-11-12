-- ADR 0002, sections 3, 6, 9, 10 and 11: the bodies of the functions that pairing a device and
-- the device token need. auth_device_active (the live process, PL8) and the other functions of
-- 0003 keep failing closed until their issues.
--
-- As in 0004: CREATE OR REPLACE keeps each function's owner (player_auth) and its rights (no
-- EXECUTE for PUBLIC, EXECUTE for player_app); SECURITY DEFINER and the search_path are restated;
-- a parameter is read once, by its qualified name, into a `v_` variable. No grant, no table and
-- no new function: the guard tests read all of it back.
--
-- The numbers are ADR 0002's defaults, written here as in auth_purge_expired: a pairing lives 10
-- minutes, one poll per 5 seconds, 5 wrong codes per account in 15 minutes close the form for
-- 15 minutes, at most 10 active devices per account, a device token ends after 180 days without
-- use, a revoked device's row answers for 90 days, a device never used is gone after 24 hours.

-- Writes a pending pairing. The limit on starts (10 an hour per address) is counted by the
-- caller with rate_limit_hit before this. A code that is still in use raises unique_violation
-- and writes nothing: the caller then asks again with new codes.
CREATE OR REPLACE FUNCTION player.auth_start_pairing(
  device_code_hash bytea, user_code_hash bytea, platform text, version text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_device   bytea := auth_start_pairing.device_code_hash;
  v_user     bytea := auth_start_pairing.user_code_hash;
  v_platform text := auth_start_pairing.platform;
  v_version  text := auth_start_pairing.version;
BEGIN
  IF v_device IS NULL OR octet_length(v_device) <> 32
     OR v_user IS NULL OR octet_length(v_user) <> 32
     OR v_platform IS NULL OR length(v_platform) NOT BETWEEN 1 AND 40
     OR v_version IS NULL OR length(v_version) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'auth_start_pairing: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- A code whose pairing has ended is free again, whether or not the purge has run.
  DELETE FROM player.pairings p
  WHERE p.expires_at <= now()
    AND (p.user_code_hash = v_user OR p.device_code_hash = v_device);
  INSERT INTO player.pairings (device_code_hash, user_code_hash, platform, version, expires_at)
  VALUES (v_device, v_user, v_platform, v_version, now() + interval '10 minutes');
END
$$;

-- Look up, for the account already set only. Changes nothing about the pairing and writes no
-- event. A code that matches no pending pairing counts as a wrong code for the account; while
-- the form is closed nothing is found and nothing is compared.
CREATE OR REPLACE FUNCTION player.auth_find_pairing(user_code_hash bytea)
RETURNS TABLE (platform text, version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_code     bytea := auth_find_pairing.user_code_hash;
  v_account  uuid := nullif(current_setting('app.account_id', true), '')::uuid;
  v_wrong    bytea;
  v_closed   bytea;
  v_platform text;
  v_version  text;
BEGIN
  IF v_code IS NULL OR octet_length(v_code) <> 32 THEN
    RAISE EXCEPTION 'auth_find_pairing: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_account IS NULL THEN
    RETURN;
  END IF;
  v_wrong := sha256(convert_to('pairing.wrong:' || v_account::text, 'UTF8'));
  v_closed := sha256(convert_to('pairing.closed:' || v_account::text, 'UTF8'));
  -- One try at a time per account, so that tries sent together are counted before the next one
  -- is compared: the lock is held until the caller's transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('pairing.codes:' || v_account::text, 0));
  IF EXISTS (SELECT 1 FROM player.rate_limits r
             WHERE r.key_hash = v_closed AND r.expires_at > now()) THEN
    RETURN;
  END IF;

  SELECT p.platform, p.version INTO v_platform, v_version
  FROM player.pairings p
  WHERE p.user_code_hash = v_code AND p.state = 'pending' AND p.expires_at > now();
  IF NOT FOUND THEN
    -- The fifth wrong code in the window closes the form for 15 minutes.
    IF player.rate_limit_hit(v_wrong, interval '15 minutes', 4) THEN
      INSERT INTO player.rate_limits AS r (key_hash, window_start, hits, expires_at)
      VALUES (v_closed, now(), 1, now() + interval '15 minutes')
      ON CONFLICT ON CONSTRAINT rate_limits_pkey DO UPDATE SET expires_at = EXCLUDED.expires_at;
    END IF;
    RETURN;
  END IF;
  platform := v_platform;
  version := v_version;
  RETURN NEXT;
END
$$;

-- Decide, for the account already set only: approves or denies that pending pairing and writes
-- the account's event. A wrong code is counted as in auth_find_pairing. An approval above 10
-- active devices is refused and leaves the pairing pending. Pairings the account has approved
-- and whose token is not collected yet count as devices, so the cap holds at the collection.
CREATE OR REPLACE FUNCTION player.auth_decide_pairing(
  user_code_hash bytea, approve boolean, name text, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_code     bytea := auth_decide_pairing.user_code_hash;
  v_approve  boolean := auth_decide_pairing.approve;
  v_name     text := auth_decide_pairing.name;
  v_client   player.client_info := auth_decide_pairing.client;
  v_family   text := coalesce(left((v_client).family, 40), '');
  v_account  uuid := nullif(current_setting('app.account_id', true), '')::uuid;
  v_wrong    bytea;
  v_closed   bytea;
  v_id       uuid;
  v_platform text;
  v_version  text;
  v_held     bigint;
BEGIN
  IF v_code IS NULL OR octet_length(v_code) <> 32 OR v_approve IS NULL
     OR (v_approve AND (v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 40)) THEN
    RAISE EXCEPTION 'auth_decide_pairing: bad arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_account IS NULL THEN
    RETURN false;
  END IF;
  v_wrong := sha256(convert_to('pairing.wrong:' || v_account::text, 'UTF8'));
  v_closed := sha256(convert_to('pairing.closed:' || v_account::text, 'UTF8'));
  PERFORM pg_advisory_xact_lock(hashtextextended('pairing.codes:' || v_account::text, 0));
  IF EXISTS (SELECT 1 FROM player.rate_limits r
             WHERE r.key_hash = v_closed AND r.expires_at > now()) THEN
    RETURN false;
  END IF;

  -- The row lock makes the user code single use: a second decision waits and finds no row.
  SELECT p.id, p.platform, p.version INTO v_id, v_platform, v_version
  FROM player.pairings p
  WHERE p.user_code_hash = v_code AND p.state = 'pending' AND p.expires_at > now()
  FOR UPDATE;
  IF v_id IS NULL THEN
    IF player.rate_limit_hit(v_wrong, interval '15 minutes', 4) THEN
      INSERT INTO player.rate_limits AS r (key_hash, window_start, hits, expires_at)
      VALUES (v_closed, now(), 1, now() + interval '15 minutes')
      ON CONFLICT ON CONSTRAINT rate_limits_pkey DO UPDATE SET expires_at = EXCLUDED.expires_at;
    END IF;
    RETURN false;
  END IF;

  IF NOT v_approve THEN
    UPDATE player.pairings p SET state = 'denied', account_id = v_account WHERE p.id = v_id;
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
    VALUES (v_account, 'pairing.denied', 'pairing', v_id, (v_client).network, v_family,
            jsonb_build_object('platform', v_platform, 'version', v_version));
    RETURN true;
  END IF;

  -- One statement, so one snapshot: a collection that commits meanwhile is counted once.
  SELECT (SELECT count(*) FROM player.devices d
          WHERE d.account_id = v_account AND d.revoked_at IS NULL
            AND coalesce(d.last_used_at, d.created_at) > now() - interval '180 days'
            AND (d.last_used_at IS NOT NULL OR d.created_at > now() - interval '24 hours'))
       + (SELECT count(*) FROM player.pairings p
          WHERE p.account_id = v_account AND p.state = 'approved' AND p.expires_at > now())
    INTO v_held;
  IF v_held >= 10 THEN
    INSERT INTO player.audit_events
      (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
    VALUES (v_account, 'pairing.refused', 'pairing', v_id, (v_client).network, v_family,
            jsonb_build_object('reason', 'device_limit'));
    RETURN false;
  END IF;

  UPDATE player.pairings p
  SET state = 'approved', account_id = v_account, device_name = v_name
  WHERE p.id = v_id;
  INSERT INTO player.audit_events
    (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
  VALUES (v_account, 'pairing.approved', 'pairing', v_id, (v_client).network, v_family,
          jsonb_build_object('platform', v_platform, 'version', v_version));
  RETURN true;
END
$$;

-- The poll. On the first poll after approval, in this one transaction: the device row is made
-- with the hash of the token the caller holds, the pairing is used up (its row is deleted) and
-- the account's email is returned. Every later poll finds no row: expired_token. The states are
-- authorization_pending, slow_down, access_denied, expired_token and ok.
CREATE OR REPLACE FUNCTION player.auth_collect_pairing(
  device_code_hash bytea, device_token_hash bytea, client player.client_info)
RETURNS TABLE (state text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_code     bytea := auth_collect_pairing.device_code_hash;
  v_token    bytea := auth_collect_pairing.device_token_hash;
  v_client   player.client_info := auth_collect_pairing.client;
  v_id       uuid;
  v_state    text;
  v_account  uuid;
  v_name     text;
  v_platform text;
  v_version  text;
  v_expires  timestamptz;
  v_polled   timestamptz;
  v_device   uuid;
  v_email    text;
BEGIN
  IF v_code IS NULL OR octet_length(v_code) <> 32
     OR v_token IS NULL OR octet_length(v_token) <> 32 THEN
    RAISE EXCEPTION 'auth_collect_pairing: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The row lock makes the device code single use: a second poll waits and then finds no row.
  SELECT p.id, p.state, p.account_id, p.device_name, p.platform, p.version, p.expires_at,
         p.last_polled_at
    INTO v_id, v_state, v_account, v_name, v_platform, v_version, v_expires, v_polled
  FROM player.pairings p WHERE p.device_code_hash = v_code FOR UPDATE;
  IF v_id IS NULL OR v_expires <= now() THEN
    state := 'expired_token';
    RETURN NEXT;
    RETURN;
  END IF;
  -- One poll per 5 seconds per device code. A poll that came too soon is not counted as one.
  IF v_polled IS NOT NULL AND v_polled > now() - interval '5 seconds' THEN
    state := 'slow_down';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_state <> 'approved' THEN
    UPDATE player.pairings p SET last_polled_at = now() WHERE p.id = v_id;
    state := CASE v_state WHEN 'denied' THEN 'access_denied' ELSE 'authorization_pending' END;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO player.devices (account_id, token_hash, name, platform, version)
  VALUES (v_account, v_token, v_name, v_platform, v_version)
  RETURNING id INTO v_device;
  DELETE FROM player.pairings p WHERE p.id = v_id;
  SELECT a.email INTO v_email FROM player.accounts a WHERE a.id = v_account;
  INSERT INTO player.audit_events
    (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
  VALUES (v_account, 'device.created', 'device', v_device, (v_client).network,
          coalesce(left((v_client).family, 40), ''),
          jsonb_build_object('platform', v_platform, 'version', v_version));
  state := 'ok';
  email := v_email;
  RETURN NEXT;
END
$$;

-- Finds a device by its token hash. Only for the state `ok` it writes "last used" (at most once
-- every 5 minutes), sets the account for this transaction and returns the device's id. A revoked
-- device answers `revoked` for 90 days; after that, and for a device never used within 24 hours
-- of pairing, the row counts as deleted whether or not the purge has run: `unknown`.
CREATE OR REPLACE FUNCTION player.auth_enter_device(token_hash bytea)
RETURNS TABLE (device_id uuid, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_hash    bytea := auth_enter_device.token_hash;
  v_id      uuid;
  v_account uuid;
  v_created timestamptz;
  v_used    timestamptz;
  v_revoked timestamptz;
BEGIN
  PERFORM set_config('app.account_id', '', true);
  SELECT d.id, d.account_id, d.created_at, d.last_used_at, d.revoked_at
    INTO v_id, v_account, v_created, v_used, v_revoked
  FROM player.devices d WHERE d.token_hash = v_hash;
  state := CASE
    WHEN v_id IS NULL THEN 'unknown'
    WHEN v_revoked IS NOT NULL AND v_revoked < now() - interval '90 days' THEN 'unknown'
    WHEN v_revoked IS NOT NULL THEN 'revoked'
    WHEN v_used IS NULL AND v_created < now() - interval '24 hours' THEN 'unknown'
    WHEN coalesce(v_used, v_created) < now() - interval '180 days' THEN 'expired'
    ELSE 'ok'
  END;
  IF state = 'ok' THEN
    IF v_used IS NULL OR v_used < now() - interval '5 minutes' THEN
      UPDATE player.devices d SET last_used_at = now() WHERE d.id = v_id;
    END IF;
    PERFORM set_config('app.account_id', v_account::text, true);
    device_id := v_id;
  END IF;
  RETURN NEXT;
END
$$;
