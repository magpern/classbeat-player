"""Ordered plain-SQL migrations, run as player_owner (ADR 0002, section 9).

Files in `migrations/` named `NNNN_name.sql` run once each, in order, each in its own transaction
together with its row in the ledger `player_meta.schema_migrations`. An applied file that has
changed since is refused. Every file is a constant of `queries.migrations` and has its own step
below: a new file needs a new constant and a new step (a test fails until both exist). Run:
`uv run python -m player_backend.db.migrate` with `PLAYER_DATABASE_OWNER_URL` set.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

import psycopg

from player_backend.db.queries import migrations as q
from player_backend.db.sqlfile import SQL_DIR, sql_file

_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

type Conn = psycopg.Connection[tuple[object, ...]]


class MigrationError(RuntimeError):
    pass


def load_migrations(directory: Path = SQL_DIR) -> list[str]:
    """The migration file names, checked to be numbered 0001, 0002, ... without gaps."""
    names: list[str] = []
    for path in sorted(directory.iterdir()):
        if path.suffix != ".sql":
            continue
        if _NAME.match(path.name) is None:
            raise MigrationError(f"bad migration file name: {path.name}")
        names.append(path.name)
    if [int(n[:4]) for n in names] != list(range(1, len(names) + 1)):
        raise MigrationError("migration versions must be 0001, 0002, ... without gaps")
    return names


def sha256(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


@contextmanager
def _step(conn: Conn, done: list[str], name: str) -> Generator[bool]:
    """One migration's transaction. Yields whether it is still to be applied.

    The step's body executes the file's constant of `queries.migrations`; a test checks that the
    constant is the file's content and that the steps follow the files in order.
    """
    version = int(name[:4])
    digest = sha256(sql_file(name))
    with conn.transaction():
        conn.execute(q.LOCK)
        applied = {int(str(v)): str(h) for v, h in conn.execute(q.APPLIED).fetchall()}
        if version in applied:
            if applied[version] != digest:
                raise MigrationError(f"applied migration changed: {name}")
            yield False
            return
        yield True
        conn.execute(q.RECORD, (version, name, digest))
        done.append(name)


def apply_migrations(conn: Conn) -> list[str]:
    """Apply what is pending on `conn` (connected as, or set to, player_owner)."""
    done: list[str] = []
    with conn.transaction():
        conn.execute(q.LOCK)
        conn.execute(q.LEDGER)
    with _step(conn, done, "0001_tables.sql") as pending:
        if pending:
            conn.execute(q.M0001_TABLES)
    with _step(conn, done, "0002_policies_and_grants.sql") as pending:
        if pending:
            conn.execute(q.M0002_POLICIES_AND_GRANTS)
    with _step(conn, done, "0003_auth_functions.sql") as pending:
        if pending:
            conn.execute(q.M0003_AUTH_FUNCTIONS)
    return done


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
