"""auth_enter_device of migration 0006, called as player_app (ADR 0002, sections 3, 6 and 9):
the four states, what sets the account, and when "last used" is written."""

from __future__ import annotations

import uuid
from typing import LiteralString

import pytest
from psycopg import sql

from tests.dbhelp import Conn, as_role, set_account

ENTER = (
    "SELECT device_id, state, current_setting('app.account_id', true) "
    "FROM player.auth_enter_device(%s)"
)


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _account(su: Conn) -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES ('rider@example.test', decode(repeat('ab', 32), 'hex')) RETURNING id"
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _device(su: Conn, account: uuid.UUID, aged: LiteralString = "") -> tuple[uuid.UUID, bytes]:
    digest = _h()
    row = su.execute(
        "INSERT INTO player.devices (account_id, token_hash, name, platform, version) "
        "VALUES (%s, %s, 'Studio PC', 'linux', '1') RETURNING id",
        (account, digest),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    if aged:
        su.execute(sql.SQL("UPDATE player.devices SET ") + sql.SQL(aged))
    return row[0], digest


def _enter(su: Conn, digest: bytes | None, before: object = "") -> tuple[object, ...]:
    """Enter as player_app, in a transaction that had `before` as its account."""
    set_account(su, before)
    as_role(su, "player_app")
    rows = su.execute(ENTER, (digest,)).fetchall()
    su.execute("RESET ROLE")
    assert len(rows) == 1
    return rows[0]


def test_a_working_token_sets_the_account_and_returns_the_device(su: Conn) -> None:
    account = _account(su)
    device, digest = _device(su, account)
    assert _enter(su, digest) == (device, "ok", str(account))
    assert su.execute("SELECT last_used_at = now() FROM player.devices").fetchone() == (True,)


@pytest.mark.parametrize(
    ("aged", "state"),
    [
        ("revoked_at = now()", "revoked"),
        ("revoked_at = now() - interval '89 days', last_used_at = now()", "revoked"),
        # Kept 90 days to answer `revoked`, then it counts as deleted.
        ("revoked_at = now() - interval '91 days', last_used_at = now()", "unknown"),
        # Never used within 24 hours of pairing: deleted, whether or not the purge has run.
        ("created_at = now() - interval '25 hours'", "unknown"),
        # 180 days without use.
        (
            "created_at = now() - interval '1 year', last_used_at = now() - interval '181 days'",
            "expired",
        ),
    ],
)
def test_a_token_that_does_not_work_sets_no_account_and_returns_no_device(
    su: Conn, aged: LiteralString, state: str
) -> None:
    account = _account(su)
    _, digest = _device(su, account, aged)
    used = su.execute("SELECT last_used_at FROM player.devices").fetchone()
    # Whatever account the transaction had before is cleared, never kept.
    assert _enter(su, digest, account) == (None, state, "")
    assert su.execute("SELECT last_used_at FROM player.devices").fetchone() == used


def test_a_token_of_no_device_is_unknown(su: Conn) -> None:
    account = _account(su)
    _device(su, account)
    assert _enter(su, _h(), account) == (None, "unknown", "")
    assert _enter(su, None, account) == (None, "unknown", "")
    assert _enter(su, b"short", account) == (None, "unknown", "")


@pytest.mark.parametrize(
    ("aged", "written"),
    [
        ("created_at = now() - interval '23 hours'", True),
        ("last_used_at = now() - interval '4 minutes'", False),
        ("last_used_at = now() - interval '6 minutes'", True),
        (
            "created_at = now() - interval '1 year', last_used_at = now() - interval '179 days'",
            True,
        ),
    ],
)
def test_last_used_is_written_at_most_once_every_five_minutes(
    su: Conn, aged: LiteralString, written: bool
) -> None:
    account = _account(su)
    device, digest = _device(su, account, aged)
    assert _enter(su, digest) == (device, "ok", str(account))
    now = su.execute("SELECT last_used_at = now() FROM player.devices").fetchone()
    assert now == (written,)
