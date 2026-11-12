"""Ordered plain-SQL migrations, run as player_owner (ADR 0002, section 9).

Files in `migrations/` named `NNNN_name.sql` run once each, in order, each in its own transaction
together with its row in the ledger `player_meta.schema_migrations`. An applied file that has
changed since is refused. Run: `uv run python -m player_backend.db.migrate` with
`PLAYER_DATABASE_OWNER_URL` set.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).with_name("migrations")
_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

# The ledger lives in its own schema, with row-level security forced like every table, and one
# policy for player_owner alone. No other role has any right on it.
_LEDGER = b"""
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
_LOCK = "SELECT pg_advisory_xact_lock(7270001)"
_APPLIED = "SELECT version, sha256 FROM player_meta.schema_migrations"
_RECORD = "INSERT INTO player_meta.schema_migrations (version, name, sha256) VALUES (%s, %s, %s)"


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    body: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()


def load_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    found: list[Migration] = []
    for path in sorted(directory.iterdir()):
        if path.suffix != ".sql":
            continue
        match = _NAME.match(path.name)
        if match is None:
            raise MigrationError(f"bad migration file name: {path.name}")
        found.append(Migration(int(match.group(1)), path.name, path.read_bytes()))
    versions = [m.version for m in found]
    if versions != list(range(1, len(found) + 1)):
        raise MigrationError("migration versions must be 0001, 0002, ... without gaps")
    return found


def apply_migrations(conn: psycopg.Connection[tuple[object, ...]]) -> list[str]:
    """Apply what is pending on `conn` (connected as, or set to, player_owner)."""
    applied_now: list[str] = []
    with conn.transaction():
        conn.execute(_LOCK)
        conn.execute(_LEDGER)
    for migration in load_migrations():
        with conn.transaction():
            conn.execute(_LOCK)
            applied = {int(str(v)): str(h) for v, h in conn.execute(_APPLIED).fetchall()}
            if migration.version in applied:
                if applied[migration.version] != migration.sha256:
                    raise MigrationError(f"applied migration changed: {migration.name}")
                continue
            # A trusted file shipped in this package, run as a whole. Not built from strings.
            conn.execute(migration.body)
            conn.execute(_RECORD, (migration.version, migration.name, migration.sha256))
            applied_now.append(migration.name)
    return applied_now


def main() -> int:
    url = os.environ.get("PLAYER_DATABASE_OWNER_URL", "").strip()
    if not url:
        print("PLAYER_DATABASE_OWNER_URL is required", file=sys.stderr)
        return 2
    with psycopg.connect(url, autocommit=True) as conn:
        for name in apply_migrations(conn):
            print(f"applied {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
