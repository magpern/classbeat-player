-- #739: auth_purge_expired() says how many rows it removed, one row per kind, in a fixed order
-- and with every kind present (0 when nothing went). A kind is the table's name; nothing else of
-- a row leaves the function.
--
-- The deletes and the retention periods are those of 0014's version, unchanged and in the same
-- order. The return type changes, which CREATE OR REPLACE cannot do, so the function is dropped
-- and created again in this one transaction, and its owner and rights are set back exactly as
-- 0003 set them: SECURITY DEFINER, the same search_path, owned by player_auth, not executable by
-- PUBLIC, executable by player_app (and so by player_owner, as a member of player_auth).

DROP FUNCTION player.auth_purge_expired();

CREATE FUNCTION player.auth_purge_expired()
RETURNS TABLE (kind text, removed bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
BEGIN
  DELETE FROM player.login_links         WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'login_links';         RETURN NEXT;
  DELETE FROM player.login_challenges    WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'login_challenges';    RETURN NEXT;
  DELETE FROM player.pairings            WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'pairings';            RETURN NEXT;
  DELETE FROM player.source_link_codes   WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'source_link_codes';   RETURN NEXT;
  DELETE FROM player.rate_limits         WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'rate_limits';         RETURN NEXT;
  DELETE FROM player.classbeat_sign_ins  WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'classbeat_sign_ins';  RETURN NEXT;
  DELETE FROM player.classbeat_event_ids WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'classbeat_event_ids'; RETURN NEXT;
  DELETE FROM player.sessions
    WHERE last_used_at < now() - interval '14 days' OR created_at < now() - interval '60 days';
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'sessions';            RETURN NEXT;
  DELETE FROM player.devices
    WHERE revoked_at < now() - interval '90 days'
       OR (last_used_at IS NULL AND created_at < now() - interval '24 hours');
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'devices';             RETURN NEXT;
  DELETE FROM player.audit_events        WHERE occurred_at < now() - interval '180 days';
  GET DIAGNOSTICS removed = ROW_COUNT; kind := 'audit_events';        RETURN NEXT;
END
$$;

-- Owner, PUBLIC and player_app, as 0003 and 0014 set them.
GRANT CREATE ON SCHEMA player TO player_auth;
ALTER FUNCTION player.auth_purge_expired() OWNER TO player_auth;
REVOKE CREATE ON SCHEMA player FROM player_auth;
REVOKE ALL ON FUNCTION player.auth_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player.auth_purge_expired() TO player_app;
