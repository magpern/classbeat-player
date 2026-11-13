"""The device queries filter by the account in the code, not only by the policy (ADR 0002,
section 9: "Queries still filter by `account_id` in the code; the policy is the backstop").

Here the data access runs on a handle of the bootstrap superuser, which row-level security
does not hold: whatever keeps one account's devices from another in these tests is the
query's own filter.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import psycopg
import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import devices
from player_backend.db.context import AccountContext
from player_backend.db.executor import Handle, connect
from tests.dbhelp import Conn

CLIENT = ClientInfo(network="203.0.113.0/24", family="Other")
_CLEAN = "TRUNCATE player.accounts CASCADE"


@pytest.fixture
def unheld(db_url: str) -> Iterator[tuple[Handle, Conn]]:
    """A handle that bypasses row-level security, and the tests' own connection."""
    with psycopg.connect(db_url, autocommit=True) as su, connect(db_url) as db:
        su.execute(_CLEAN)
        try:
            yield db, su
        finally:
            su.execute(_CLEAN)


def _account(su: Conn, email: str) -> tuple[uuid.UUID, uuid.UUID]:
    """An account with one device: (account id, device id)."""
    account = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, sha256(convert_to(%s, 'UTF8'))) RETURNING id",
        (email, email),
    ).fetchone()
    assert account is not None and isinstance(account[0], uuid.UUID)
    device = su.execute(
        "INSERT INTO player.devices (account_id, token_hash, name, platform, version) "
        "VALUES (%s, sha256(convert_to(%s, 'UTF8')), %s, 'linux', '1') RETURNING id",
        (account[0], email, email),
    ).fetchone()
    assert device is not None and isinstance(device[0], uuid.UUID)
    return account[0], device[0]


def _context(db: Handle, account: uuid.UUID, device: uuid.UUID) -> AccountContext:
    return AccountContext(
        account_id=account,
        credential_kind="device",
        credential_id=device,
        signed_in_at=None,
        entered_at=datetime.now(UTC),
        db=db,
    )


def test_the_device_queries_keep_to_their_account_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, a_device = _account(su, "a@example.test")
    b, b_device = _account(su, "b@example.test")
    # The handle is not held by the policy: it sees both accounts' rows.
    assert su.execute("SELECT count(*) FROM player.devices").fetchone() == (2,)
    as_a = _context(db, a, a_device)
    assert [device.id for device in devices.list_devices(as_a)] == [a_device]
    # A device id of another account, as the credential or as the target, finds nothing.
    assert devices.own_device(_context(db, a, b_device)) is None
    assert devices.revoke(as_a, b_device, CLIENT) is False
    revoked = su.execute("SELECT id FROM player.devices WHERE revoked_at IS NOT NULL").fetchall()
    assert revoked == []
    assert su.execute("SELECT count(*) FROM player.audit_events").fetchone() == (0,)
    # And its own: found, revoked, and the event is the account's.
    own = devices.own_device(as_a)
    assert own is not None and own.name == "a@example.test"
    assert devices.revoke(as_a, a_device, CLIENT) is True
    revoked = su.execute("SELECT id FROM player.devices WHERE revoked_at IS NOT NULL").fetchall()
    assert revoked == [(a_device,)]
    assert su.execute("SELECT account_id FROM player.audit_events").fetchall() == [(a,)]
    assert devices.list_devices(_context(db, b, b_device))[0].id == b_device
