"""`admin account delete <account id>` (ADR 0010, section 8; #496): the operator removes an
account and everything it owns, as player_owner, and the live process hears of it."""

from __future__ import annotations

import io
import secrets
import uuid
from collections.abc import Iterator

import psycopg
import pytest

from player_backend.admin import main
from tests.dbhelp import Conn


def _run(*argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(argv), out=out, err=err)
    return code, out.getvalue(), err.getvalue()


@pytest.fixture
def as_owner(monkeypatch: pytest.MonkeyPatch, owner_url: str) -> None:
    monkeypatch.delenv("PLAYER_DATABASE_URL", raising=False)
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", owner_url)


@pytest.fixture
def accounts(db_url: str) -> Iterator[tuple[uuid.UUID, uuid.UUID]]:
    """Two accounts, each with a passkey and an audit event. Removed afterwards."""
    made: list[uuid.UUID] = []
    with psycopg.connect(db_url, autocommit=True) as conn:
        for _ in range(2):
            row = conn.execute(
                "INSERT INTO player.accounts (email, passkey_user_handle) VALUES (%s, %s) "
                "RETURNING id",
                (f"op-{secrets.token_hex(4)}@example.test", secrets.token_bytes(32)),
            ).fetchone()
            assert row is not None
            account = uuid.UUID(str(row[0]))
            made.append(account)
            conn.execute(
                "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
                "VALUES (%s, %s, %s, 'key')",
                (account, secrets.token_bytes(16), b"pk"),
            )
            conn.execute(
                "INSERT INTO player.audit_events (account_id, event, detail) "
                "VALUES (%s, 'session.all_ended', '{}')",
                (account,),
            )
    yield made[0], made[1]
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("DELETE FROM player.accounts WHERE id = ANY(%s)", (made,))


@pytest.fixture
def listener(db_url: str) -> Iterator[Conn]:
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("LISTEN live_revocations")
        yield conn


def _owned(db_url: str, account: uuid.UUID) -> tuple[object, ...]:
    with psycopg.connect(db_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT (SELECT count(*) FROM player.accounts WHERE id = %(a)s),"
            " (SELECT count(*) FROM player.passkeys WHERE account_id = %(a)s),"
            " (SELECT count(*) FROM player.audit_events WHERE account_id = %(a)s)",
            {"a": account},
        ).fetchone()
    assert row is not None
    return tuple(row)


@pytest.mark.usefixtures("as_owner")
def test_delete_removes_the_account_and_all_it_owns_and_nothing_else(
    db_url: str, accounts: tuple[uuid.UUID, uuid.UUID], listener: Conn
) -> None:
    first, second = accounts
    assert _run("account", "delete", str(first)) == (0, f"deleted: {first}\n", "")
    assert _owned(db_url, first) == (0, 0, 0)
    assert _owned(db_url, second) == (1, 1, 1)
    heard = [(n.channel, n.payload) for n in listener.notifies(timeout=1.0)]
    assert heard == [("live_revocations", str(first))]
    # Again: there is nothing left to delete.
    assert _run("account", "delete", str(first)) == (0, f"no account: {first}\n", "")


@pytest.mark.usefixtures("as_owner")
def test_delete_of_an_unknown_account_changes_nothing(
    db_url: str, accounts: tuple[uuid.UUID, uuid.UUID], listener: Conn
) -> None:
    missing = uuid.uuid4()
    assert _run("account", "delete", str(missing)) == (0, f"no account: {missing}\n", "")
    assert [_owned(db_url, a) for a in accounts] == [(1, 1, 1), (1, 1, 1)]
    assert list(listener.notifies(timeout=0.5)) == []


@pytest.mark.usefixtures("as_owner")
@pytest.mark.parametrize("value", ["not-a-uuid", "", "1234"])
def test_delete_refuses_what_is_not_an_account_id(value: str) -> None:
    assert _run("account", "delete", value) == (2, "", "not an account id\n")


def test_delete_refuses_any_role_but_player_owner(
    monkeypatch: pytest.MonkeyPatch,
    app_url: str,
    accounts: tuple[uuid.UUID, uuid.UUID],
    db_url: str,
) -> None:
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", app_url)
    code, _, err = _run("account", "delete", str(accounts[0]))
    assert code == 1 and "player_owner" in err
    assert _owned(db_url, accounts[0]) == (1, 1, 1)
