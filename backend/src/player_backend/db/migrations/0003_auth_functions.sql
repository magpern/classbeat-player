-- ADR 0002, section 9: the complete, fixed list of SECURITY DEFINER functions. Adding one is a
-- security-critical change, and the guard test fails until it is listed there too.
--
-- Each is owned by player_auth, has `SET search_path = pg_catalog, player, pg_temp` (pg_temp
-- last), is not executable by PUBLIC and is executable by player_app. The bodies come in later
-- PL2 issues; until then every one but auth_purge_expired fails closed: it raises and changes
-- nothing, so no caller can get a session, a device or an account out of it.

-- The client as the backend saw it (section 11): the shortened address and the family.
CREATE TYPE player.client_info AS (network cidr, family text);

CREATE FUNCTION player.auth_enter_session(token_hash bytea)
RETURNS TABLE (session_id uuid, signed_in_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_enter_session is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_enter_device(token_hash bytea)
RETURNS TABLE (device_id uuid, state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_enter_device is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_enter_source(token_hash bytea)
RETURNS TABLE (link_id uuid, source_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_enter_source is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_device_active(token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_device_active is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_session_active(token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_session_active is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_request_login(
  email text, link_hash bytea, browser_hash bytea, address_hash bytea, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_request_login is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_complete_login(
  link_hash bytea, browser_hash bytea, session_hash bytea, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_complete_login is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_new_login_challenge(challenge_hash bytea, browser_hash bytea)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_new_login_challenge is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_passkey_for_login(credential_id bytea)
RETURNS TABLE (public_key bytea, sign_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_passkey_for_login is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_complete_passkey(
  credential_id bytea, challenge_hash bytea, browser_hash bytea, counter bigint,
  session_hash bytea, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_complete_passkey is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_start_pairing(
  device_code_hash bytea, user_code_hash bytea, platform text, version text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_start_pairing is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_find_pairing(user_code_hash bytea)
RETURNS TABLE (platform text, version text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_find_pairing is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_decide_pairing(
  user_code_hash bytea, approve boolean, name text, client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_decide_pairing is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_collect_pairing(
  device_code_hash bytea, device_token_hash bytea, client player.client_info)
RETURNS TABLE (state text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_collect_pairing is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_new_link_code(
  code_hash bytea, source text, redirect text, challenge text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_new_link_code is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.auth_exchange_link_code(
  code_hash bytea, source text, redirect text, verifier text, token_hash bytea,
  client player.client_info)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'auth_exchange_link_code is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

CREATE FUNCTION player.rate_limit_hit(key_hash bytea, window_length interval, max_hits integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$ BEGIN RAISE EXCEPTION 'rate_limit_hit is not implemented'
  USING ERRCODE = 'feature_not_supported'; END $$;

-- Full body: removes only what is past its time. The periods are ADR 0002's defaults (sessions
-- 14 days idle or 60 days in all; revoked devices kept 90 days; a device never used is gone after
-- 24 hours; events kept 180 days). Later issues may pass them in from the settings.
CREATE FUNCTION player.auth_purge_expired()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, player, pg_temp
AS $$
BEGIN
  DELETE FROM player.login_links       WHERE expires_at < now();
  DELETE FROM player.login_challenges  WHERE expires_at < now();
  DELETE FROM player.pairings          WHERE expires_at < now();
  DELETE FROM player.source_link_codes WHERE expires_at < now();
  DELETE FROM player.rate_limits       WHERE expires_at < now();
  DELETE FROM player.sessions
    WHERE last_used_at < now() - interval '14 days' OR created_at < now() - interval '60 days';
  DELETE FROM player.devices
    WHERE revoked_at < now() - interval '90 days'
       OR (last_used_at IS NULL AND created_at < now() - interval '24 hours');
  DELETE FROM player.audit_events      WHERE occurred_at < now() - interval '180 days';
END
$$;

-- Owner, PUBLIC and player_app, the same for every function above. player_auth gets CREATE on
-- the schema only for as long as the ownership change needs it.
GRANT CREATE ON SCHEMA player TO player_auth;
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'player'::regnamespace AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO player_auth', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO player_app', fn);
  END LOOP;
END
$$;
REVOKE CREATE ON SCHEMA player FROM player_auth;
