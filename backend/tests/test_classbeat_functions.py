"""The functions of migration 0014, called as player_app (ADR 0010, sections 2, 4, 5 and 9;
#481): what the database checks itself, whoever the caller is. The flow is tested through the
API in tests/test_classbeat_sign_in.py."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from typing import LiteralString

import pytest
from psycopg import errors

from tests.dbhelp import Conn, as_role, every_value

CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
START = "SELECT player.auth_start_classbeat(%s, %s, %s, %s, %s, %s, %s, %s)"
TAKE = (
    "SELECT purpose, return_to, nonce_hash, asking_session_hash, started_at "
    "FROM player.auth_take_classbeat(%s, %s, %s)"
)
COMPLETE = f"SELECT player.auth_complete_classbeat(%s, %s, %s, %s, now(), %s, %s, {CLIENT})"
REAUTH = (
    f"SELECT player.auth_reauth_classbeat(%s, %s, %s, now() - %s * interval '1 second', "
    f"%s, %s, {CLIENT})"
)
ISSUER = "https://classbeat.test"
SUBJECT = "pairwise-1"
EMAIL = "ann@example.test"


def _h() -> bytes:
    return secrets.token_bytes(32)


def _sha(text: str) -> bytes:
    return hashlib.sha256(text.encode()).digest()


def _one(conn: Conn, statement: LiteralString, params: tuple[object, ...] = ()) -> object:
    row = conn.execute(statement, params).fetchone()
    assert row is not None
    return row[0]


def _start(
    su: Conn,
    *,
    binding: bytes | None = None,
    state: bytes | None = None,
    purpose: str = "sign_in",
    asking: bytes | None = None,
    held: bytes | None = None,
    address: bytes | None = None,
    return_to: str | None = None,
) -> object:
    return _one(
        su,
        START,
        (
            binding or _h(),
            state or _h(),
            _h(),
            purpose,
            return_to,
            asking,
            held,
            address or _sha("address"),
        ),
    )


def _rows(su: Conn) -> int:
    su.execute("RESET ROLE")
    count = _one(su, "SELECT count(*) FROM player.classbeat_sign_ins")
    as_role(su, "player_app")
    assert isinstance(count, int)
    return count


def _complete(
    su: Conn,
    subject: str = SUBJECT,
    email: str | None = EMAIL,
    verified: bool = True,
    session: bytes | None = None,
    address: bytes | None = None,
) -> object:
    return _one(
        su,
        COMPLETE,
        (ISSUER, subject, email, verified, session or _h(), address or _sha("address")),
    )


def _instructor(su: Conn, subject: str = SUBJECT) -> tuple[uuid.UUID, str | None] | None:
    su.execute("RESET ROLE")
    row = su.execute(
        "SELECT id, email FROM player.accounts WHERE kind = 'instructor' "
        "AND classbeat_issuer = %s AND classbeat_subject = %s",
        (ISSUER, subject),
    ).fetchone()
    as_role(su, "player_app")
    return (
        None if row is None else (uuid.UUID(str(row[0])), None if row[1] is None else str(row[1]))
    )


def _allow(su: Conn, email: str = EMAIL) -> None:
    su.execute("INSERT INTO player.signup_allowlist (email) VALUES (%s)", (email,))


def _events(su: Conn, account: uuid.UUID) -> list[tuple[str, object]]:
    su.execute("RESET ROLE")
    rows = su.execute(
        "SELECT event, detail FROM player.audit_events WHERE account_id = %s ORDER BY occurred_at",
        (account,),
    ).fetchall()
    as_role(su, "player_app")
    return [(str(e), d) for e, d in rows]


# --- start and take ------------------------------------------------------------------------


def test_a_start_keeps_only_hashes_and_the_take_hands_them_back(su: Conn) -> None:
    as_role(su, "player_app")
    binding, state = new_secret(), new_secret()
    nonce = new_secret()
    assert (
        _one(
            su,
            START,
            (
                _sha(binding),
                _sha(state),
                _sha(nonce),
                "sign_in",
                "control",
                None,
                None,
                _sha("address"),
            ),
        )
        == "started"
    )
    su.execute("RESET ROLE")
    stored = every_value(su)
    assert binding not in stored and state not in stored and nonce not in stored
    row = su.execute(
        "SELECT binding_hash, state_hash, nonce_hash, expires_at - created_at "
        "FROM player.classbeat_sign_ins"
    ).fetchone()
    assert row is not None
    assert (row[0], row[1], row[2]) == (
        _sha(binding),
        _sha(state),
        _sha(nonce),
    )
    assert str(row[3]) == "0:10:00"
    as_role(su, "player_app")
    taken = su.execute(TAKE, (_sha(binding), _sha(state), _sha("address"))).fetchall()
    assert [(r[0], r[1], r[2], r[3]) for r in taken] == [("sign_in", "control", _sha(nonce), None)]
    # Single use.
    assert su.execute(TAKE, (_sha(binding), _sha(state), _sha("address"))).fetchall() == []


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def test_the_take_needs_the_binding_and_the_state_together(su: Conn) -> None:
    as_role(su, "player_app")
    binding, state = _h(), _h()
    _start(su, binding=binding, state=state)
    assert su.execute(TAKE, (binding, _h(), _sha("address"))).fetchall() == []
    assert su.execute(TAKE, (_h(), state, _sha("address"))).fetchall() == []
    assert len(su.execute(TAKE, (binding, state, _sha("address"))).fetchall()) == 1


def test_a_row_older_than_ten_minutes_is_used_up_and_gives_nothing(su: Conn) -> None:
    as_role(su, "player_app")
    binding, state = _h(), _h()
    _start(su, binding=binding, state=state)
    su.execute("RESET ROLE")
    su.execute("UPDATE player.classbeat_sign_ins SET expires_at = now() - interval '1 second'")
    as_role(su, "player_app")
    assert su.execute(TAKE, (binding, state, _sha("address"))).fetchall() == []
    assert _rows(su) == 0


def test_a_new_start_in_the_browser_drops_its_earlier_flow(su: Conn) -> None:
    as_role(su, "player_app")
    first = _h()
    _start(su, binding=first)
    _start(su, held=first)
    assert _rows(su) == 1


def test_starts_are_limited_per_address_with_no_row_over_the_limit(su: Conn) -> None:
    as_role(su, "player_app")
    address = _h()
    answers = [_start(su, address=address) for _ in range(21)]
    assert answers == ["started"] * 20 + ["limited"]
    assert _rows(su) == 20
    assert _start(su, address=_h()) == "started"


def test_callbacks_are_limited_per_address_and_use_nothing_up_over_it(su: Conn) -> None:
    as_role(su, "player_app")
    address = _h()
    for _ in range(30):
        su.execute(TAKE, (_h(), _h(), address))
    binding, state = _h(), _h()
    _start(su, binding=binding, state=state)
    assert su.execute(TAKE, (binding, state, address)).fetchall() == []
    assert _rows(su) == 1
    assert len(su.execute(TAKE, (binding, state, _h())).fetchall()) == 1


def _live_session(su: Conn) -> tuple[uuid.UUID, bytes]:
    su.execute("RESET ROLE")
    account = _one(
        su,
        "INSERT INTO player.accounts (kind, classbeat_issuer, classbeat_subject, email, "
        "passkey_user_handle) VALUES ('instructor', %s, %s, %s, %s) RETURNING id",
        (ISSUER, SUBJECT, EMAIL, _h()),
    )
    digest = _h()
    su.execute(
        "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s)", (account, digest)
    )
    as_role(su, "player_app")
    return uuid.UUID(str(account)), digest


def test_a_re_authentication_start_needs_a_live_session_and_is_limited_per_session(
    su: Conn,
) -> None:
    as_role(su, "player_app")
    assert _start(su, purpose="reauth", asking=_h()) == "not_signed_in"
    _, session = _live_session(su)
    answers = [_start(su, purpose="reauth", asking=session, address=_h()) for _ in range(11)]
    assert answers == ["started"] * 10 + ["limited"]


@pytest.mark.parametrize(
    "params",
    [
        (None, b"s" * 32, b"n" * 32, "sign_in", None, None, None, b"a" * 32),
        (b"b" * 32, b"s" * 31, b"n" * 32, "sign_in", None, None, None, b"a" * 32),
        (b"b" * 32, b"s" * 32, b"n" * 32, "other", None, None, None, b"a" * 32),
        (b"b" * 32, b"s" * 32, b"n" * 32, "reauth", None, None, None, b"a" * 32),
        (b"b" * 32, b"s" * 32, b"n" * 32, "sign_in", None, b"q" * 32, None, b"a" * 32),
        (b"b" * 32, b"s" * 32, b"n" * 32, "sign_in", None, None, None, None),
    ],
)
def test_a_start_with_bad_arguments_raises(su: Conn, params: tuple[object, ...]) -> None:
    as_role(su, "player_app")
    with pytest.raises(errors.InvalidParameterValue):
        su.execute(START, params)


def test_a_return_entry_that_is_not_one_is_refused_by_the_table(su: Conn) -> None:
    as_role(su, "player_app")
    with pytest.raises(errors.CheckViolation):
        _start(su, return_to="https://evil.test")


# --- sign-in and sign-up -----------------------------------------------------------------


def test_a_verified_allowlisted_email_creates_the_instructor_and_binds_the_entry(
    su: Conn,
) -> None:
    _allow(su)
    as_role(su, "player_app")
    session = _h()
    assert _complete(su, session=session) == "signed_in"
    found = _instructor(su)
    assert found is not None and found[1] == EMAIL
    su.execute("RESET ROLE")
    bound = su.execute(
        "SELECT bound_issuer, bound_subject FROM player.signup_allowlist WHERE email = %s",
        (EMAIL,),
    ).fetchone()
    assert bound == (ISSUER, SUBJECT)
    signed = su.execute(
        "SELECT account_id, signed_in_at <= now() FROM player.sessions WHERE token_hash = %s",
        (session,),
    ).fetchone()
    assert signed == (found[0], True)
    as_role(su, "player_app")
    assert _events(su, found[0]) == [
        ("login.signed_in", {"method": "classbeat", "account_created": True})
    ]


def test_later_sign_ins_find_the_account_by_identity_whatever_the_email(su: Conn) -> None:
    _allow(su)
    as_role(su, "player_app")
    _complete(su)
    first = _instructor(su)
    assert _complete(su, email="new@example.test") == "signed_in"
    assert _complete(su, email="unverified@example.test", verified=False) == "signed_in"
    assert _complete(su, email=None, verified=False) == "signed_in"
    after = _instructor(su)
    assert first is not None and after is not None
    assert after == (first[0], "new@example.test")


def test_an_email_entry_bound_to_one_identity_lets_no_other_in(su: Conn) -> None:
    _allow(su)
    as_role(su, "player_app")
    _complete(su)
    assert _complete(su, subject="pairwise-2") == "refused"
    assert _instructor(su, "pairwise-2") is None


def test_an_unverified_email_creates_nothing(su: Conn) -> None:
    _allow(su)
    as_role(su, "player_app")
    assert _complete(su, verified=False) == "refused"
    assert _instructor(su) is None


def test_an_entry_bound_by_subject_lets_its_identity_in_without_an_email(su: Conn) -> None:
    su.execute(
        "INSERT INTO player.signup_allowlist (email, bound_issuer, bound_subject) "
        "VALUES ('kept@example.test', %s, %s)",
        (ISSUER, SUBJECT),
    )
    as_role(su, "player_app")
    assert _complete(su, email=None, verified=False) == "signed_in"
    found = _instructor(su)
    assert found is not None and found[1] is None


def test_refused_sign_ups_are_limited_per_address(su: Conn) -> None:
    as_role(su, "player_app")
    address = _h()
    for n in range(10):
        assert _complete(su, subject=f"stranger-{n}", address=address) == "refused"
    su.execute("RESET ROLE")
    _allow(su)
    as_role(su, "player_app")
    # Over the limit the same refusal, even for an identity the allowlist would let in.
    assert _complete(su, address=address) == "refused"
    assert _complete(su, address=_h()) == "signed_in"


def test_an_unlinked_account_with_the_email_is_not_signed_in_to(su: Conn) -> None:
    su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) VALUES (%s, %s)", (EMAIL, _h())
    )
    _allow(su)
    as_role(su, "player_app")
    assert _complete(su) == "signed_in"
    su.execute("RESET ROLE")
    kinds = su.execute(
        "SELECT kind FROM player.accounts WHERE email = %s ORDER BY kind", (EMAIL,)
    ).fetchall()
    assert [k for (k,) in kinds] == ["instructor", "unlinked"]


def test_the_email_link_never_finds_an_instructor(su: Conn) -> None:
    _live_session(su)
    as_role(su, "player_app")
    link = _h()
    usable = _one(
        su,
        f"SELECT player.auth_request_login(%s, %s, %s, %s, {CLIENT})",
        (EMAIL, link, _h(), _h()),
    )
    assert usable is False
    found = _instructor(su)
    assert found is not None and _events(su, found[0]) == []


# --- re-authentication -------------------------------------------------------------------


def _reauth(
    su: Conn, asking: bytes, subject: str = SUBJECT, auth_age: int = 0, started_ago: int = 30
) -> object:
    return _one(
        su,
        REAUTH,
        (asking, ISSUER, subject, auth_age, _started(su, started_ago), _h()),
    )


def _started(su: Conn, seconds: int) -> object:
    return _one(su, "SELECT now() - %s * interval '1 second'", (seconds,))


def test_a_fresh_re_authentication_of_the_same_identity_issues_a_session(su: Conn) -> None:
    account, asking = _live_session(su)
    assert _reauth(su, asking) == "reauthenticated"
    assert _events(su, account) == [("login.reauthenticated", {"method": "classbeat"})]
    su.execute("RESET ROLE")
    assert _one(su, "SELECT count(*) FROM player.sessions WHERE account_id = %s", (account,)) == 2


@pytest.mark.parametrize(
    ("subject", "auth_age", "started_ago", "reason"),
    [
        ("pairwise-other", 0, 30, "other_identity"),
        (SUBJECT, 100, 30, "not_fresh"),
    ],
)
def test_a_re_authentication_of_another_identity_or_a_stale_one_is_refused(
    su: Conn, subject: str, auth_age: int, started_ago: int, reason: str
) -> None:
    account, asking = _live_session(su)
    assert _reauth(su, asking, subject, auth_age, started_ago) == "refused"
    assert _events(su, account) == [("reauth.refused", {"method": "classbeat", "reason": reason})]
    su.execute("RESET ROLE")
    assert _one(su, "SELECT count(*) FROM player.sessions WHERE account_id = %s", (account,)) == 1


def test_an_authentication_up_to_60_seconds_before_the_start_is_fresh(su: Conn) -> None:
    _, asking = _live_session(su)
    assert _reauth(su, asking, auth_age=89, started_ago=30) == "reauthenticated"


def test_a_re_authentication_without_a_live_session_is_refused(su: Conn) -> None:
    as_role(su, "player_app")
    assert _reauth(su, _h()) == "refused"


# --- the purge -------------------------------------------------------------------------------


def test_the_purge_removes_expired_flows_and_event_ids(su: Conn) -> None:
    as_role(su, "player_app")
    _start(su)
    _start(su)
    su.execute("RESET ROLE")
    su.execute(
        "UPDATE player.classbeat_sign_ins SET expires_at = now() - interval '1 second' "
        "WHERE ctid = (SELECT ctid FROM player.classbeat_sign_ins LIMIT 1)"
    )
    su.execute(
        "INSERT INTO player.classbeat_event_ids (jti_hash, expires_at) VALUES "
        "(%s, now() - interval '1 second'), (%s, now() + interval '1 day')",
        (_h(), _h()),
    )
    su.execute("SELECT player.auth_purge_expired()")
    assert _one(su, "SELECT count(*) FROM player.classbeat_sign_ins") == 1
    assert _one(su, "SELECT count(*) FROM player.classbeat_event_ids") == 1


def test_player_app_reaches_neither_new_table(su: Conn) -> None:
    statements: tuple[LiteralString, ...] = (
        "SELECT 1 FROM player.classbeat_sign_ins",
        "SELECT 1 FROM player.classbeat_event_ids",
    )
    for statement in statements:
        as_role(su, "player_app")
        with pytest.raises(errors.InsufficientPrivilege):
            su.execute(statement)
        su.rollback()
