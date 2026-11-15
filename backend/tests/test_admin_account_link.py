"""`admin account link` (ADR 0010, section 8; #481): an `unlinked` account becomes the
instructor of a classbeat identity, once, as player_owner, and loses its passkeys."""

from __future__ import annotations

import io
import secrets
import uuid
from collections.abc import Iterator

import psycopg
import pytest

from player_backend.admin import main

ISSUER = "https://classbeat.test"


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
    """Two unlinked accounts, one with a passkey. Removed afterwards."""
    made: list[uuid.UUID] = []
    with psycopg.connect(db_url, autocommit=True) as conn:
        for _ in range(2):
            row = conn.execute(
                "INSERT INTO player.accounts (email, passkey_user_handle) VALUES (%s, %s) "
                "RETURNING id",
                (f"op-{secrets.token_hex(4)}@example.test", secrets.token_bytes(32)),
            ).fetchone()
            assert row is not None
            made.append(uuid.UUID(str(row[0])))
        conn.execute(
            "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
            "VALUES (%s, %s, %s, 'key')",
            (made[0], secrets.token_bytes(16), b"pk"),
        )
    yield made[0], made[1]
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("DELETE FROM player.accounts WHERE id = ANY(%s)", (made,))


def _account(db_url: str, account: uuid.UUID) -> tuple[object, ...]:
    with psycopg.connect(db_url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT kind, classbeat_issuer, classbeat_subject, "
            "(SELECT count(*) FROM player.passkeys p WHERE p.account_id = a.id), "
            "(SELECT array_agg(e.event::text || ' ' || e.detail::text) "
            " FROM player.audit_events e WHERE e.account_id = a.id) "
            "FROM player.accounts a WHERE a.id = %s",
            (account,),
        ).fetchone()
    assert row is not None
    return tuple(row)


@pytest.mark.usefixtures("as_owner")
def test_link_makes_an_unlinked_account_an_instructor_once(
    db_url: str, accounts: tuple[uuid.UUID, uuid.UUID]
) -> None:
    first, second = accounts
    assert _run("account", "link", str(first), ISSUER, "subject-1") == (0, f"linked: {first}\n", "")
    kind, issuer, subject, passkeys, events = _account(db_url, first)
    assert (kind, issuer, subject, passkeys) == ("instructor", ISSUER, "subject-1", 0)
    assert events == ['account.linked {"by": "operator", "passkeys_deleted": 1}']
    # Once: an instructor is not linked again.
    assert _run("account", "link", str(first), ISSUER, "subject-2") == (
        0,
        f"no unlinked account: {first}\n",
        "",
    )
    assert _account(db_url, first)[2] == "subject-1"
    # An identity already held is refused by the database, shown by its SQLSTATE only.
    code, out, err = _run("account", "link", str(second), ISSUER, "subject-1")
    assert (code, out) == (1, "") and err.startswith("database error: ") and "subject" not in err
    assert _account(db_url, second)[0] == "unlinked"


@pytest.mark.usefixtures("as_owner")
@pytest.mark.parametrize(
    "argv",
    [
        ("not-a-uuid", ISSUER, "s"),
        (str(uuid.uuid4()), "http://classbeat.test", "s"),
        (str(uuid.uuid4()), ISSUER, ""),
        (str(uuid.uuid4()), ISSUER, "s" * 256),
        (str(uuid.uuid4()), ISSUER, "tab\there"),
    ],
)
def test_link_refuses_what_is_not_an_account_and_an_identity(argv: tuple[str, str, str]) -> None:
    code, out, err = _run("account", "link", *argv)
    assert (code, out) == (2, "") and err == "not an account id, an https issuer and a subject\n"


@pytest.mark.usefixtures("as_owner")
def test_link_of_an_unknown_account_changes_nothing() -> None:
    missing = uuid.uuid4()
    assert _run("account", "link", str(missing), ISSUER, "s") == (
        0,
        f"no unlinked account: {missing}\n",
        "",
    )


def test_link_refuses_any_role_but_player_owner(
    monkeypatch: pytest.MonkeyPatch, app_url: str
) -> None:
    monkeypatch.setenv("PLAYER_DATABASE_OWNER_URL", app_url)
    code, _, err = _run("account", "link", str(uuid.uuid4()), ISSUER, "s")
    assert code == 1 and "player_owner" in err
