-- ADR 0002, sections 9 and 10, and principle 7: the device token's request limits, counted
-- inside auth_enter_device with their numbers as constants, not passed in by the backend.
--
-- As in 0004, 0006 and 0008: CREATE OR REPLACE keeps the function's owner (player_auth) and its
-- rights (no EXECUTE for PUBLIC, EXECUTE for player_app); SECURITY DEFINER and the search_path
-- are restated; a parameter is read once, by its qualified name, into a `v_` variable. The same
-- signature and the same result: no grant, no table and no new function.
--
-- Two budgets per device token, each a fixed window of one minute:
--   `documents`: reads of one class's document, 600 a minute, so a first sync of a large
--                library takes minutes, not half an hour;
--   anything else (sync pages, the cursor, the device's own routes): 60 a minute.
-- The backend names the budget of its request in the transaction-local setting
-- `app.device_budget` before this call (db/devices.py). Any value but `documents`, or none,
-- is the general budget of 60. The function clears the setting when it has read it. Either way
-- the backend can choose only between these two constants.
--
-- The counters' keys are what player_backend.bearer_policy makes: SHA-256 of
-- 'device.requests:' or 'device.documents:' and the token hash, so a counter in its window when
-- this migration runs goes on counting.
--
-- Over its limit a working token answers `limited`: "last used" has been written, the request
-- has been counted, and no account is set. Everything else is as in 0006.
CREATE OR REPLACE FUNCTION player.auth_enter_device(token_hash bytea)
RETURNS TABLE (device_id uuid, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_hash    bytea := auth_enter_device.token_hash;
  v_budget  text := current_setting('app.device_budget', true);
  v_id      uuid;
  v_account uuid;
  v_created timestamptz;
  v_used    timestamptz;
  v_revoked timestamptz;
  v_over    boolean;
BEGIN
  PERFORM set_config('app.account_id', '', true);
  PERFORM set_config('app.device_budget', '', true);
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
    IF v_budget = 'documents' THEN
      v_over := player.rate_limit_hit(
        sha256(convert_to('device.documents:', 'UTF8') || v_hash), interval '1 minute', 600);
    ELSE
      v_over := player.rate_limit_hit(
        sha256(convert_to('device.requests:', 'UTF8') || v_hash), interval '1 minute', 60);
    END IF;
    IF v_over THEN
      state := 'limited';
    ELSE
      PERFORM set_config('app.account_id', v_account::text, true);
      device_id := v_id;
    END IF;
  END IF;
  RETURN NEXT;
END
$$;
