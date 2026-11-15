-- ADR 0010, sections 8 and 9 (#496): the events classbeat sends.
--
-- - player_auth gains DELETE on accounts, for `account-deleted` (section 9). The cascade runs
--   as the tables' owner, as for every account deletion (ADR 0002, section 12).
-- - auth_classbeat_event: one checked event, by the hash of its `jti`, the identity it names
--   and its kind. The backend checks the token; the database only acts on what it is given.
--
-- As in 0014: SECURITY DEFINER and the search_path are stated; a parameter is read once, by its
-- qualified name, into a `v_` variable. The numbers are constants here (ADR 0002, principle 7):
-- a `jti` is kept for 8 days, longer than classbeat's 7 days of retries; the hourly purge of
-- 0014 removes it after that.

GRANT DELETE ON player.accounts TO player_auth;

-- Returns `repeat` (the `jti` was seen: nothing changes), `no_account` (no instructor has that
-- identity: nothing changes but the `jti`, kept so a replay of it is a repeat too), `deleted` or
-- `revoked`. `account_deleted` deletes the account row; everything it owns goes by cascade, its
-- events with it, so no event is written. `sessions_revoked` ends every site session of the
-- account and writes one "all sessions ended" event with `by: classbeat`; devices are kept.
-- Both send the account's `live_revocations` notice, delivered at commit. No event holds the
-- `jti` or the subject.
CREATE FUNCTION player.auth_classbeat_event(
  jti_hash bytea, issuer text, subject text, event text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
DECLARE
  v_jti     bytea := auth_classbeat_event.jti_hash;
  v_issuer  text  := auth_classbeat_event.issuer;
  v_subject text  := auth_classbeat_event.subject;
  v_event   text  := auth_classbeat_event.event;
  v_account uuid;
  v_ended   integer;
BEGIN
  IF v_jti IS NULL OR octet_length(v_jti) <> 32
     OR v_issuer IS NULL OR length(v_issuer) NOT BETWEEN 1 AND 255
     OR v_subject IS NULL OR length(v_subject) NOT BETWEEN 1 AND 255
     OR v_event IS NULL OR v_event NOT IN ('account_deleted', 'sessions_revoked') THEN
    RAISE EXCEPTION 'auth_classbeat_event: bad arguments'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO player.classbeat_event_ids (jti_hash, expires_at)
  VALUES (v_jti, now() + interval '8 days')
  ON CONFLICT ON CONSTRAINT classbeat_event_ids_pkey DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'repeat';
  END IF;

  SELECT a.id INTO v_account
  FROM player.accounts a
  WHERE a.kind = 'instructor' AND a.classbeat_issuer = v_issuer
    AND a.classbeat_subject = v_subject;
  IF v_account IS NULL THEN
    RETURN 'no_account';
  END IF;

  IF v_event = 'account_deleted' THEN
    DELETE FROM player.accounts a WHERE a.id = v_account;
    PERFORM pg_notify('live_revocations', v_account::text);
    RETURN 'deleted';
  END IF;

  WITH ended AS (
    DELETE FROM player.sessions s WHERE s.account_id = v_account RETURNING s.id
  )
  SELECT count(*) INTO v_ended FROM ended;
  PERFORM pg_notify('live_revocations', v_account::text);
  INSERT INTO player.audit_events (account_id, event, detail)
  VALUES (v_account, 'session.all_ended',
          jsonb_build_object('by', 'classbeat', 'sessions', v_ended));
  RETURN 'revoked';
END
$$;

-- Owner, PUBLIC and player_app, as 0014 does for its functions.
GRANT CREATE ON SCHEMA player TO player_auth;
ALTER FUNCTION player.auth_classbeat_event(bytea, text, text, text) OWNER TO player_auth;
REVOKE CREATE ON SCHEMA player FROM player_auth;
REVOKE ALL ON FUNCTION player.auth_classbeat_event(bytea, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player.auth_classbeat_event(bytea, text, text, text) TO player_app;
