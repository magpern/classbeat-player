"""Two things at once with passkeys (ADR 0002, sections 4, 5 and 10): a passkey sign-in and a
link sign-in to one account leave at most 20 sessions, two additions leave at most 10 passkeys,
and parallel failed sign-ins from one address pass no more checks than the limit leaves.

As in tests/test_sign_in_races.py, one call's transaction is held open on a connection of its
own, the second call is started and seen to wait for the account's lock, and only then does the
first commit. A call that waits longer than `LOCK_TIMEOUT` fails, so a broken lock fails its test
instead of hanging it.
"""

from __future__ import annotations

import ipaddress
import threading
import time
import uuid
from collections.abc import Iterator

import httpx
import psycopg
import pytest

from player_backend.client_policy import address_hash
from player_backend.passkey_policy import FAILED_LOCK, failed_limit_key, failed_lock_key
from tests.dbhelp import Conn
from tests.passkeyhelp import OPTIONS, PASSKEYS, Authenticator, options_of, register, sign_in
from tests.sitehelp import Site

EMAIL = "rider@example.test"
CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
REQUEST = f"SELECT player.auth_request_login(%s, %s, %s, %s, {CLIENT})"
COMPLETE_LINK = f"SELECT player.auth_complete_login(%s, %s, %s, {CLIENT})"
NEW_CHALLENGE = "SELECT player.auth_new_login_challenge(%s, %s)"
COMPLETE_PASSKEY = f"SELECT player.auth_complete_passkey(%s, %s, %s, %s, %s, {CLIENT})"
SESSION_LOCK = 7270003
ADDITIONS_LOCK = 7270011
LOCK_TIMEOUT = "5s"


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _account_key(account: uuid.UUID) -> int:
    """The second key of an account's lock, as pg_locks shows it (unsigned)."""
    return int(account.hex[:8], 16)


def _signed(key: int) -> int:
    """The key as the 32-bit integer an advisory lock function takes."""
    return key - (1 << 32) if key >= 1 << 31 else key


@pytest.fixture
def two(db_url: str) -> Iterator[tuple[Conn, Conn]]:
    """Two connections, each in a transaction of its own until it commits."""
    with psycopg.connect(db_url) as first, psycopg.connect(db_url) as second:
        for conn in (first, second):
            conn.execute("SELECT set_config('lock_timeout', %s, false)", (LOCK_TIMEOUT,))
            conn.commit()
        yield first, second


def _advisory(site: Site, granted: bool, pid: int | None = None) -> list[tuple[int, int, str]]:
    """(first key, second key, mode) of the advisory locks held, or waited for, by `pid` (or by
    anyone)."""
    found = site.su.execute(
        "SELECT classid::bigint, objid::bigint, mode FROM pg_locks "
        "WHERE locktype = 'advisory' AND objsubid = 2 AND granted = %s "
        "AND (%s::int IS NULL OR pid = %s::int)",
        (granted, pid, pid),
    ).fetchall()
    return [(int(str(first)), int(str(second)), str(mode)) for first, second, mode in found]


def _wait_for_a_waiter(site: Site, held: tuple[int, int, str]) -> None:
    """Until some connection waits for the advisory lock `held`."""
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if held in _advisory(site, granted=False):
            return
        time.sleep(0.01)
    pytest.fail("the second call did not wait for the account's lock")


def _in_background(call: object) -> tuple[threading.Thread, list[object]]:
    """Run `call` on a thread. The list gets what it returned, or its error's name."""
    result: list[object] = []
    assert callable(call)

    def run() -> None:
        try:
            result.append(call())
        except psycopg.Error as error:
            result.append(type(error).__name__)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, result


def _finished(thread: threading.Thread, result: list[object]) -> object:
    thread.join(10)
    assert not thread.is_alive(), "the second call did not finish"
    assert len(result) == 1
    return result[0]


def _account(site: Site) -> uuid.UUID:
    row = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (EMAIL,)).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def test_a_passkey_and_a_link_sign_in_at_once_leave_20_sessions(
    site: Site, two: tuple[Conn, Conn]
) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    account = _account(site)
    site.su.execute("UPDATE player.sessions SET created_at = now() - interval '30 days'")
    for day in range(1, 20):
        site.su.execute(
            "INSERT INTO player.sessions (account_id, token_hash, created_at) "
            "VALUES (%s, %s, now() - %s * interval '1 day')",
            (account, _h(), day),
        )
    credential = _h()
    site.su.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, %s, 'key', 'Laptop')",
        (account, credential),
    )
    link, link_browser = _h(), _h()
    assert site.su.execute(REQUEST, (EMAIL, link, link_browser, _h())).fetchone() == (True,)
    challenge, browser = _h(), _h()
    site.su.execute(NEW_CHALLENGE, (challenge, browser))

    first, second = two
    by_link, by_passkey = _h(), _h()
    assert first.execute(COMPLETE_LINK, (link, link_browser, by_link)).fetchone() == (True,)
    held = (SESSION_LOCK, _account_key(account), "ExclusiveLock")
    assert _advisory(site, granted=True, pid=first.info.backend_pid) == [held]

    def passkey_sign_in() -> object:
        row = second.execute(
            COMPLETE_PASSKEY, (credential, challenge, browser, 1, by_passkey)
        ).fetchone()
        second.commit()
        return None if row is None else row[0]

    thread, result = _in_background(passkey_sign_in)
    _wait_for_a_waiter(site, held)
    # It waits for the account's sign-in lock, before it has made its session.
    assert _advisory(site, granted=False, pid=second.info.backend_pid) == [held]
    assert result == []
    first.commit()
    assert _finished(thread, result) is True
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (20,)
    kept = site.su.execute(
        "SELECT count(*) FROM player.sessions WHERE token_hash = ANY(%s)",
        ([by_link, by_passkey],),
    ).fetchone()
    assert kept == (2,)  # the oldest were dropped, never a new one


def test_two_additions_at_once_leave_10_passkeys(site: Site, two: tuple[Conn, Conn]) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    account = _account(site)
    for n in range(9):
        site.su.execute(
            "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
            "VALUES (%s, %s, 'key', %s)",
            (account, _h(), f"Key {n}"),
        )
    credential = Authenticator().create(options_of(browser.post(OPTIONS)))

    # The other addition: it holds the account's lock and has added the tenth, not committed.
    holder, _ = two
    key = _account_key(account)
    holder.execute("SELECT pg_advisory_xact_lock(%s, %s)", (ADDITIONS_LOCK, _signed(key)))
    holder.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, %s, 'key', 'Key 9')",
        (account, _h()),
    )

    def add() -> object:
        answer: httpx.Response = browser.post(
            PASSKEYS, json={"name": "Key 10", "credential": credential}
        )
        return (answer.status_code, answer.json())

    thread, result = _in_background(add)
    _wait_for_a_waiter(site, (ADDITIONS_LOCK, key, "ExclusiveLock"))
    assert result == []
    holder.commit()
    assert _finished(thread, result) == (409, {"error": "too_many_passkeys"})
    count = site.su.execute(
        "SELECT count(*) FROM player.passkeys WHERE account_id = %s", (account,)
    ).fetchone()
    assert count == (10,)


def test_parallel_failed_sign_ins_pass_the_check_one_at_a_time(
    site: Site, two: tuple[Conn, Conn]
) -> None:
    """Nine failures are counted. The other attempt has passed its check (the tenth may still
    be tried) and has not counted its failure yet: a second attempt waits for it, and is then
    over the limit. Without the lock both would pass the check, and 11 failures get through."""
    site.allow(EMAIL)
    authenticator = Authenticator()
    assert register(site.sign_in(EMAIL), authenticator).status_code == 201
    address = "198.51.100.40"
    browser = site.browser(address)
    for _ in range(9):
        assert sign_in(browser, authenticator, rp_id="evil.test").status_code == 401
    failed = failed_limit_key(address_hash(ipaddress.ip_address(address)))
    lock = failed_lock_key(failed)
    hit = "SELECT player.rate_limit_hit(%s, interval '10 minutes', 10)"

    holder, _ = two
    holder.execute("SELECT pg_advisory_xact_lock(%s, %s)", (FAILED_LOCK, lock))
    holder.execute("SAVEPOINT look")
    assert holder.execute(hit, (failed,)).fetchone() == (False,)  # the tenth may be tried
    holder.execute("ROLLBACK TO SAVEPOINT look")

    def second_attempt() -> object:
        return sign_in(browser, authenticator, rp_id="evil.test").status_code

    thread, result = _in_background(second_attempt)
    _wait_for_a_waiter(site, (FAILED_LOCK, lock & 0xFFFFFFFF, "ExclusiveLock"))
    assert result == []
    assert holder.execute(hit, (failed,)).fetchone() == (False,)  # its failure, the tenth
    holder.commit()
    assert _finished(thread, result) == 429
    hits = site.su.execute(
        "SELECT hits FROM player.rate_limits WHERE key_hash = %s", (failed,)
    ).fetchone()
    assert hits == (11,)  # ten failures and the refused look
