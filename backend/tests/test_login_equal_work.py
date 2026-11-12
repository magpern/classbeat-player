"""`auth_request_login` does the same lookups and writes for every address (ADR 0002, section 4,
step 2), counted with the database's own per-transaction statistics.

Whether the address can sign in changes one thing only: an address that has an account gets
its "link requested" event (section 11). The requester's limits change two, whatever the
address: a request over its per-pair limits does not count toward the total per email (section
10), so it makes one counter write fewer, and a request over any limit cancels no older link
(section 4, step 3).

Every measured request comes from a browser that already has a link for that email, so the
cancelling statement has a row to find, and to delete or leave, in every state.
"""

from __future__ import annotations

import hashlib
import uuid

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
    older_link: bool = True,
) -> tuple[bool, Work]:
    """One request for an address in the given state: (mail?, the work the call did).

    A first request has made the address's counters, so the measured one updates them whatever
    the state. That first request came from the same browser, unless `older_link` is False.
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


CAN_SIGN_IN = [
    # (account, listed): cannot, may sign up, has an account, both
    (False, False),
    (False, True),
    (True, False),
    (True, True),
]


def test_within_the_limits_every_address_gets_the_same_lookups_and_writes(su: Conn) -> None:
    _, unknown = _measured(su)
    # What is compared is real work: both lookups, three counters, and the older link of the
    # browser found, deleted and replaced, for an address that cannot sign in too.
    assert unknown["accounts"] == (1, 0, 0, 0)
    assert unknown["signup_allowlist"] == (1, 0, 0, 0)
    assert unknown["login_links"][0] >= 1 and unknown["login_links"][1:] == (1, 0, 1)
    assert unknown["rate_limits"][1:] == (0, 3, 0)
    for account, listed in CAN_SIGN_IN:
        mail, work = _measured(su, account=account, listed=listed)
        assert mail is (account or listed)
        assert _without_the_event(work, account) == unknown, (account, listed)


def test_over_the_total_per_email_only_the_cancelling_differs(su: Conn) -> None:
    _, within = _measured(su)
    for account, listed in CAN_SIGN_IN:
        mail, work = _measured(su, account=account, listed=listed, over="email")
        assert mail is False
        # Step 3: over its limits a request cancels nothing. The older link is found and left.
        assert work["login_links"] == (within["login_links"][0], 1, 0, 0), (account, listed)
        work = _without_the_event(work, account)
        assert {**work, "login_links": within["login_links"]} == within, (account, listed)


def test_over_the_per_pair_limits_it_also_makes_one_counter_write_fewer(su: Conn) -> None:
    _, within = _measured(su)
    for account, listed in CAN_SIGN_IN:
        mail, work = _measured(su, account=account, listed=listed, over="pair")
        assert mail is False
        # Section 10: what is over its own limits does not count toward the total per email.
        assert work["rate_limits"][1:] == (0, 2, 0), (account, listed)
        assert work["rate_limits"][0] < within["rate_limits"][0]
        assert work["login_links"] == (within["login_links"][0], 1, 0, 0), (account, listed)
        work = _without_the_event(work, account)
        # Nothing else differs.
        same = {"rate_limits": within["rate_limits"], "login_links": within["login_links"]}
        assert {**work, **same} == within, (account, listed)


def test_the_cancelling_statement_runs_with_no_older_link_to_find(su: Conn) -> None:
    _, with_one = _measured(su)
    for account, listed in CAN_SIGN_IN:
        _, none = _measured(su, account=account, listed=listed, older_link=False)
        assert none["login_links"] == (with_one["login_links"][0], 1, 0, 0), (account, listed)
