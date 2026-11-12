"""The source functions of migration 0008, called as player_app (ADR 0002, sections 3, 7, 9 and
11): what sets the account, what a link code is good for, and what is written where."""

from __future__ import annotations

import base64
import hashlib
import uuid
from typing import LiteralString

import pytest
from psycopg import sql

from tests.dbhelp import Conn, as_role, set_account

ENTER = (
    "SELECT link_id, source_id, current_setting('app.account_id', true) "
    "FROM player.auth_enter_source(%s)"
)
NEW_CODE = "SELECT player.auth_new_link_code(%s, %s, %s, %s)"
EXCHANGE = (
    "SELECT player.auth_exchange_link_code("
    "%s, %s, %s, %s, %s, ROW('192.0.2.0/24'::cidr, 'Other')::player.client_info)"
)
REDIRECT = "https://classbeat.test/player/linked"
VERIFIER = "v" * 43
CHALLENGE = (
    base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
)


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _account(su: Conn, email: str = "rider@example.test") -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, decode(md5(%s) || md5(%s), 'hex')) RETURNING id",
        (email, email, email + "x"),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _link(su: Conn, account: uuid.UUID, aged: LiteralString = "") -> tuple[uuid.UUID, bytes]:
    digest = _h()
    row = su.execute(
        "INSERT INTO player.source_links (account_id, source_id, token_hash) "
        "VALUES (%s, 'classbeat', %s) RETURNING id",
        (account, digest),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    if aged:
        statement = sql.SQL("UPDATE player.source_links SET {} WHERE id = %s").format(sql.SQL(aged))
        su.execute(statement, (row[0],))
    return row[0], digest


def _as_app(su: Conn, account: object = "") -> None:
    set_account(su, account)
    as_role(su, "player_app")


def _done(su: Conn) -> None:
    su.execute("RESET ROLE")


def _new_code(su: Conn, account: uuid.UUID, code: bytes) -> None:
    _as_app(su, account)
    su.execute(NEW_CODE, (code, "classbeat", REDIRECT, CHALLENGE))
    _done(su)


def _exchange(su: Conn, code: bytes, token: bytes, **changes: str) -> object:
    args = {"source": "classbeat", "redirect": REDIRECT, "verifier": VERIFIER, **changes}
    _as_app(su)
    row = su.execute(
        EXCHANGE, (code, args["source"], args["redirect"], args["verifier"], token)
    ).fetchone()
    _done(su)
    assert row is not None
    return row[0]


def _events(su: Conn) -> list[tuple[object, ...]]:
    return su.execute(
        "SELECT event, credential_kind, client_network::text, detail FROM player.audit_events "
        "ORDER BY occurred_at, event"
    ).fetchall()


def test_a_working_token_sets_the_account_and_returns_the_link(su: Conn) -> None:
    account = _account(su)
    link, digest = _link(su, account)
    _as_app(su)
    assert su.execute(ENTER, (digest,)).fetchall() == [(link, "classbeat", str(account))]
    _done(su)
    assert su.execute("SELECT last_used_at = now() FROM player.source_links").fetchone() == (True,)


@pytest.mark.parametrize(
    "aged",
    [
        "created_at = now() - interval '366 days'",
        "created_at = now() - interval '2 years', last_used_at = now() - interval '366 days'",
    ],
)
def test_an_idle_or_unknown_token_sets_no_account(su: Conn, aged: LiteralString) -> None:
    account = _account(su)
    _, digest = _link(su, account, aged)
    for token in (digest, _h(), None):
        # Whatever account the transaction had before is cleared, never kept.
        _as_app(su, account)
        assert su.execute(ENTER, (token,)).fetchall() == []
        assert su.execute("SELECT current_setting('app.account_id', true)").fetchone() == ("",)
        _done(su)


@pytest.mark.parametrize(
    ("aged", "written"),
    [
        ("last_used_at = now() - interval '4 minutes'", False),
        ("last_used_at = now() - interval '6 minutes'", True),
        (
            "created_at = now() - interval '2 years', last_used_at = now() - interval '364 days'",
            True,
        ),
    ],
)
def test_last_used_is_written_at_most_once_every_five_minutes(
    su: Conn, aged: LiteralString, written: bool
) -> None:
    account = _account(su)
    _, digest = _link(su, account, aged)
    _as_app(su)
    assert len(su.execute(ENTER, (digest,)).fetchall()) == 1
    _done(su)
    now = su.execute("SELECT last_used_at = now() FROM player.source_links").fetchone()
    assert now == (written,)


def test_a_code_is_stored_only_for_the_account_already_set(su: Conn) -> None:
    account = _account(su)
    _as_app(su)
    su.execute(NEW_CODE, (_h(), "classbeat", REDIRECT, CHALLENGE))
    _done(su)
    assert su.execute("SELECT count(*) FROM player.source_link_codes").fetchone() == (0,)
    _new_code(su, account, _h())
    row = su.execute(
        "SELECT account_id, expires_at - now() FROM player.source_link_codes"
    ).fetchone()
    assert row is not None and row[0] == account and str(row[1]) == "0:01:00"


@pytest.mark.parametrize(
    "args",
    [
        (b"short", "classbeat", REDIRECT, CHALLENGE),
        (None, "classbeat", REDIRECT, CHALLENGE),
        (b"x" * 32, "Not-An-Id", REDIRECT, CHALLENGE),
        (b"x" * 32, "classbeat", "", CHALLENGE),
        (b"x" * 32, "classbeat", "x" * 2001, CHALLENGE),
        (b"x" * 32, "classbeat", REDIRECT, "plain-challenge"),
    ],
)
def test_a_code_with_bad_arguments_is_refused(su: Conn, args: tuple[object, ...]) -> None:
    account = _account(su)
    _as_app(su, account)
    with pytest.raises(Exception, match="bad arguments"):
        su.execute(NEW_CODE, args)
    su.rollback()


def test_the_exchange_makes_a_link_with_the_callers_token_hash_once(su: Conn) -> None:
    account = _account(su)
    code, token = _h(), _h()
    _new_code(su, account, code)
    assert _exchange(su, code, token) is True
    links = su.execute("SELECT account_id, source_id, token_hash FROM player.source_links")
    assert links.fetchall() == [(account, "classbeat", token)]
    assert su.execute("SELECT count(*) FROM player.source_link_codes").fetchone() == (0,)
    assert _exchange(su, code, _h()) is False
    assert _events(su) == [("source.linked", "source", "192.0.2.0/24", {"source": "classbeat"})]


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"source": "other"}, "binding"),
        ({"redirect": REDIRECT + "/"}, "binding"),
        ({"verifier": "w" * 43}, "verifier"),
        ({"verifier": CHALLENGE}, "verifier"),
        ({"verifier": "v" * 42}, "verifier"),
    ],
)
def test_every_binding_is_checked_and_a_refusal_uses_the_code_up(
    su: Conn, changes: dict[str, str], reason: str
) -> None:
    account = _account(su)
    code = _h()
    _new_code(su, account, code)
    assert _exchange(su, code, _h(), **changes) is False
    assert _exchange(su, code, _h()) is False
    assert su.execute("SELECT count(*) FROM player.source_links").fetchone() == (0,)
    assert _events(su) == [
        ("source.link_refused", "source", "192.0.2.0/24", {"source": "classbeat", "reason": reason})
    ]


def test_the_cap_counts_links_that_have_not_ended(su: Conn) -> None:
    account = _account(su)
    for _ in range(4):
        _link(su, account)
    # Idle for more than 365 days: ended, so not counted.
    _link(su, account, "created_at = now() - interval '400 days'")
    _link(su, account)
    code = _h()
    _new_code(su, account, code)
    assert _exchange(su, code, _h()) is False
    su.execute(
        "DELETE FROM player.source_links WHERE id = (SELECT id FROM player.source_links "
        "WHERE created_at > now() - interval '1 day' LIMIT 1)"
    )
    code = _h()
    _new_code(su, account, code)
    assert _exchange(su, code, _h()) is True


def test_player_app_cannot_read_or_write_link_codes(su: Conn) -> None:
    account = _account(su)
    _new_code(su, account, _h())
    _as_app(su, account)
    with pytest.raises(Exception, match="permission denied"):
        su.execute("SELECT * FROM player.source_link_codes")
    su.rollback()
