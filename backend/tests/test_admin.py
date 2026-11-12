"""The operator's commands (admin.py, db/operator.py) against the test database.

They run as player_owner and nothing else, change the allowlist through its one policy, and
purge through `auth_purge_expired()`. A database error shows its type, never its message.
"""

from __future__ import annotations

import io
import secrets
from collections.abc import Iterator

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from player_backend.admin import main
from tests.dbhelp import Conn

pytestmark = pytest.mark.usefixtures("owner_url")


def _run(*argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(argv), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


@pytest.fixture
def as_owner(monkeypatch: pytest.MonkeyPatch, owner_url: str) -> None:
    monkeypatch.delenv("PLAYER_DATABASE_URL", raising=False)
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", owner_url)


@pytest.fixture
def email(db_url: str) -> Iterator[str]:
    """A fresh address; its allowlist row is removed afterwards."""
    address = f"op-{secrets.token_hex(4)}@example.test"
    yield address
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("DELETE FROM player.signup_allowlist WHERE email = %s", (address,))


def _listed(db_url: str, address: str) -> bool:
    with psycopg.connect(db_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT count(*) FROM player.signup_allowlist WHERE email = %s", (address,)
        ).fetchone()
    return row == (1,)


@pytest.mark.usefixtures("as_owner")
def test_allowlist_add_list_remove(db_url: str, email: str) -> None:
    assert _run("allowlist", "add", f"  {email.upper()} ") == (0, f"added: {email}\n", "")
    assert _listed(db_url, email)
    assert _run("allowlist", "add", email) == (0, f"already listed: {email}\n", "")
    code, out, _ = _run("allowlist", "list")
    assert code == 0 and any(line.split("\t")[0] == email for line in out.splitlines())
    assert _run("allowlist", "remove", email) == (0, f"removed: {email}\n", "")
    assert not _listed(db_url, email)
    assert _run("allowlist", "remove", email) == (0, f"not listed: {email}\n", "")


@pytest.mark.usefixtures("as_owner")
def test_a_listed_email_can_sign_up(su: Conn, email: str) -> None:
    # The sign-in function reads the row the command wrote: the same table, through its rules.
    assert _run("allowlist", "add", email)[0] == 0
    row = su.execute(
        "SELECT EXISTS (SELECT 1 FROM player.signup_allowlist WHERE email = %s)", (email,)
    ).fetchone()
    assert row == (True,)


@pytest.mark.usefixtures("as_owner")
@pytest.mark.parametrize("typed", ["not-an-email", "two words@example.test", "@example.test"])
def test_not_an_email_is_refused_before_connecting(
    monkeypatch: pytest.MonkeyPatch, typed: str
) -> None:
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", "postgresql://nobody@127.0.0.1:1/none")
    assert _run("allowlist", "add", typed) == (2, "", "not an email address\n")


def test_the_owner_url_is_required(monkeypatch: pytest.MonkeyPatch, app_url: str) -> None:
    # The running backend's credential is there, and is not used.
    monkeypatch.delenv("PLAYER_DATABASE_OWNER_URL", raising=False)
    monkeypatch.setenv("PLAYER_DATABASE_URL", app_url)
    assert _run("purge") == (2, "", "PLAYER_DATABASE_OWNER_URL is required\n")


def test_the_app_role_is_refused(
    monkeypatch: pytest.MonkeyPatch, app_url: str, db_url: str, email: str
) -> None:
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", app_url)
    for argv in (("allowlist", "add", email), ("allowlist", "list"), ("purge",)):
        code, out, err = _run(*argv)
        assert (code, out) == (1, "")
        assert err == "the commands run as player_owner, not as player_app\n"
    assert not _listed(db_url, email)


def test_a_database_error_shows_no_message_or_password(
    monkeypatch: pytest.MonkeyPatch, owner_url: str
) -> None:
    # A database that does not exist fails whatever the server's authentication: its message
    # would name it, and the URL holds the password.
    missing, wrong = f"no_such_{secrets.token_hex(6)}", secrets.token_hex(12)
    params = {k: str(v) for k, v in conninfo_to_dict(owner_url).items() if v is not None}
    url = make_conninfo("", **{**params, "dbname": missing, "password": wrong})
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", url)
    code, out, err = _run("allowlist", "list")
    assert (code, out) == (1, "")
    assert err.startswith("database error: DatabaseError")
    assert missing not in err and wrong not in err and "player_owner" not in err


@pytest.mark.usefixtures("as_owner")
def test_purge_removes_what_is_past_its_time(db_url: str) -> None:
    old, fresh = secrets.token_bytes(32), secrets.token_bytes(32)
    with psycopg.connect(db_url, autocommit=True) as conn:
        for key, expires in ((old, "-1 minute"), (fresh, "1 hour")):
            conn.execute(
                "INSERT INTO player.rate_limits (key_hash, window_start, hits, expires_at) "
                "VALUES (%s, now(), 1, now() + %s::interval)",
                (key, expires),
            )
    try:
        assert _run("purge") == (0, "purged expired rows\n", "")
        with psycopg.connect(db_url, autocommit=True) as conn:
            left = conn.execute(
                "SELECT key_hash FROM player.rate_limits WHERE key_hash IN (%s, %s)", (old, fresh)
            ).fetchall()
        assert left == [(fresh,)]
    finally:
        with psycopg.connect(db_url, autocommit=True) as conn:
            conn.execute("DELETE FROM player.rate_limits WHERE key_hash IN (%s, %s)", (old, fresh))
