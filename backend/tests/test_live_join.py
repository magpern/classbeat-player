"""`POST /api/live/join`, on fakes (live/join_route.py, live/riders.py; ADR 0007, sections 2 and
3; ADR 0002, sections 8 and 10).

- a join with the current join code and a nickname gets the contract's `join-answer`: a rider
  token, `no-store`, held as its hash; the rider gets an id of 8 random bytes in base64url,
  never derived from the token or the nickname, the same for the token's whole life;
- the nickname loses its control characters; one with nothing left, or a malformed body, is 422
  `invalid_request` and counts nothing;
- one answer, 403 `cannot_join` with the same body, for an unknown code, a locked session, a
  full session and a session's earlier code;
- places: 60 rider tokens connected at a time (the 60th and the 61st); a token's new connection
  replacing its old one takes no new place;
- a token with no connection for 5 minutes is dropped, and so is one that never connected;
- 120 joins a minute per session, every join that names it counted, and not per address;
  unknown codes, an earlier code included, count for the caller's address: past 60 a minute,
  429 with `Retry-After` for every join from it.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from typing import Any, cast

import httpx
import pytest

from player_backend.code_policy import ALPHABET
from player_backend.token_policy import is_token, token_hash
from tests.livehelp import live_app, validator

JOIN = "/api/live/join"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _join(live: Any, code: str, nickname: str = "Sam") -> httpx.Response:
    return live.client.post(JOIN, json={"session": code, "nickname": nickname})


def _token(answer: httpx.Response) -> str:
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert validator("join-answer.schema.json").is_valid(body), body  # pyright: ignore[reportUnknownMemberType]
    assert answer.headers.get("cache-control") in (None, "no-store")
    return str(body["riderToken"])


def _cannot_join(answer: httpx.Response) -> None:
    assert (answer.status_code, answer.json()) == (403, {"error": "cannot_join"}), answer.text


def _other(code: str) -> str:
    """A well-formed join code that is not `code`."""
    first = ALPHABET[(ALPHABET.index(code[0]) + 1) % len(ALPHABET)]
    return first + code[1:]


def _seat(live: Any, token: str) -> Any:
    seat = live.registry.rider_connected(token, live.clock())
    assert seat is not None
    return seat


def test_a_join_gets_a_rider_token_held_as_its_hash(live: Any) -> None:
    started = live.session()
    token = _token(_join(live, started.join_code))
    assert is_token("rdr", token)
    # Held as its hash only: the clear token is nowhere in the registry's state.
    assert live.registry._by_rider.keys() == {token_hash(token)}  # pyright: ignore[reportPrivateUsage]
    assert token not in repr(cast(object, vars(live.registry)))
    seat = _seat(live, token)
    assert seat.session_id == started.session_id and seat.announced
    assert [(r.rider, r.nickname) for r in live.registry.riders_in(started.session_id)] == [
        (seat.rider, "Sam")
    ]


def test_the_join_code_may_be_lower_case_or_without_its_hyphen_only_as_the_page_sends_it(
    live: Any,
) -> None:
    started = live.session()
    # The contract takes XXXX-XXXX only: the page normalises what was typed.
    for code in (started.join_code.lower(), started.join_code.replace("-", "")):
        answer = _join(live, code)
        assert (answer.status_code, answer.json()) == (422, {"error": "invalid_request"})


def test_a_rider_id_is_random_never_derived_and_the_same_for_the_tokens_life(live: Any) -> None:
    started = live.session()
    tokens = [_token(_join(live, started.join_code, "Sam")) for _ in range(20)]
    seats = [_seat(live, t) for t in tokens]
    ids = [s.rider for s in seats]
    assert len(set(ids)) == 20  # the same nickname, a different id each time
    for token, rider in zip(tokens, ids, strict=True):
        assert validator("rider-joined.schema.json").is_valid(  # pyright: ignore[reportUnknownMemberType]
            {"v": 1, "type": "rider_joined", "rider": rider, "nickname": "Sam"}
        )
        assert rider not in token
        for derived in (hashlib.sha256(token.encode()).digest(), token_hash(token)):
            assert rider.encode() not in derived and rider not in derived.hex()
    # Its connection closes and comes back: the same id, announced again.
    first = seats[0]
    assert live.registry.rider_disconnected(started.session_id, first.rider, live.clock())
    again = _seat(live, tokens[0])
    assert (again.rider, again.announced) == (first.rider, True)
    # A new connection replacing the open one: the same id, and nothing to announce.
    replacing = _seat(live, tokens[0])
    assert (replacing.rider, replacing.announced) == (first.rider, False)


def test_the_nickname_loses_its_control_characters(live: Any) -> None:
    started = live.session()
    token = _token(_join(live, started.join_code, "‮Sa\x00m\n"))
    _seat(live, token)
    assert [r.nickname for r in live.registry.riders_in(started.session_id)] == ["Sam"]


@pytest.mark.parametrize(
    "body",
    [
        {"session": "BCDF-GHJK"},
        {"nickname": "Sam"},
        {"session": "BCDF-GHJK", "nickname": ""},
        {"session": "BCDF-GHJK", "nickname": "a" * 25},
        {"session": "BCDF-GHJK", "nickname": "\x00\x01"},
        {"session": "BCDF-GHJK", "nickname": "   "},
        {"session": "BCDF-GHJK", "nickname": 7},
        {"session": "BCDF-GHJK", "nickname": "Sam", "ftp": 250},
        {"session": "BCDF-GHJK", "nickname": "Sam", "hrmax": 190},
        {"session": "bcdf-ghjk", "nickname": "Sam"},
        ["BCDF-GHJK", "Sam"],
    ],
)
def test_a_malformed_join_is_invalid_request_and_counts_nothing(live: Any, body: object) -> None:
    started = live.session()
    for _ in range(130):
        answer = live.client.post(JOIN, json=body)
        assert (answer.status_code, answer.json()) == (422, {"error": "invalid_request"})
    # Neither the address (60) nor the session (120) counted any of them.
    _token(_join(live, started.join_code))


def test_a_body_not_sent_as_json_is_invalid_request(live: Any) -> None:
    started = live.session()
    content = json.dumps({"session": started.join_code, "nickname": "Sam"}).encode()
    answer = live.client.post(JOIN, content=content, headers={"content-type": "text/plain"})
    assert (answer.status_code, answer.json()) == (422, {"error": "invalid_request"})


def test_one_answer_for_an_unknown_code_a_locked_a_full_session_and_an_old_code(
    live: Any,
) -> None:
    answers: list[httpx.Response] = []
    unknown = live.session()
    answers.append(_join(live, _other(unknown.join_code)))
    locked = live.session()
    assert live.registry.lock(locked.session_id, True) is True
    answers.append(_join(live, locked.join_code))
    full = live.session()
    for _ in range(60):
        _seat(live, _token(_join(live, full.join_code)))
    answers.append(_join(live, full.join_code))
    renewed = live.session()
    assert live.registry.new_join_code(renewed.session_id, live.clock()) is not None
    answers.append(_join(live, renewed.join_code))
    for answer in answers:
        _cannot_join(answer)
        assert validator("error.schema.json").is_valid(answer.json())  # pyright: ignore[reportUnknownMemberType]
    first = answers[0]
    for answer in answers[1:]:
        assert answer.content == first.content
        assert dict(answer.headers) == dict(first.headers)


def test_the_60th_rider_connects_and_the_61st_does_not(live: Any) -> None:
    started = live.session()
    tokens = [_token(_join(live, started.join_code)) for _ in range(61)]
    seats = [_seat(live, t) for t in tokens[:60]]
    assert len(live.registry.riders_in(started.session_id)) == 60
    # The cap counts connections, not tokens given out: the 61st token exists and cannot connect.
    assert live.registry.rider_connected(tokens[60], live.clock()) is None
    _cannot_join(_join(live, started.join_code))
    # A connected token's new connection replacing its old one takes no new place.
    assert not _seat(live, tokens[0]).announced
    # One rider leaves (both of its connections close): the 61st connects.
    for _ in range(2):
        live.registry.rider_disconnected(started.session_id, seats[0].rider, live.clock())
    assert _seat(live, tokens[60]).announced
    assert live.registry.rider_connected(tokens[0], live.clock()) is None


def test_a_token_that_never_connected_is_dropped_after_5_minutes(live: Any) -> None:
    started = live.session()
    token = _token(_join(live, started.join_code))
    live.clock.now += 299.0
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()
    later = _token(_join(live, started.join_code))
    live.clock.now += 1.0
    live.hub.service.sweep()
    assert live.registry.rider_connected(token, live.clock()) is None
    assert live.registry._by_rider.keys() == {token_hash(later)}  # pyright: ignore[reportPrivateUsage]
    _seat(live, later)


def test_a_token_with_no_connection_for_5_minutes_is_dropped(live: Any) -> None:
    started = live.session()
    token = _token(_join(live, started.join_code))
    seat = _seat(live, token)
    live.registry.host_connected(started.session_id)
    # Connected: never dropped, however long.
    live.clock.now += 3600.0
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()
    assert live.registry.rider_disconnected(started.session_id, seat.rider, live.clock())
    # Back within its 5 minutes: the same rider.
    live.clock.now += 299.0
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()
    assert _seat(live, token).rider == seat.rider
    live.registry.rider_disconnected(started.session_id, seat.rider, live.clock())
    live.clock.now += 300.0
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()
    assert live.registry.rider_connected(token, live.clock()) is None
    assert live.registry.riders_in(started.session_id) == []
    assert live.registry._by_rider == {}  # pyright: ignore[reportPrivateUsage]


def test_120_joins_a_minute_per_session_and_not_per_address(live: Any) -> None:
    started = live.session()
    other = live.session()
    for _ in range(120):
        _token(_join(live, started.join_code))
    _cannot_join(_join(live, started.join_code))
    # The same address joins another session: the limit is the session's, not the address's.
    _token(_join(live, other.join_code))
    live.clock.now += 60.0
    live.registry.confirm([started.session_id, other.session_id], live.clock())
    _token(_join(live, started.join_code))


def test_a_refused_join_counts_against_the_sessions_120(live: Any) -> None:
    started = live.session()
    live.registry.lock(started.session_id, True)
    for _ in range(120):
        _cannot_join(_join(live, started.join_code))
    live.registry.lock(started.session_id, False)
    _cannot_join(_join(live, started.join_code))
    live.clock.now += 60.0
    live.registry.confirm([started.session_id], live.clock())
    _token(_join(live, started.join_code))


def test_unknown_codes_count_for_the_address(live: Any) -> None:
    started = live.session()
    unknown = _other(started.join_code)
    for _ in range(60):
        _cannot_join(_join(live, unknown))
    answer = _join(live, started.join_code)
    assert (answer.status_code, answer.json()) == (429, {"error": "too_many_requests"})
    assert answer.headers["retry-after"] == "60"
    live.clock.now += 60.0
    live.registry.confirm([started.session_id], live.clock())
    _token(_join(live, started.join_code))


def test_an_earlier_join_code_counts_for_the_address_as_an_unknown_one(live: Any) -> None:
    started = live.session()
    assert live.registry.new_join_code(started.session_id, live.clock()) is not None
    for _ in range(60):
        _cannot_join(_join(live, started.join_code))
    answer = _join(live, started.join_code)
    assert answer.status_code == 429


def test_unknown_joins_and_control_exchanges_share_the_addresss_count(live: Any) -> None:
    started = live.session()
    unknown = _other(started.join_code)
    for _ in range(30):
        _cannot_join(_join(live, unknown))
        live.client.post("/api/live/control", json={"session": unknown, "code": unknown})
    assert _join(live, started.join_code).status_code == 429


def test_a_join_to_a_session_past_its_lifetime_ends_it_and_is_cannot_join(live: Any) -> None:
    started = live.session()
    live.clock.now += 12 * 3600.0
    _cannot_join(_join(live, started.join_code))
    assert live.registry.running() == []
    assert live.ends == [(started.session_id, "lifetime")]
