-- Database init (ADR 0002, sections 9 and 11). Runs once, as the bootstrap superuser, inside the
-- backend's database, before any migration. Creates the three roles and nothing else that holds
-- data. Passwords are not set here: the deploy sets them from secret files (README, "Roles").
-- Run with `psql -v ON_ERROR_STOP=1`.
--
--   player_owner  migrations and the operator's commands; owns the schema and the tables
--   player_app    the running backend; LOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing
--   player_auth   owner of the SECURITY DEFINER functions; NOLOGIN, BYPASSRLS
CREATE ROLE player_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE player_auth NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
  NOINHERIT;
CREATE ROLE player_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
  NOINHERIT;

-- player_owner is player_auth's only member, so that migrations can create its functions.
GRANT player_auth TO player_owner;

-- player_owner owns the database, so migrations can create the schema. Nobody else may connect
-- or create temporary objects (a temporary table could otherwise shadow a real one).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO player_owner', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO player_app', current_database());
END
$$;

-- No statement of player_app is logged for its text or duration, and no parameter value is
-- ever logged, so token hashes passed to the functions never reach the database's log.
ALTER ROLE player_app SET log_statement = 'none';
ALTER ROLE player_app SET log_min_duration_statement = -1;
ALTER ROLE player_app SET log_parameter_max_length = 0;
ALTER ROLE player_app SET log_parameter_max_length_on_error = 0;
