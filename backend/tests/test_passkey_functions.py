"""The passkey sign-in functions of migration 0011, called as player_app (ADR 0002, sections 4,
9 and 10): what the database checks itself, whoever the caller is. The flows, with a software
authenticator, are in tests/test_passkey_sign_in.py."""

from __future__ import annotations

import uuid
from typing import LiteralString

import pytest
from psycopg import errors

from tests.dbhelp import Conn, as_role

CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
NEW = "SELECT player.auth_new_login_challenge(%s, %s)"
FOR_LOGIN = "SELECT * FROM player.auth_passkey_for_login(%s)"
COMPLETE = f"SELECT player.auth_complete_passkey(%s, %s, %s, %s, %s, {CLIENT})"


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _one(conn: Conn, statement: LiteralString, params: tuple[object, ...] = ()) -> object:
    row = conn.execute(statement, params).fetchone()
    assert row is not None
    return row[0]


def _passkey(su: Conn, sign_count: int = 0) -> tuple[uuid.UUID, bytes]:
    account = _one(
        su,
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES ('rider@example.test', %s) RETURNING id",
        (_h(),),
    )
    credential = _h()
    su.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, sign_count, name) "
        "VALUES (%s, %s, 'key', %s, 'Laptop')",
        (account, credential, sign_count),
    )
    assert isinstance(account, uuid.UUID)
    return account, credential


def _count(su: Conn, statement: LiteralString, params: tuple[object, ...] = ()) -> int:
    return int(str(_one(su, statement, params)))


@pytest.mark.parametrize(
    ("challenge", "browser"), [(None, b"b" * 32), (b"c" * 31, b"b" * 32), (b"c" * 32, None)]
)
def test_a_challenge_with_bad_arguments_is_refused(
    su: Conn, challenge: bytes | None, browser: bytes | None
) -> None:
    as_role(su, "player_app")
    with pytest.raises(errors.InvalidParameterValue):
        su.execute(NEW, (challenge, browser))


def test_a_browser_holds_one_challenge_that_lives_five_minutes(su: Conn) -> None:
    as_role(su, "player_app")
    browser, other = _h(), _h()
    for _ in range(3):
        su.execute(NEW, (_h(), browser))
    su.execute(NEW, (_h(), other))
    su.execute("RESET ROLE")
    rows = su.execute(
        "SELECT browser_hash, expires_at - now() FROM player.login_challenges ORDER BY 1"
    ).fetchall()
    assert len(rows) == 2 and {r[0] for r in rows} == {browser, other}
    assert {str(r[1]) for r in rows} == {"0:05:00"}


def test_the_passkey_for_login_names_its_key_and_counter_only(su: Conn) -> None:
    _, credential = _passkey(su, sign_count=7)
    as_role(su, "player_app")
    found = su.execute(FOR_LOGIN, (credential,))
    assert [c.name for c in found.description or ()] == ["public_key", "sign_count"]
    assert found.fetchall() == [(b"key", 7)]
    assert su.execute(FOR_LOGIN, (_h(),)).fetchall() == []
    assert su.execute(FOR_LOGIN, (None,)).fetchall() == []


@pytest.mark.parametrize(
    "arguments",
    [
        (None, "challenge", "browser", 1, "session"),
        ("credential", None, "browser", 1, "session"),
        ("credential", "challenge", b"short", 1, "session"),
        ("credential", "challenge", "browser", None, "session"),
        ("credential", "challenge", "browser", -1, "session"),
        ("credential", "challenge", "browser", 2**32, "session"),
        ("credential", "challenge", "browser", 1, None),
    ],
)
def test_a_completion_with_bad_arguments_is_refused(
    su: Conn, arguments: tuple[object, ...]
) -> None:
    _, credential = _passkey(su)
    named = {"credential": credential, "challenge": _h(), "browser": _h(), "session": _h()}
    values = tuple(named.get(a, a) if isinstance(a, str) else a for a in arguments)
    as_role(su, "player_app")
    with pytest.raises(errors.InvalidParameterValue):
        su.execute(COMPLETE, values)


def test_an_unknown_credential_uses_up_the_challenge_and_writes_nothing(su: Conn) -> None:
    _passkey(su)
    challenge, browser = _h(), _h()
    as_role(su, "player_app")
    su.execute(NEW, (challenge, browser))
    assert _one(su, COMPLETE, (_h(), challenge, browser, 1, _h())) is False
    su.execute("RESET ROLE")
    assert _count(su, "SELECT count(*) FROM player.login_challenges") == 0
    assert _count(su, "SELECT count(*) FROM player.audit_events") == 0
    assert _count(su, "SELECT count(*) FROM player.sessions") == 0


def test_a_completion_keeps_at_most_twenty_sessions_and_the_new_one(su: Conn) -> None:
    account, credential = _passkey(su)
    for n in range(20):
        su.execute(
            "INSERT INTO player.sessions (account_id, token_hash, created_at) "
            "VALUES (%s, %s, now() - make_interval(mins => %s))",
            (account, _h(), 20 - n),
        )
    challenge, browser, session = _h(), _h(), _h()
    as_role(su, "player_app")
    su.execute(NEW, (challenge, browser))
    assert _one(su, COMPLETE, (credential, challenge, browser, 1, session)) is True
    su.execute("RESET ROLE")
    assert _count(su, "SELECT count(*) FROM player.sessions") == 20
    assert _count(su, "SELECT count(*) FROM player.sessions WHERE token_hash = %s", (session,)) == 1
    assert _one(su, "SELECT sign_count FROM player.passkeys") == 1
