"""The pairing functions of migrations 0006 and 0007, called as player_app (ADR 0002, sections
6, 9, 10): what the database checks itself, whoever the caller is. The flows are tested through
the API.

Each test is one transaction, so `now()` stands still: time is moved by changing rows.
"""

from __future__ import annotations

import uuid
from typing import LiteralString

import pytest
from psycopg import errors, sql

from tests.dbhelp import Conn, as_role, set_account

CLIENT = "ROW('203.0.113.0/24'::cidr, 'Other')::player.client_info"
START = "SELECT player.auth_start_pairing(%s, %s, 'linux', '1.2')"
FIND = "SELECT platform, version FROM player.auth_find_pairing(%s)"
DECIDE = f"SELECT player.auth_decide_pairing(%s, %s, %s, {CLIENT})"
COLLECT = (
    "SELECT state, email FROM player.auth_collect_pairing("
    "%s, %s, ROW('203.0.113.0/24'::cidr, 'Other')::player.client_info)"
)
PAIRING = "SELECT state, account_id, device_name FROM player.pairings WHERE user_code_hash = %s"


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _app(
    su: Conn,
    statement: LiteralString,
    params: tuple[object, ...] = (),
    account: uuid.UUID | None = None,
) -> list[tuple[object, ...]]:
    """Run one statement as player_app, with `account` set as an `auth_enter_*` function would."""
    set_account(su, "" if account is None else account)
    as_role(su, "player_app")
    rows = su.execute(statement, params).fetchall()
    su.execute("RESET ROLE")
    return rows


def _account(su: Conn, email: str = "rider@example.test") -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, decode(md5(%s) || md5(%s || 'x'), 'hex')) RETURNING id",
        (email, email, email),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _started(su: Conn) -> tuple[bytes, bytes]:
    """A pending pairing: (device code hash, user code hash)."""
    device, user = _h(), _h()
    _app(su, START, (device, user))
    return device, user


def _events(su: Conn, account: uuid.UUID) -> list[tuple[object, ...]]:
    return su.execute(
        "SELECT event, credential_kind, detail FROM player.audit_events "
        "WHERE account_id = %s ORDER BY event",
        (account,),
    ).fetchall()


def _devices(su: Conn, account: uuid.UUID, count: int, extra: LiteralString = "") -> None:
    for _ in range(count):
        su.execute(
            "INSERT INTO player.devices (account_id, token_hash, name, platform, version) "
            "VALUES (%s, %s, 'd', 'linux', '1')",
            (account, _h()),
        )
    if extra:
        su.execute(sql.SQL("UPDATE player.devices SET ") + sql.SQL(extra))


def test_start_writes_a_pending_pairing_that_lives_ten_minutes(su: Conn) -> None:
    device, user = _started(su)
    rows = su.execute(
        "SELECT state, account_id, device_name, platform, version, expires_at - now(), "
        "last_polled_at, device_code_hash FROM player.pairings WHERE user_code_hash = %s",
        (user,),
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][:5] == ("pending", None, None, "linux", "1.2")
    assert str(rows[0][5]) == "0:10:00" and rows[0][6] is None and rows[0][7] == device


@pytest.mark.parametrize(
    "call",
    [
        "SELECT player.auth_start_pairing(NULL, decode(repeat('ab', 32), 'hex'), 'l', '1')",
        "SELECT player.auth_start_pairing(decode(repeat('ab', 32), 'hex'), '\\x00', 'l', '1')",
        "SELECT player.auth_start_pairing(decode(repeat('ab', 32), 'hex'), "
        "decode(repeat('cd', 32), 'hex'), '', '1')",
        "SELECT player.auth_start_pairing(decode(repeat('ab', 32), 'hex'), "
        "decode(repeat('cd', 32), 'hex'), 'l', repeat('v', 41))",
        "SELECT player.auth_find_pairing(NULL)",
        f"SELECT player.auth_decide_pairing(decode(repeat('ab', 32), 'hex'), NULL, 'n', {CLIENT})",
        f"SELECT player.auth_decide_pairing(decode(repeat('ab', 32), 'hex'), true, NULL, {CLIENT})",
        f"SELECT player.auth_decide_pairing(decode(repeat('ab', 32), 'hex'), true, '', {CLIENT})",
        f"SELECT player.auth_decide_pairing(decode(repeat('ab', 32), 'hex'), true, "
        f"repeat('n', 41), {CLIENT})",
        f"SELECT player.auth_collect_pairing(NULL, decode(repeat('ab', 32), 'hex'), {CLIENT})",
        f"SELECT player.auth_collect_pairing(decode(repeat('ab', 32), 'hex'), '\\x00', {CLIENT})",
    ],
)
def test_bad_arguments_are_refused(su: Conn, call: LiteralString) -> None:
    account = _account(su)
    with pytest.raises(errors.InvalidParameterValue):
        _app(su, call, (), account)


def test_a_code_in_use_is_refused_and_one_that_has_ended_is_free_again(su: Conn) -> None:
    device, user = _started(su)
    for taken in ((_h(), user), (device, _h())):
        with pytest.raises(errors.UniqueViolation), su.transaction():
            _app(su, START, taken)
    assert su.execute("SELECT count(*) FROM player.pairings").fetchone() == (1,)
    su.execute("UPDATE player.pairings SET expires_at = now()")
    _app(su, START, (_h(), user))
    rows = su.execute("SELECT expires_at > now() FROM player.pairings").fetchall()
    assert rows == [(True,)]


def test_find_shows_the_request_and_changes_nothing(su: Conn) -> None:
    account = _account(su)
    _, user = _started(su)
    before = su.execute("SELECT p::text FROM player.pairings p").fetchall()
    assert _app(su, FIND, (user,), account) == [("linux", "1.2")]
    assert su.execute("SELECT p::text FROM player.pairings p").fetchall() == before
    assert _events(su, account) == []
    assert su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)


def test_without_an_account_nothing_is_found_decided_or_counted(su: Conn) -> None:
    _, user = _started(su)
    assert _app(su, FIND, (user,)) == []
    assert _app(su, FIND, (_h(),)) == []
    assert _app(su, DECIDE, (user, True, "Studio PC")) == [(False,)]
    assert su.execute(PAIRING, (user,)).fetchall() == [("pending", None, None)]
    assert su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)


def test_five_wrong_codes_at_the_look_up_and_the_decision_together_close_the_form(
    su: Conn,
) -> None:
    account, other = _account(su), _account(su, "other@example.test")
    _, user = _started(su)
    for _ in range(2):
        assert _app(su, FIND, (_h(),), account) == []
    for approve in (True, False):
        assert _app(su, DECIDE, (_h(), approve, "Studio PC"), account) == [(False,)]
    # Four wrong codes: the right one still works.
    assert _app(su, FIND, (user,), account) == [("linux", "1.2")]
    assert _app(su, FIND, (_h(),), account) == []
    # The fifth closed the form: the right code finds nothing and decides nothing.
    assert _app(su, FIND, (user,), account) == []
    assert _app(su, DECIDE, (user, True, "Studio PC"), account) == [(False,)]
    assert su.execute(PAIRING, (user,)).fetchall() == [("pending", None, None)]
    # Per account: another account's form is open.
    assert _app(su, FIND, (user,), other) == [("linux", "1.2")]
    closed = su.execute(
        "SELECT expires_at - now() FROM player.rate_limits "
        "WHERE key_hash = sha256(convert_to('pairing.closed:' || %s::text, 'UTF8'))",
        (account,),
    ).fetchall()
    assert [str(row[0]) for row in closed] == ["0:15:00"]
    # Fifteen minutes later it is open again.
    su.execute("UPDATE player.rate_limits SET expires_at = now(), hits = 0")
    assert _app(su, FIND, (user,), account) == [("linux", "1.2")]


@pytest.mark.parametrize("approve", [True, False])
def test_a_decision_as_the_fifth_wrong_code_closes_the_form(su: Conn, approve: bool) -> None:
    account = _account(su)
    _, user = _started(su)
    for _ in range(4):
        assert _app(su, FIND, (_h(),), account) == []
    # Four wrong codes, all at the look-up: the form is open and the right code is found.
    assert _app(su, FIND, (user,), account) == [("linux", "1.2")]
    assert su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (1,)
    # The fifth is a decision. It closes the form for 15 minutes, as a look-up would.
    assert _app(su, DECIDE, (_h(), approve, "Studio PC"), account) == [(False,)]
    closed = su.execute(
        "SELECT expires_at - now() FROM player.rate_limits "
        "WHERE key_hash = sha256(convert_to('pairing.closed:' || %s::text, 'UTF8'))",
        (account,),
    ).fetchall()
    assert [str(row[0]) for row in closed] == ["0:15:00"]
    # The right code now finds nothing and decides nothing, and is not counted either.
    assert _app(su, FIND, (user,), account) == []
    assert _app(su, DECIDE, (user, True, "Studio PC"), account) == [(False,)]
    assert _app(su, DECIDE, (user, False, None), account) == [(False,)]
    assert su.execute(PAIRING, (user,)).fetchall() == [("pending", None, None)]
    assert _events(su, account) == []
    wrong = su.execute(
        "SELECT hits FROM player.rate_limits "
        "WHERE key_hash = sha256(convert_to('pairing.wrong:' || %s::text, 'UTF8'))",
        (account,),
    ).fetchall()
    assert wrong == [(5,)]


def test_a_pairing_that_has_ended_or_is_decided_counts_as_a_wrong_code(su: Conn) -> None:
    account = _account(su)
    _, ended = _started(su)
    su.execute("UPDATE player.pairings SET expires_at = now()")
    _, decided = _started(su)
    assert _app(su, DECIDE, (decided, False, None), account) == [(True,)]
    assert _app(su, FIND, (ended,), account) == []
    assert _app(su, FIND, (decided,), account) == []
    # Single use: a second decision of the same code is refused, and counted.
    assert _app(su, DECIDE, (decided, True, "Studio PC"), account) == [(False,)]
    assert _app(su, DECIDE, (ended, True, "Studio PC"), account) == [(False,)]
    assert su.execute("SELECT hits FROM player.rate_limits").fetchall() == [(4,)]
    assert su.execute(PAIRING, (decided,)).fetchall() == [("denied", account, None)]


def test_an_approval_and_a_denial_write_the_accounts_event(su: Conn) -> None:
    account = _account(su)
    _, approved = _started(su)
    _, denied = _started(su)
    assert _app(su, DECIDE, (approved, True, "Studio PC"), account) == [(True,)]
    assert _app(su, DECIDE, (denied, False, "ignored"), account) == [(True,)]
    assert su.execute(PAIRING, (approved,)).fetchall() == [("approved", account, "Studio PC")]
    assert su.execute(PAIRING, (denied,)).fetchall() == [("denied", account, None)]
    detail = {"platform": "linux", "version": "1.2"}
    assert _events(su, account) == [
        ("pairing.approved", "pairing", detail),
        ("pairing.denied", "pairing", detail),
    ]
    network = su.execute("SELECT DISTINCT client_network::text FROM player.audit_events")
    assert network.fetchall() == [("203.0.113.0/24",)]


def test_an_approval_above_ten_active_devices_is_refused(su: Conn) -> None:
    account = _account(su)
    _devices(su, account, 9)
    _, first = _started(su)
    _, second = _started(su)
    assert _app(su, DECIDE, (first, True, "Tenth"), account) == [(True,)]
    # Nine devices and one approved pairing whose token is not collected yet: the cap is met.
    # The refusal is NULL: neither decided (true) nor a wrong code (false).
    assert _app(su, DECIDE, (second, True, "Eleventh"), account) == [(None,)]
    assert su.execute(PAIRING, (second,)).fetchall() == [("pending", None, None)]
    refused = ("pairing.refused", "pairing", {"reason": "device_limit"})
    assert _events(su, account).count(refused) == 1
    # Not a wrong code: nothing was counted.
    assert su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)
    # At the cap a wrong code is still a wrong code: false, counted, and no event.
    assert _app(su, DECIDE, (_h(), True, "Eleventh"), account) == [(False,)]
    assert su.execute("SELECT hits FROM player.rate_limits").fetchall() == [(1,)]
    assert _events(su, account).count(refused) == 1
    # A denial is still possible.
    assert _app(su, DECIDE, (second, False, None), account) == [(True,)]


def test_an_approval_above_the_cap_is_refused_whatever_fills_it(su: Conn) -> None:
    refused = ("pairing.refused", "pairing", {"reason": "device_limit"})
    # Ten devices; ten approved pairings whose tokens are not collected yet.
    with_devices, with_approvals = _account(su), _account(su, "other@example.test")
    _devices(su, with_devices, 10)
    for number in range(10):
        _, user = _started(su)
        assert _app(su, DECIDE, (user, True, f"Device {number}"), with_approvals) == [(True,)]
    for account in (with_devices, with_approvals):
        _, user = _started(su)
        assert _app(su, DECIDE, (user, True, "Eleventh"), account) == [(None,)]
        assert su.execute(PAIRING, (user,)).fetchall() == [("pending", None, None)]
        assert _events(su, account).count(refused) == 1
    assert su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)


@pytest.mark.parametrize(
    "aged",
    [
        "revoked_at = now()",
        "last_used_at = now() - interval '181 days'",
        "created_at = now() - interval '25 hours'",
    ],
)
def test_devices_that_no_longer_work_do_not_count_towards_the_cap(
    su: Conn, aged: LiteralString
) -> None:
    account, other = _account(su), _account(su, "other@example.test")
    _devices(su, account, 10, aged)
    _devices(su, other, 10)
    _, user = _started(su)
    assert _app(su, DECIDE, (user, True, "Studio PC"), account) == [(True,)]


def test_the_poll_answers_by_the_pairings_state(su: Conn) -> None:
    account = _account(su)
    device, user = _started(su)
    token = _h()
    assert _app(su, COLLECT, (_h(), token)) == [("expired_token", None)]
    assert _app(su, COLLECT, (device, token)) == [("authorization_pending", None)]
    # One poll per 5 seconds: a poll that comes too soon gets nothing, approved or not.
    assert _app(su, COLLECT, (device, token)) == [("slow_down", None)]
    assert _app(su, DECIDE, (user, True, "Studio PC"), account) == [(True,)]
    assert _app(su, COLLECT, (device, token)) == [("slow_down", None)]
    assert su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)
    su.execute("UPDATE player.pairings SET last_polled_at = now() - interval '5 seconds'")
    assert _app(su, COLLECT, (device, token)) == [("ok", "rider@example.test")]


def test_a_denied_pairing_answers_access_denied_until_it_ends(su: Conn) -> None:
    account = _account(su)
    device, user = _started(su)
    assert _app(su, DECIDE, (user, False, None), account) == [(True,)]
    for _ in range(2):
        assert _app(su, COLLECT, (device, _h())) == [("access_denied", None)]
        su.execute("UPDATE player.pairings SET last_polled_at = NULL")
    su.execute("UPDATE player.pairings SET expires_at = now()")
    assert _app(su, COLLECT, (device, _h())) == [("expired_token", None)]
    assert su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)


def test_an_approved_pairing_that_has_ended_gives_no_token(su: Conn) -> None:
    account = _account(su)
    device, user = _started(su)
    assert _app(su, DECIDE, (user, True, "Studio PC"), account) == [(True,)]
    su.execute("UPDATE player.pairings SET expires_at = now()")
    assert _app(su, COLLECT, (device, _h())) == [("expired_token", None)]
    assert su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)


def test_the_first_poll_after_approval_makes_the_device_once(su: Conn) -> None:
    account = _account(su)
    device, user = _started(su)
    assert _app(su, DECIDE, (user, True, "Studio PC"), account) == [(True,)]
    token = _h()
    assert _app(su, COLLECT, (device, token)) == [("ok", "rider@example.test")]
    devices = su.execute(
        "SELECT account_id, token_hash, name, platform, version, last_used_at, revoked_at "
        "FROM player.devices"
    ).fetchall()
    assert devices == [(account, token, "Studio PC", "linux", "1.2", None, None)]
    # Used up: the pairing is gone, and a second poll gets expired_token and no second device.
    assert su.execute("SELECT count(*) FROM player.pairings").fetchone() == (0,)
    assert _app(su, COLLECT, (device, _h())) == [("expired_token", None)]
    assert su.execute("SELECT count(*) FROM player.devices").fetchone() == (1,)
    assert ("device.created", "device", {"platform": "linux", "version": "1.2"}) in _events(
        su, account
    )
    # The poll sets no account: the device code is not a credential for stored data.
    as_role(su, "player_app")
    assert su.execute("SELECT current_setting('app.account_id', true)").fetchone() == ("",)


def test_no_event_holds_a_code_or_a_hash(su: Conn) -> None:
    account = _account(su)
    device, user = _started(su)
    token = _h()
    _app(su, DECIDE, (user, True, "Studio PC"), account)
    _app(su, COLLECT, (device, token))
    stored = su.execute("SELECT string_agg(e::text, ' ') FROM player.audit_events e").fetchone()
    assert stored is not None and "device.created" in str(stored[0])
    for secret in (device, user, token):
        assert secret.hex() not in str(stored[0]).lower()
