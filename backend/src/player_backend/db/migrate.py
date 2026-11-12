"""Ordered plain-SQL migrations, run as player_owner (ADR 0002, section 9).

Files in `migrations/` named `NNNN_name.sql` run once each, in order, each in its own transaction
together with its row in the ledger `player_meta.schema_migrations`. An applied file that has
changed since is refused. Every file is a `Query` of `queries.migrations` and has its own step
below: a new file needs its name in the executor's fixed list, a new constant and a new step (a
test fails until all three exist). The runner gets a handle from the executor and never sees a
connection. Run: `uv run python -m player_backend.db.migrate` with `PLAYER_DATABASE_OWNER_URL`.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from player_backend.db.executor import SQL_DIR, Handle, connect
from player_backend.db.queries import migrations as q

_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


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
def _step(db: Handle, done: list[str], name: str) -> Generator[bool]:
    """One migration's transaction. Yields whether it is still to be applied.

    The step's body runs the file's `Query` of `queries.migrations`; a test checks that the
    registry's text for it is the file's content and that the steps follow the files in order.
    """
    version = int(name[:4])
    digest = sha256((SQL_DIR / name).read_text(encoding="utf-8"))
    with db.transaction():
        db.rows(q.LOCK)
        applied = {int(str(v)): str(h) for v, h in db.rows(q.APPLIED)}
        if version in applied:
            if applied[version] != digest:
                raise MigrationError(f"applied migration changed: {name}")
            yield False
            return
        yield True
        db.rows(q.RECORD, (version, name, digest))
        done.append(name)


def apply_migrations(db: Handle) -> list[str]:
    """Apply what is pending through `db`, a handle connected as player_owner."""
    done: list[str] = []
    with db.transaction():
        db.rows(q.LOCK)
        db.rows(q.LEDGER)
    with _step(db, done, "0001_tables.sql") as pending:
        if pending:
            db.rows(q.M0001_TABLES)
    with _step(db, done, "0002_policies_and_grants.sql") as pending:
        if pending:
            db.rows(q.M0002_POLICIES_AND_GRANTS)
    with _step(db, done, "0003_auth_functions.sql") as pending:
        if pending:
            db.rows(q.M0003_AUTH_FUNCTIONS)
    with _step(db, done, "0004_login_and_sessions.sql") as pending:
        if pending:
            db.rows(q.M0004_LOGIN_AND_SESSIONS)
    with _step(db, done, "0005_sign_in_hardening.sql") as pending:
        if pending:
            db.rows(q.M0005_SIGN_IN_HARDENING)
    with _step(db, done, "0006_pairing_and_devices.sql") as pending:
        if pending:
            db.rows(q.M0006_PAIRING_AND_DEVICES)
    with _step(db, done, "0008_source_api.sql") as pending:
        if pending:
            db.rows(q.M0008_SOURCE_API)
    return done


def main() -> int:
    url = os.environ.get("PLAYER_DATABASE_OWNER_URL", "").strip()
    if not url:
        print("PLAYER_DATABASE_OWNER_URL is required", file=sys.stderr)
        return 2
    with connect(url) as db:
        for name in apply_migrations(db):
            print(f"applied {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
