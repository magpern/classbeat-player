"""auth_enter_device of migration 0009, called as player_app (ADR 0002, section 10 and
principle 7): it counts a working token's request against one of two budgets, with the limits
as its own constants, and answers `limited` over them."""

from __future__ import annotations

import uuid

import pytest

from player_backend.bearer_policy import (
    DOCUMENT_READ_MAX,
    REQUEST_MAX,
    documents_key,
    requests_key,
)
from tests.dbhelp import Conn, as_role
from tests.test_device_functions import ENTER

BUDGET = "SELECT set_config('app.device_budget', %s, true)"


def _device(su: Conn) -> tuple[uuid.UUID, uuid.UUID, bytes]:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES ('rider@example.test', decode(repeat('ab', 32), 'hex')) RETURNING id"
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    account = row[0]
    digest = uuid.uuid4().bytes * 2
    found = su.execute(
        "INSERT INTO player.devices (account_id, token_hash, name, platform, version) "
        "VALUES (%s, %s, 'Studio PC', 'linux', '1') RETURNING id",
        (account, digest),
    ).fetchone()
    assert found is not None and isinstance(found[0], uuid.UUID)
    return account, found[0], digest


def _enter(su: Conn, digest: bytes, budget: str | None) -> tuple[object, ...]:
    """One request as player_app, the budget named first as db/devices.py does."""
    as_role(su, "player_app")
    if budget is not None:
        su.execute(BUDGET, (budget,))
    rows = su.execute(ENTER, (digest,)).fetchall()
    left = su.execute("SELECT current_setting('app.device_budget', true)").fetchone()
    su.execute("RESET ROLE")
    # Read once: the function clears the budget, so nothing later in the transaction has it.
    assert left == ("",)
    assert len(rows) == 1
    return rows[0]


def _hits(su: Conn, key: bytes) -> int:
    row = su.execute(
        "SELECT coalesce(sum(hits), 0)::int FROM player.rate_limits WHERE key_hash = %s", (key,)
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


@pytest.mark.parametrize(
    ("budget", "limit", "counted"),
    [
        ("documents", DOCUMENT_READ_MAX, "documents"),
        ("requests", REQUEST_MAX, "requests"),
        # Anything else, or nothing at all, is the smaller budget.
        (None, REQUEST_MAX, "requests"),
        ("", REQUEST_MAX, "requests"),
        ("Documents", REQUEST_MAX, "requests"),
        ("documents ", REQUEST_MAX, "requests"),
    ],
)
def test_each_budget_has_its_own_constant_limit(
    su: Conn, budget: str | None, limit: int, counted: str
) -> None:
    account, device, digest = _device(su)
    for _ in range(limit):
        assert _enter(su, digest, budget) == (device, "ok", str(account))
    # Over the limit: counted, no device and no account.
    assert _enter(su, digest, budget) == (None, "limited", "")
    key, other = documents_key(digest), requests_key(digest)
    if counted == "requests":
        key, other = other, key
    assert _hits(su, key) == limit + 1 and _hits(su, other) == 0
    # The other budget is untouched by this one being spent.
    spare = "requests" if counted == "documents" else "documents"
    assert _enter(su, digest, spare) == (device, "ok", str(account))


def test_a_limited_request_still_writes_last_used(su: Conn) -> None:
    _, _, digest = _device(su)
    for _ in range(REQUEST_MAX):
        _enter(su, digest, "requests")
    su.execute("UPDATE player.devices SET last_used_at = now() - interval '1 hour'")
    assert _enter(su, digest, "requests")[1] == "limited"
    assert su.execute("SELECT last_used_at = now() FROM player.devices").fetchone() == (True,)


def test_a_token_that_does_not_work_is_not_counted_by_the_function(su: Conn) -> None:
    _, _, digest = _device(su)
    su.execute("UPDATE player.devices SET revoked_at = now()")
    for budget in ("documents", "requests"):
        assert _enter(su, digest, budget)[1] == "revoked"
    unknown = uuid.uuid4().bytes * 2
    assert _enter(su, unknown, "documents")[1] == "unknown"
    # The counters of dead tokens are the caller's (db/devices.py), per address.
    assert su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)
