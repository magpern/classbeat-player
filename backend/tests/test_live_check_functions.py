"""auth_device_active and auth_session_active of migration 0013, called as player_app (ADR 0002,
sections 8 and 9; ADR 0005, section 2): the live process's re-check.

Each answers true exactly when the matching `auth_enter_*` function would accept the token, at
every lifetime edge, and changes nothing: no account set, no "last used", no counter, no event.
"""

from __future__ import annotations

import uuid
from typing import LiteralString

import pytest
from psycopg import sql

from tests.dbhelp import Conn, as_role


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _account(su: Conn, email: str = "rider@example.test") -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) VALUES (%s, %s) RETURNING id",
        (email, _h()),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _device(su: Conn, account: uuid.UUID, aged: LiteralString = "") -> bytes:
    digest = _h()
    su.execute(
        "INSERT INTO player.devices (account_id, token_hash, name, platform, version) "
        "VALUES (%s, %s, 'Studio PC', 'linux', '1')",
        (account, digest),
    )
    if aged:
        su.execute(
            sql.SQL("UPDATE player.devices SET ")
            + sql.SQL(aged)
            + sql.SQL(" WHERE token_hash = %s"),
            (digest,),
        )
    return digest


def _session(su: Conn, account: uuid.UUID, aged: LiteralString = "") -> bytes:
    digest = _h()
    su.execute(
        "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s)", (account, digest)
    )
    if aged:
        su.execute(
            sql.SQL("UPDATE player.sessions SET ")
            + sql.SQL(aged)
            + sql.SQL(" WHERE token_hash = %s"),
            (digest,),
        )
    return digest


def _call(su: Conn, function: LiteralString, digest: bytes | None) -> object:
    """Call as player_app, with no account set; the function must leave none set either."""
    su.execute("SELECT set_config('app.account_id', '', true)")
    as_role(su, "player_app")
    row = su.execute(
        sql.SQL("SELECT player.{}(%s), current_setting('app.account_id', true)").format(
            sql.Identifier(function)
        ),
        (digest,),
    ).fetchone()
    su.execute("RESET ROLE")
    assert row is not None and row[1] == ""
    return row[0]


def _snapshot(su: Conn) -> tuple[object, ...]:
    """What a check must not change: "last used", counters, events."""
    row = su.execute(
        "SELECT (SELECT array_agg(last_used_at ORDER BY id) FROM player.devices),"
        "       (SELECT array_agg(last_used_at ORDER BY id) FROM player.sessions),"
        "       (SELECT count(*) FROM player.rate_limits),"
        "       (SELECT count(*) FROM player.audit_events)"
    ).fetchone()
    assert row is not None
    return tuple(row)


# (what is changed on a fresh device row, active). The edges of auth_enter_device's states.
DEVICE_CASES: list[tuple[LiteralString, bool]] = [
    ("", True),  # paired, not yet used, within 24 hours
    ("last_used_at = now()", True),
    ("revoked_at = now(), last_used_at = now()", False),
    ("revoked_at = now() - interval '91 days', last_used_at = now()", False),
    ("created_at = now() - interval '23 hours'", True),
    ("created_at = now() - interval '25 hours'", False),  # never used within 24 hours
    (
        "created_at = now() - interval '1 year', last_used_at = now() - interval '179 days'",
        True,
    ),
    (
        "created_at = now() - interval '1 year', last_used_at = now() - interval '181 days'",
        False,
    ),  # 180 days without use
]


@pytest.mark.parametrize(("aged", "active"), DEVICE_CASES)
def test_a_device_is_active_exactly_when_entering_it_would_answer_ok(
    su: Conn, aged: LiteralString, active: bool
) -> None:
    account = _account(su)
    digest = _device(su, account, aged)
    before = _snapshot(su)
    assert _call(su, "auth_device_active", digest) is active
    assert _snapshot(su) == before
    as_role(su, "player_app")
    row = su.execute("SELECT state FROM player.auth_enter_device(%s)", (digest,)).fetchone()
    su.execute("RESET ROLE")
    assert row is not None and (row[0] == "ok") is active


# (what is changed on a fresh session row, active). The edges of auth_enter_session.
SESSION_CASES: list[tuple[LiteralString, bool]] = [
    ("", True),
    ("last_used_at = now() - interval '13 days', created_at = now() - interval '13 days'", True),
    ("last_used_at = now() - interval '15 days', created_at = now() - interval '15 days'", False),
    ("last_used_at = now(), created_at = now() - interval '59 days'", True),
    ("last_used_at = now(), created_at = now() - interval '61 days'", False),
]


@pytest.mark.parametrize(("aged", "active"), SESSION_CASES)
def test_a_session_is_active_exactly_when_entering_it_would_find_it(
    su: Conn, aged: LiteralString, active: bool
) -> None:
    account = _account(su)
    digest = _session(su, account, aged)
    before = _snapshot(su)
    assert _call(su, "auth_session_active", digest) is active
    assert _snapshot(su) == before
    as_role(su, "player_app")
    found = su.execute("SELECT * FROM player.auth_enter_session(%s)", (digest,)).fetchall()
    su.execute("RESET ROLE")
    assert (len(found) == 1) is active


@pytest.mark.parametrize("function", ["auth_device_active", "auth_session_active"])
def test_an_unknown_or_missing_token_is_not_active(su: Conn, function: LiteralString) -> None:
    account = _account(su)
    _device(su, account, "last_used_at = now()")
    _session(su, account)
    for digest in (_h(), None, b"", b"\x00" * 32):
        assert _call(su, function, digest) is False


def test_a_deleted_accounts_device_and_session_are_not_active(su: Conn) -> None:
    gone = _account(su)
    kept = _account(su, "kept@example.test")
    device, session = _device(su, gone, "last_used_at = now()"), _session(su, gone)
    other_device, other_session = _device(su, kept, "last_used_at = now()"), _session(su, kept)
    assert _call(su, "auth_device_active", device) is True
    assert _call(su, "auth_session_active", session) is True
    su.execute("DELETE FROM player.accounts WHERE id = %s", (gone,))
    assert _call(su, "auth_device_active", device) is False
    assert _call(su, "auth_session_active", session) is False
    # Another account's tokens answer for themselves only.
    assert _call(su, "auth_device_active", other_device) is True
    assert _call(su, "auth_session_active", other_session) is True


def test_the_answer_does_not_depend_on_the_account_set(su: Conn) -> None:
    mine, theirs = _account(su), _account(su, "other@example.test")
    device, session = _device(su, theirs, "last_used_at = now()"), _session(su, theirs)
    # With another account set the function still finds the token: it reads past the policy as
    # player_auth, and answers only true or false.
    su.execute("SELECT set_config('app.account_id', %s, true)", (str(mine),))
    as_role(su, "player_app")
    row = su.execute(
        "SELECT player.auth_device_active(%s), player.auth_session_active(%s),"
        " current_setting('app.account_id', true)",
        (device, session),
    ).fetchone()
    su.execute("RESET ROLE")
    assert row == (True, True, str(mine))
