"""The function bodies of migration 0004, called as player_app (ADR 0002, sections 9 and 10):
what the database checks itself, whoever the caller is. The flows are tested through the API."""

from __future__ import annotations

import uuid
from typing import LiteralString

import pytest
from psycopg import errors

from tests.dbhelp import Conn, as_role

EMAIL = "rider@example.test"
CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
REQUEST = f"SELECT player.auth_request_login(%s, %s, %s, %s, {CLIENT})"
COMPLETE = f"SELECT player.auth_complete_login(%s, %s, %s, {CLIENT})"
ACCOUNT = "SELECT current_setting('app.account_id', true)"


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _one(conn: Conn, statement: LiteralString, params: tuple[object, ...] = ()) -> object:
    row = conn.execute(statement, params).fetchone()
    assert row is not None
    return row[0]


def _account(su: Conn, email: str = EMAIL) -> uuid.UUID:
    found = _one(
        su,
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, decode(md5(%s) || md5(%s || 'x'), 'hex')) RETURNING id",
        (email, email, email),
    )
    assert isinstance(found, uuid.UUID)
    return found


def _session(su: Conn, account: uuid.UUID) -> bytes:
    digest = _h()
    su.execute(
        "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s)", (account, digest)
    )
    return digest


def test_rate_limit_hit_is_true_only_over_the_limit_and_per_key(su: Conn) -> None:
    as_role(su, "player_app")
    key, other = _h(), _h()
    hit = "SELECT player.rate_limit_hit(%s, interval '1 hour', 3)"
    assert [_one(su, hit, (key,)) for _ in range(5)] == [False, False, False, True, True]
    assert _one(su, hit, (other,)) is False
    su.execute("RESET ROLE")
    rows = su.execute(
        "SELECT hits, expires_at - window_start, window_start <= now(), expires_at > now() "
        "FROM player.rate_limits WHERE key_hash = %s",
        (key,),
    ).fetchall()
    assert len(rows) == 1 and rows[0][0] == 5 and rows[0][2:] == (True, True)
    assert str(rows[0][1]) == "1:00:00"


@pytest.mark.parametrize(
    "call",
    [
        "SELECT player.rate_limit_hit(NULL, interval '1 hour', 3)",
        "SELECT player.rate_limit_hit('\\x00', interval '1 hour', 3)",
        "SELECT player.rate_limit_hit(sha256('k'), interval '0', 3)",
        "SELECT player.rate_limit_hit(sha256('k'), NULL, 3)",
        "SELECT player.rate_limit_hit(sha256('k'), interval '1 hour', -1)",
        "SELECT player.rate_limit_hit(sha256('k'), interval '1 hour', NULL)",
        f"SELECT player.auth_request_login(NULL, sha256('a'), sha256('b'), sha256('c'), {CLIENT})",
        f"SELECT player.auth_request_login('x', sha256('a'), sha256('b'), sha256('c'), {CLIENT})",
        f"SELECT player.auth_request_login('a@b.test', NULL, sha256('b'), sha256('c'), {CLIENT})",
        f"SELECT player.auth_request_login('a@b.test', sha256('a'), '\\x01', sha256('c'), "
        f"{CLIENT})",
        f"SELECT player.auth_request_login('a@b.test', sha256('a'), sha256('b'), NULL, {CLIENT})",
        f"SELECT player.auth_complete_login(NULL, sha256('b'), sha256('c'), {CLIENT})",
        f"SELECT player.auth_complete_login(sha256('a'), NULL, sha256('c'), {CLIENT})",
        f"SELECT player.auth_complete_login(sha256('a'), sha256('b'), '\\x01', {CLIENT})",
    ],
)
def test_bad_arguments_fail_closed_and_write_nothing(su: Conn, call: LiteralString) -> None:
    as_role(su, "player_app")
    su.execute("SAVEPOINT before")
    with pytest.raises(errors.InvalidParameterValue):
        su.execute(call)
    su.execute("ROLLBACK TO before")
    su.execute("RESET ROLE")
    counted = su.execute(
        "SELECT (SELECT count(*) FROM player.rate_limits),"
        " (SELECT count(*) FROM player.login_links),"
        " (SELECT count(*) FROM player.sessions), (SELECT count(*) FROM player.accounts),"
        " (SELECT count(*) FROM player.audit_events)"
    ).fetchone()
    assert counted == (0, 0, 0, 0, 0)


def test_enter_session_sets_the_account_for_the_transaction_only(su: Conn) -> None:
    account = _account(su)
    digest = _session(su, account)
    su.commit()
    try:
        as_role(su, "player_app")
        assert su.execute("SELECT count(*) FROM player.sessions").fetchone() == (0,)
        rows = su.execute("SELECT * FROM player.auth_enter_session(%s)", (digest,)).fetchall()
        assert len(rows) == 1 and isinstance(rows[0][0], uuid.UUID)
        assert _one(su, ACCOUNT) == str(account)
        assert su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)
        su.commit()
        # The next transaction on the same connection has no account.
        as_role(su, "player_app")
        assert _one(su, ACCOUNT) in ("", None)
        assert su.execute("SELECT count(*) FROM player.sessions").fetchone() == (0,)
    finally:
        su.rollback()
        su.execute("DELETE FROM player.accounts WHERE id = %s", (account,))
        su.commit()


@pytest.mark.parametrize("token", ["unknown", "null", "idle", "old"])
def test_enter_session_with_no_live_session_sets_no_account(su: Conn, token: str) -> None:
    account = _account(su)
    other = _account(su, "other@example.test")
    digest: bytes | None = _session(su, account)
    if token == "unknown":
        digest = _h()
    elif token == "null":
        digest = None
    elif token == "idle":
        su.execute("UPDATE player.sessions SET last_used_at = now() - interval '14 days 1 second'")
    else:
        su.execute("UPDATE player.sessions SET created_at = now() - interval '60 days 1 second'")
    as_role(su, "player_app")
    # Even an account set before the call (which the backend never does) does not survive it.
    su.execute("SELECT set_config('app.account_id', %s, true)", (str(other),))
    assert su.execute("SELECT * FROM player.auth_enter_session(%s)", (digest,)).fetchall() == []
    assert _one(su, ACCOUNT) == ""
    assert su.execute("SELECT count(*) FROM player.accounts").fetchone() == (0,)


def test_the_sign_in_functions_set_no_account_and_normalise_the_email(su: Conn) -> None:
    account = _account(su)
    link, browser, session = _h(), _h(), _h()
    as_role(su, "player_app")
    assert _one(su, REQUEST, ("  Rider@Example.TEST ", link, browser, _h())) is True
    assert _one(su, ACCOUNT) in ("", None)
    assert _one(su, COMPLETE, (link, browser, session)) is True
    assert _one(su, ACCOUNT) in ("", None)
    # player_app sees nothing of what was made: no account is set, and the tables are closed.
    assert su.execute("SELECT count(*) FROM player.sessions").fetchone() == (0,)
    su.execute("SAVEPOINT before")
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute("SELECT count(*) FROM player.login_links")
    su.execute("ROLLBACK TO before")
    su.execute("RESET ROLE")
    made = su.execute("SELECT account_id, client_family FROM player.sessions").fetchall()
    assert made == [(account, "Firefox")]
    events = su.execute(
        "SELECT event, credential_kind, client_network::text, client_family "
        "FROM player.audit_events ORDER BY event"
    ).fetchall()
    assert events == [
        ("login.link_requested", "link", "203.0.113.0/24", "Firefox"),
        ("login.signed_in", "session", "203.0.113.0/24", "Firefox"),
    ]


def test_an_unusable_link_is_refused_even_with_the_right_browser(su: Conn) -> None:
    # A row marked unusable is in no mail. Only a caller that made the token could try it.
    _account(su)
    link, browser = _h(), _h()
    su.execute(
        "INSERT INTO player.login_links (link_hash, email, browser_hash, usable, expires_at) "
        "VALUES (%s, %s, %s, false, now() + interval '15 minutes')",
        (link, EMAIL, browser),
    )
    as_role(su, "player_app")
    assert _one(su, COMPLETE, (link, browser, _h())) is False
    su.execute("RESET ROLE")
    assert su.execute("SELECT count(*) FROM player.sessions").fetchone() == (0,)
    assert su.execute("SELECT detail FROM player.audit_events").fetchall() == [
        ({"reason": "not_usable"},)
    ]
