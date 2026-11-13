"""The live sessions in memory (live/registry.py): ADR 0002, sections 2, 3 and 8; ADR 0005,
sections 2 and 6. No database: times are passed in."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from jsonschema import Draft202012Validator

from player_backend.live.registry import Dropped, Ended, Registry, Started
from player_backend.live_session_policy import HOST_AWAY_LIMIT, LIFETIME_LIMIT, UNCONFIRMED_LIMIT
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash, token_string

SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "live" / "v1"
ACCOUNT, OTHER = uuid.uuid4(), uuid.uuid4()
HASH = bytes(range(32))


def _start(
    registry: Registry,
    device: uuid.UUID | None = None,
    account: uuid.UUID = ACCOUNT,
    at: float = 0.0,
) -> Started:
    started = registry.start(account, device or uuid.uuid4(), HASH, at)
    assert started is not None
    return started


def _watched(registry: Registry) -> list[Ended | Dropped]:
    seen: list[Ended | Dropped] = []
    registry.watch(seen.append)
    return seen


def test_a_start_answers_the_contracts_session_answer() -> None:
    started = _start(Registry())
    answer = {
        "sessionId": str(started.session_id),
        "joinCode": started.join_code,
        "hostToken": started.host_token,
    }
    schema = json.loads((SCHEMA / "session-answer.schema.json").read_text(encoding="utf-8"))
    assert list(Draft202012Validator(schema).iter_errors(answer)) == []  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]


def test_the_host_token_is_held_as_a_hash_and_never_shown() -> None:
    registry = Registry()
    started = _start(registry)
    assert started.host_token not in repr(started)
    assert started.host_token not in repr(vars(registry))
    assert started.host_token.encode() not in repr(vars(registry)).encode()
    # Nor any hash a session holds: the device token's, the host token's, a controller's.
    registry.add_controller(started.session_id, b"\x07" * 32, b"\x08" * 32)
    held = repr(list(vars(registry)["_sessions"].values()))
    for digest in (HASH, token_hash(started.host_token), b"\x07" * 32, b"\x08" * 32):
        assert repr(digest) not in held and digest.hex() not in held


def test_only_the_host_token_finds_its_session() -> None:
    registry = Registry()
    started = _start(registry)
    assert registry.host_session(started.host_token, 1.0) == started.session_id
    secret = started.host_token.removeprefix("cbp_hst_")
    # Refused by prefix before any lookup: the same secret as another type finds nothing.
    for kind in ("ctl", "rdr", "dev"):
        assert registry.host_session(token_string(kind, secret), 1.0) is None  # pyright: ignore[reportArgumentType]
    for value in (None, 7, "", new_token("hst"), started.host_token + "x"):
        assert registry.host_session(value, 1.0) is None


def test_one_session_per_device() -> None:
    registry = Registry()
    seen = _watched(registry)
    device = uuid.uuid4()
    first = _start(registry, device)
    second = _start(registry, device, at=5.0)
    assert [e.session_id for e in second.replaced] == [first.session_id]
    assert [(e.session_id, e.reason) for e in seen if isinstance(e, Ended)] == [
        (first.session_id, "replaced")
    ]
    assert registry.host_session(first.host_token, 6.0) is None
    assert registry.host_session(second.host_token, 6.0) == second.session_id
    assert [r.session_id for r in registry.running()] == [second.session_id]


def test_three_per_account_and_the_fourth_is_refused() -> None:
    registry = Registry()
    seen = _watched(registry)
    held = [_start(registry) for _ in range(3)]
    assert registry.start(ACCOUNT, uuid.uuid4(), HASH, 1.0) is None
    assert seen == [] and len(registry.running(ACCOUNT)) == 3
    # Another account starts as usual, and a device of the three may start again.
    _start(registry, account=OTHER)
    assert len(registry.running()) == 4
    assert registry.end(held[0].session_id, "host_ended") is not None
    _start(registry)
    assert len(registry.running(ACCOUNT)) == 3


def test_the_join_codes_are_unique_and_name_their_session() -> None:
    registry = Registry()
    started = [_start(registry, account=uuid.uuid4()) for _ in range(50)]
    assert len({s.join_code for s in started}) == 50
    first = started[0]
    assert re.fullmatch(r"[B-Z]{4}-[B-Z]{4}", first.join_code)
    assert registry.session_of_code(first.join_code.lower().replace("-", " ")) == first.session_id
    assert registry.session_of_code("BBBB-BBBA") is None
    registry.end(first.session_id, "host_ended")
    assert registry.session_of_code(first.join_code) is None


def test_end_closes_it_once_and_the_host_token_with_it() -> None:
    registry = Registry()
    seen = _watched(registry)
    started = _start(registry)
    ended = registry.end(started.session_id, "host_ended")
    assert ended is not None and ended.reason == "host_ended" and ended.account_id == ACCOUNT
    assert registry.end(started.session_id, "host_ended") is None
    assert seen == [ended]
    assert registry.host_session(started.host_token, 1.0) is None
    assert registry.running() == []


def test_a_host_that_never_connects_has_15_minutes() -> None:
    registry = Registry()
    started = _start(registry)
    registry.confirm([started.session_id], HOST_AWAY_LIMIT - 60)
    assert registry.end_due(HOST_AWAY_LIMIT - 0.1) == []
    ended = registry.end_due(HOST_AWAY_LIMIT)
    assert [(e.session_id, e.reason) for e in ended] == [(started.session_id, "host_away")]


def test_15_minutes_after_the_host_connection_is_lost() -> None:
    registry = Registry()
    started = _start(registry)
    assert registry.host_connected(started.session_id)
    for at in range(0, 3600, 60):
        registry.confirm([started.session_id], float(at))
    assert registry.end_due(3600.0) == []
    assert registry.host_lost(started.session_id, 3600.0)
    registry.confirm([started.session_id], 3600.0 + HOST_AWAY_LIMIT - 30)
    assert registry.host_session(started.host_token, 3600.0 + HOST_AWAY_LIMIT - 1) is not None
    # The host's token, used after the 15 minutes, ends the session rather than finding it.
    seen = _watched(registry)
    assert registry.host_session(started.host_token, 3600.0 + HOST_AWAY_LIMIT) is None
    assert [(e.session_id, e.reason) for e in seen if isinstance(e, Ended)] == [
        (started.session_id, "host_away")
    ]


def test_a_reconnect_stops_the_15_minutes() -> None:
    registry = Registry()
    started = _start(registry)
    registry.host_connected(started.session_id)
    registry.host_lost(started.session_id, 100.0)
    registry.host_connected(started.session_id)
    registry.confirm([started.session_id], 100.0 + HOST_AWAY_LIMIT)
    assert registry.end_due(100.0 + HOST_AWAY_LIMIT + 1) == []


def test_12_hours_at_most() -> None:
    registry = Registry()
    started = _start(registry)
    registry.host_connected(started.session_id)
    registry.confirm([started.session_id], LIFETIME_LIMIT - 10)
    assert registry.end_due(LIFETIME_LIMIT - 0.1) == []
    assert [e.reason for e in registry.end_due(LIFETIME_LIMIT)] == ["lifetime"]


def test_a_session_left_unconfirmed_ends() -> None:
    registry = Registry()
    started = _start(registry)
    registry.host_connected(started.session_id)
    assert registry.end_due(UNCONFIRMED_LIMIT - 0.1) == []
    assert [e.reason for e in registry.end_due(UNCONFIRMED_LIMIT)] == ["unconfirmed"]


def test_two_controllers_at_most_and_a_drop_frees_the_place() -> None:
    registry = Registry()
    seen = _watched(registry)
    started = _start(registry)
    site_session = bytes(32)
    assert registry.add_controller(started.session_id, b"a" * 32, site_session) == 1
    assert registry.add_controller(started.session_id, b"b" * 32, None) == 2
    assert registry.add_controller(started.session_id, b"c" * 32, None) is None
    listed = registry.signed_in_controllers(ACCOUNT)
    assert [(c.session_id, c.slot) for c in listed] == [(started.session_id, 1)]
    assert registry.signed_in_controllers(OTHER) == []
    # Dropping by the site session it holds: another site session's hash drops nothing.
    assert not registry.drop_controller(started.session_id, 1, b"x" * 32)
    assert registry.drop_controller(started.session_id, 1, site_session)
    assert seen == [Dropped(started.session_id, 1)]
    assert registry.add_controller(started.session_id, b"d" * 32, None) == 1
    assert registry.add_controller(uuid.uuid4(), b"e" * 32, None) is None


def test_discard_takes_a_start_back_without_telling_anyone() -> None:
    registry = Registry()
    seen = _watched(registry)
    started = _start(registry)
    registry.discard(started.session_id)
    assert seen == [] and registry.running() == []
    assert registry.host_session(started.host_token, 1.0) is None
