"""Fixtures for a throwaway PostgreSQL 17.

`PLAYER_TEST_DATABASE_URL` is a superuser URL to a throwaway server (never a real one): the
fixtures drop and create the roles of ADR 0002 and a database `player_test` on it. Without it the
database tests skip, unless `PLAYER_REQUIRE_DATABASE=1` (set by `ci.sh`), when they fail.

The tests read the catalogue and seed rows with a driver of their own. The backend's code under
test gets what it gets in production: a handle from the executor, connected as `player_owner`
with a password made up for this run.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from player_backend.db.executor import Handle, connect
from player_backend.db.migrate import apply_migrations
from tests.dbhelp import ROLES, Conn

BACKEND = Path(__file__).resolve().parents[1]
INIT_SQL = BACKEND / "db" / "init" / "10-roles.sql"
TEST_DB = "player_test"


def _admin_url() -> str:
    url = os.environ.get("PLAYER_TEST_DATABASE_URL", "").strip()
    if not url:
        if os.environ.get("PLAYER_REQUIRE_DATABASE") == "1":
            pytest.fail("PLAYER_TEST_DATABASE_URL is required (PLAYER_REQUIRE_DATABASE=1)")
        pytest.skip("PLAYER_TEST_DATABASE_URL is not set")
    return url


def _reset_cluster(admin: Conn) -> None:
    row = admin.execute(
        "SELECT current_setting('server_version_num')::int, usesuper "
        "FROM pg_user WHERE usename = current_user"
    ).fetchone()
    assert row is not None
    version, superuser = row
    assert isinstance(version, int) and 170000 <= version < 180000, "PostgreSQL 17 is required"
    assert superuser is True, "PLAYER_TEST_DATABASE_URL must be a superuser of a throwaway server"
    admin.execute("DROP DATABASE IF EXISTS player_test WITH (FORCE)")
    for role in ROLES:
        admin.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role)))
    admin.execute("CREATE DATABASE player_test")


@pytest.fixture(scope="session")
def _urls() -> tuple[str, str]:  # pyright: ignore[reportUnusedFunction]
    """Superuser and player_owner URLs to `player_test`, after the init script and migrations."""
    admin_url = _admin_url()
    with psycopg.connect(admin_url, autocommit=True) as admin:
        _reset_cluster(admin)
    params = {k: str(v) for k, v in conninfo_to_dict(admin_url).items() if v is not None}
    params["dbname"] = TEST_DB
    url = make_conninfo("", **params)
    password = secrets.token_hex(16)
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(INIT_SQL.read_bytes())
        conn.execute(sql.SQL("ALTER ROLE player_owner PASSWORD {}").format(sql.Literal(password)))
    owner_url = make_conninfo("", **{**params, "user": "player_owner", "password": password})
    with connect(owner_url) as db:
        apply_migrations(db)
    return url, owner_url


@pytest.fixture(scope="session")
def db_url(_urls: tuple[str, str]) -> str:
    """A superuser URL to `player_test`, for the tests' own driver."""
    return _urls[0]


@pytest.fixture(scope="session")
def owner_url(_urls: tuple[str, str]) -> str:
    """A player_owner URL to `player_test`, for the executor."""
    return _urls[1]


@pytest.fixture
def owner_db(owner_url: str) -> Iterator[Handle]:
    """A handle from the executor, connected as player_owner (autocommit)."""
    with connect(owner_url) as db:
        yield db


@pytest.fixture
def su(db_url: str) -> Iterator[Conn]:
    """A superuser connection to `player_test`; each test runs in a transaction rolled back."""
    with psycopg.connect(db_url) as conn:
        yield conn
        conn.rollback()
