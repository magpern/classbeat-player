"""One live session's rider traffic never reaches another's (live/rider_role.py; ADR 0007,
sections 2 and 3; ADR 0002, section 8).

Two sessions, each with a host and a rider. Everything in the first one (its host coming and
going, its riders joining and leaving, its `rider_state`, its host's `drop_rider` with the other
session's real rider id, its `lock`, its `new_join_code` and its end) reaches no one in the
second. The second's rider stays connected, and its lock and join code are unchanged.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import ExitStack
from typing import Any

import pytest

from tests.livehelp import SCHEMA, closed, live_app, nothing, recv

JOIN = "/api/live/join"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _rider_state() -> dict[str, Any]:
    path = SCHEMA / "examples" / "rider-state" / "valid" / "running-three-coming.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _joins(live: Any, code: str) -> int:
    answer = live.client.post(JOIN, json={"session": code, "nickname": "Kim"})
    return int(answer.status_code)


def test_no_rider_traffic_crosses_from_one_session_to_another(live: Any) -> None:
    first, second = live.session(), live.session()
    rider_a = live.rider(first.join_code, "Sam")
    rider_b = live.rider(second.join_code, "Alex")
    with ExitStack() as stack:
        host_b = stack.enter_context(live.joined(second.host_token, None))
        b = stack.enter_context(live.riding(rider_b))
        b_id = str(recv(host_b)["rider"])

        a_host = stack.enter_context(ExitStack())
        host_a = a_host.enter_context(live.joined(first.host_token, None))
        nothing(b)  # the other session's host came in: no `host_status` here
        a = stack.enter_context(live.riding(rider_a))
        assert recv(host_a)["type"] == "rider_joined"
        nothing(host_b)  # the other session's rider joined: no `rider_joined` here

        state = _rider_state()
        host_a.send_json(state)
        assert recv(a) == state
        nothing(b)

        with live.riding(live.rider(first.join_code, "Lee")):  # joins, then leaves
            assert recv(host_a)["type"] == "rider_joined"
        assert recv(host_a)["type"] == "rider_left"
        nothing(host_b)

        # The first session's host leaves and comes back: its riders are told, not the other's.
        a_host.close()
        assert recv(a) == {"v": 1, "type": "host_status", "connected": False}
        nothing(b)
        host_a = stack.enter_context(live.joined(first.host_token, None))
        assert recv(a) == {"v": 1, "type": "host_status", "connected": True}
        assert recv(host_a)["type"] == "rider_joined"  # its own rider, replayed
        assert recv(host_a)["type"] == "lock_state"
        nothing(b)
        nothing(host_b)

        # A real rider id of the other session is not this host's to remove.
        host_a.send_json({"v": 1, "type": "drop_rider", "rider": b_id})
        nothing(host_a)
        assert live.hub.dropped == {"unknown_rider": 1}
        nothing(b)
        nothing(host_b)
        assert [r.rider for r in live.registry.riders_in(second.session_id)] == [b_id]

        host_a.send_json({"v": 1, "type": "lock", "locked": True})
        assert recv(host_a) == {"v": 1, "type": "lock_state", "locked": True}
        host_a.send_json({"v": 1, "type": "new_join_code"})
        assert recv(host_a)["type"] == "join_code"
        nothing(b)
        nothing(host_b)
        assert live.registry.locked(second.session_id) is False
        assert _joins(live, second.join_code) == 200  # the other's code still lets riders in

        host_a.send_json({"v": 1, "type": "end"})
        assert recv(host_a)["type"] == "ended"
        assert recv(a) == {"v": 1, "type": "ended", "reason": "host_ended"}
        assert closed(a) == 4403
        nothing(b)
        nothing(host_b)

        # The other session's rider is still connected and still sent its own class.
        host_b.send_json(state)
        assert recv(b) == state
