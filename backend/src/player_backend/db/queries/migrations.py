"""SQL of the migration runner (player_backend/db/migrate.py), and the migration files."""

from typing import Final

from player_backend.db.executor import Query

M0001_TABLES: Final[Query] = Query.from_file("0001_tables.sql")
M0002_POLICIES_AND_GRANTS: Final[Query] = Query.from_file("0002_policies_and_grants.sql")
M0003_AUTH_FUNCTIONS: Final[Query] = Query.from_file("0003_auth_functions.sql")
M0004_LOGIN_AND_SESSIONS: Final[Query] = Query.from_file("0004_login_and_sessions.sql")
M0005_SIGN_IN_HARDENING: Final[Query] = Query.from_file("0005_sign_in_hardening.sql")
M0006_PAIRING_AND_DEVICES: Final[Query] = Query.from_file("0006_pairing_and_devices.sql")
M0007_PAIRING_HARDENING: Final[Query] = Query.from_file("0007_pairing_hardening.sql")

# The ledger lives in its own schema, with row-level security forced like every table, and one
# policy for player_owner alone. No other role has any right on it.
LEDGER: Final[Query] = Query(
    """
CREATE SCHEMA IF NOT EXISTS player_meta;
REVOKE ALL ON SCHEMA player_meta FROM PUBLIC;
CREATE TABLE IF NOT EXISTS player_meta.schema_migrations (
  version    integer PRIMARY KEY,
  name       text NOT NULL,
  sha256     text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_meta.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_meta.schema_migrations FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                 WHERE polrelid = 'player_meta.schema_migrations'::regclass) THEN
    CREATE POLICY migrator ON player_meta.schema_migrations
      TO player_owner USING (true) WITH CHECK (true);
  END IF;
END
$$;
"""
)

LOCK: Final[Query] = Query("SELECT pg_advisory_xact_lock(7270001)")

APPLIED: Final[Query] = Query("SELECT version, sha256 FROM player_meta.schema_migrations")

RECORD: Final[Query] = Query(
    "INSERT INTO player_meta.schema_migrations (version, name, sha256) VALUES (%s, %s, %s)"
)
