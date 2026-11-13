"""Rule guard, end to end: every message of the contract, sent by the host and by a controller,
is routed only as `schema/live/v1/routing.json` says (ADR 0005, sections 4 and 7; ADR 0002,
section 8).

Each valid example of every WebSocket message is sent from each role after `hello`. What the
other connections receive is read up to a probe and compared with what the table routes: from a
controller only `command` goes on (to the host, with the server's slot); from the host only
`companion_state` goes on (to the controllers). Everything else is dropped and counted, and the
sender gets nothing back. `end` is left out here (it ends the session: test_live_ws_ends.py).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import WebSocketTestSession

from tests.livehelp import SCHEMA, command, companion_state, live_app, nothing, recv

PLACEHOLDER, SECRET = "<secret43>", ("Ab3-_xY9" * 6)[:43]


def _examples() -> list[tuple[str, dict[str, Any]]]:
    routing = json.loads((SCHEMA / "routing.json").read_text(encoding="utf-8"))
    out: list[tuple[str, dict[str, Any]]] = []
    for schema in sorted({m["schema"] for m in routing["messages"]}):
        folder = SCHEMA / "examples" / schema.removesuffix(".schema.json") / "valid"
        for path in sorted(Path(folder).glob("*.json")):
            text = path.read_text(encoding="utf-8").replace(PLACEHOLDER, SECRET)
            out.append((schema, json.loads(text)))
    return out


EXAMPLES = _examples()


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _until(ws: WebSocketTestSession, probe: dict[str, Any]) -> list[dict[str, Any]]:
    seen: list[dict[str, Any]] = []
    while (message := recv(ws)) != probe:
        seen.append(message)
    return seen


def test_every_example_is_present() -> None:
    kinds = {message["type"] for _, message in EXAMPLES}
    assert len(EXAMPLES) > 40 and "companion_state" in kinds and "command" in kinds


def test_from_a_controller_only_command_goes_on(live: Any) -> None:
    started = live.session()
    with (
        live.joined(started.host_token, None) as host,
        live.joined(live.controller(started)) as phone,
        live.joined(live.controller(started)) as other,
    ):
        recv(host)
        recv(host)
        expected: list[dict[str, Any]] = []
        for schema, message in EXAMPLES:
            live.clock.now += 1.0  # inside every rate
            phone.send_json(message)
            if schema == "command.schema.json":
                expected.append({**message, "slot": 1})
        live.clock.now += 1.0
        phone.send_json(command(99))
        assert _until(host, {**command(99), "slot": 1}) == expected
        nothing(phone)
        nothing(other)
    assert sum(live.hub.dropped.values()) == len(EXAMPLES) - len(expected)
    assert sum(live.hub.refused.values()) == 0


def test_from_the_host_only_companion_state_goes_on(live: Any) -> None:
    started = live.session()
    with (
        live.joined(started.host_token, None) as host,
        live.joined(live.controller(started)) as one,
        live.joined(live.controller(started)) as two,
    ):
        recv(host)
        recv(host)
        expected: list[dict[str, Any]] = []
        for schema, message in EXAMPLES:
            # These act (end the session, answer the host, drop a phone): their own tests are
            # test_live_ws_ends.py and test_live_control_codes.py, which also show that a
            # controller is sent nothing of a control code.
            if schema in {"end.schema.json", "make-code.schema.json", "drop.schema.json"}:
                continue
            live.clock.now += 1.0
            host.send_json(message)
            if schema == "companion-state.schema.json":
                expected.append(message)
        probe = companion_state() | {"seq": 999}
        live.clock.now += 1.0
        host.send_json(probe)
        assert _until(one, probe) == expected
        assert _until(two, probe) == expected
        one.send_json(command(1))  # the host's own probe: it got nothing back before this
        assert recv(host) == {**command(1), "slot": 1}
    assert sum(live.hub.refused.values()) == 0
