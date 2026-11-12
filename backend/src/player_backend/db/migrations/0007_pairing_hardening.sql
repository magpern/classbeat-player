-- ADR 0002, sections 6, 10 and 11: pairing hardening from the review of the pairing migration
-- (0006). One function body is replaced; nothing else changes: no table, grant, role, signature
-- or new function. CREATE OR REPLACE keeps the function's owner (player_auth) and its rights (no
-- EXECUTE for PUBLIC, EXECUTE for player_app); SECURITY DEFINER and the search_path are restated,
-- as in 0006. The numbers are ADR 0002's defaults, constants in the body (principle 7): 5 wrong
-- codes per account in 15 minutes close the form for 15 minutes, at most 10 active devices per
-- account, a device token ends after 180 days without use, a device never used is gone after 24
-- hours.
--
-- auth_decide_pairing: an approval above the cap of devices returns NULL, where 0006 returned
-- false like for a wrong code. The caller can then tell the user that the account holds too
-- many devices, also when pairings that are approved and not collected yet fill the cap, which
-- only this function can see. Nothing else in the body differs from 0006: the refusal still
-- leaves the pairing pending, still writes the account's `pairing.refused` event and is still
-- not counted as a wrong code. NULL is not true, so a caller that only asks "was it decided?"
-- answers as before.

-- Decide, for the account already set only: approves or denies that pending pairing and writes
-- the account's event. Returns true when the pairing was decided; false for a code that matches
-- no pending pairing (counted as a wrong code, as in auth_find_pairing), for a closed form and
-- with no account set; NULL for an approval above 10 active devices, which is refused, leaves
-- the pairing pending and writes `pairing.refused`. Pairings the account has approved and whose
-- token is not collected yet count as devices, so the cap holds at the collection.
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
    -- Neither decided nor a wrong code: the caller answers that the account is at its cap.
    RETURN NULL;
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
