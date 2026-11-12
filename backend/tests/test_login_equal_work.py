"""`auth_request_login` does the same lookups and writes for every address (ADR 0002, section 4,
step 2), counted with the database's own per-transaction statistics.

Two exceptions, both the ADR's: an address that has an account gets its "link requested" event
(section 11), and a request over its per-pair limits does not count toward the total per email
(section 10), so it makes one counter write fewer.
"""

from __future__ import annotations

import hashlib
import uuid

import pytest

from tests.dbhelp import Conn

CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
REQUEST = f"SELECT player.auth_request_login(%s, %s, %s, %s, {CLIENT})"
ADDRESS = hashlib.sha256(b"an address").digest()
TABLES = ("accounts", "signup_allowlist", "login_links", "rate_limits", "audit_events")

# Per table: scans (of the table or an index of it), rows inserted, updated, deleted.
type Work = dict[str, tuple[int, int, int, int]]

_WORK = (
    "SELECT relname::text, seq_scan + coalesce(idx_scan, 0), n_tup_ins, n_tup_upd, n_tup_del "
    "FROM pg_stat_xact_user_tables WHERE schemaname = 'player'"
)


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _work(su: Conn) -> Work:
    found: Work = {}
    for name, scans, inserted, updated, deleted in su.execute(_WORK).fetchall():
        found[str(name)] = (
            int(str(scans)),
            int(str(inserted)),
            int(str(updated)),
            int(str(deleted)),
        )
    assert set(TABLES) <= set(found)
    return found


def _email_key(email: str) -> bytes:
    return hashlib.sha256(("login.email:" + email).encode()).digest()


def _pair_key(email: str) -> bytes:
    pair = hashlib.sha256(("login.pair:" + email + ":").encode() + ADDRESS).digest()
    return hashlib.sha256(b"15m:" + pair).digest()


def _request(su: Conn, email: str, browser: bytes) -> bool:
    row = su.execute(REQUEST, (email, _h(), browser, ADDRESS)).fetchone()
    assert row is not None and isinstance(row[0], bool)
    return row[0]


def _measured(
    su: Conn,
    *,
    account: bool = False,
    listed: bool = False,
    over: str | None = None,
    older_link: bool = False,
) -> tuple[bool, Work]:
    """One request for an address in the given state: (mail?, the work the call did).

    A first request has made the address's counters, so the measured one updates them whatever
    the state. With `older_link` that first request came from the same browser.
    """
    email = f"{uuid.uuid4().hex}@example.test"
    browser = _h()
    if account:
        su.execute(
            "INSERT INTO player.accounts (email, passkey_user_handle) VALUES (%s, %s)",
            (email, _h()),
        )
    if listed:
        su.execute("INSERT INTO player.signup_allowlist (email) VALUES (%s)", (email,))
    assert _request(su, email, browser if older_link else _h()) is (account or listed)
    if over is not None:
        key, hits = {"email": (_email_key(email), 30), "pair": (_pair_key(email), 3)}[over]
        raised = su.execute(
            "UPDATE player.rate_limits SET hits = %s WHERE key_hash = %s", (hits, key)
        )
        assert raised.rowcount == 1  # the key is the function's own
    before = _work(su)
    mail = _request(su, email, browser)
    after = _work(su)
    work: Work = {}
    for table in TABLES:
        b, a = before[table], after[table]
        work[table] = (a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3])
    return mail, work


def _without_the_event(work: Work, account: bool) -> Work:
    """The work with the one row more of an address that has an account taken out.

    That row costs its insert and the check of its foreign key, which reads the account once.
    """
    scans, inserted, updated, deleted = work["audit_events"]
    assert (inserted, updated, deleted) == (1 if account else 0, 0, 0)
    read, *unchanged = work["accounts"]
    return {
        **work,
        "audit_events": (scans, 0, 0, 0),
        "accounts": (read - (1 if account else 0), unchanged[0], unchanged[1], unchanged[2]),
    }


STATES = [
    # (account, listed, over the total per email)
    (False, False, False),
    (False, True, False),
    (True, False, False),
    (True, True, False),
    (False, False, True),
    (False, True, True),
    (True, False, True),
]


def test_every_address_gets_the_same_lookups_and_writes(su: Conn) -> None:
    _, unknown = _measured(su)
    # What is compared is real work: both lookups, the cancelling statement, three counters.
    assert unknown["accounts"] == (1, 0, 0, 0)
    assert unknown["signup_allowlist"] == (1, 0, 0, 0)
    assert unknown["login_links"][0] >= 1 and unknown["login_links"][1:] == (1, 0, 0)
    assert unknown["rate_limits"][1:] == (0, 3, 0)
    for account, listed, over in STATES:
        mail, work = _measured(su, account=account, listed=listed, over="email" if over else None)
        assert mail is ((account or listed) and not over)
        assert _without_the_event(work, account) == unknown, (account, listed, over)


@pytest.mark.parametrize(("account", "listed"), [(False, False), (False, True), (True, False)])
def test_over_the_per_pair_limits_it_makes_one_counter_write_fewer(
    su: Conn, account: bool, listed: bool
) -> None:
    _, unknown = _measured(su)
    mail, work = _measured(su, account=account, listed=listed, over="pair")
    assert mail is False
    # Section 10: what is over its own limits does not count toward the total per email.
    assert work["rate_limits"][1:] == (0, 2, 0)
    assert work["rate_limits"][0] < unknown["rate_limits"][0]
    work = _without_the_event(work, account)
    # Nothing else differs.
    assert {**work, "rate_limits": unknown["rate_limits"]} == unknown


def test_the_older_links_of_the_browser_are_found_whether_or_not_they_are_cancelled(
    su: Conn,
) -> None:
    cancelled, usable = _measured(su, listed=True, older_link=True)
    kept, unknown = _measured(su, older_link=True)
    limited, over = _measured(su, listed=True, over="email", older_link=True)
    assert (cancelled, kept, limited) == (True, False, False)
    # A newer link cancels the older one only when the newer one works...
    assert usable["login_links"][1:] == (1, 0, 1)
    assert unknown["login_links"][1:] == over["login_links"][1:] == (1, 0, 0)
    # ...but the statement that looks for it runs all the same.
    assert usable["login_links"][0] == unknown["login_links"][0] == over["login_links"][0]
    _, none = _measured(su)
    assert usable["login_links"][0] == none["login_links"][0]
