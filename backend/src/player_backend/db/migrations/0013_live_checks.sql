-- ADR 0002, sections 8 and 9, and ADR 0005, section 2: the bodies of auth_device_active and
-- auth_session_active, the live process's re-check every 30 seconds and on a `live_revocations`
-- notice. Each answers whether a token still works, from the database alone: it sets no account,
-- writes no "last used", counts no budget and writes no event.
--
-- As in 0004, 0006 and 0009: CREATE OR REPLACE keeps each function's owner (player_auth) and its
-- rights (no EXECUTE for PUBLIC, EXECUTE for player_app); SECURITY DEFINER and the search_path
-- are restated; a parameter is read once, by its qualified name, into a `v_` variable. The same
-- signatures and results: no grant, no table and no new function.
--
-- The lifetimes are ADR 0002's, constants here as in the functions they mirror (principle 7),
-- changed only by a later migration:
--   a device token is active when auth_enter_device would answer `ok` before its budget: not
--   revoked, used within 180 days, and used at least once or paired within 24 hours;
--   a session token is active when auth_enter_session would find it: used within 14 days and
--   created within 60 days.
-- A deleted account's devices and sessions are gone with it, so neither answers true.

CREATE OR REPLACE FUNCTION player.auth_device_active(token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_hash bytea := auth_device_active.token_hash;
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM player.devices d
    WHERE d.token_hash = v_hash
      AND d.revoked_at IS NULL
      AND (d.last_used_at IS NOT NULL OR d.created_at >= now() - interval '24 hours')
      AND coalesce(d.last_used_at, d.created_at) >= now() - interval '180 days');
END
$$;

CREATE OR REPLACE FUNCTION player.auth_session_active(token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_hash bytea := auth_session_active.token_hash;
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM player.sessions s
    WHERE s.token_hash = v_hash
      AND s.last_used_at > now() - interval '14 days'
      AND s.created_at > now() - interval '60 days');
END
$$;
