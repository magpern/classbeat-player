"""The live WebSocket's limits after `hello`, on fakes (live/ws.py, live/link.py; ADR 0002,
sections 8 and 10; ADR 0005, section 5).

- a message over 16 KiB closes the connection with 1009;
- more than 10 messages a second closes it with 1008, the host's included, dropped messages
  counted too;
- a phone's flood of commands never gets the host's connection closed: at most 2 a second of
  it reach the host;
- a connection that does not read what it is sent is closed (1008) instead of being queued for;
- uvicorn, as the server runs it, has a WebSocket implementation.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from uvicorn.config import Config

from player_backend.live.link import Link
from player_backend.live_limit_policy import MESSAGE_MAX_BYTES, OUTBOX_MAX
from tests.livehelp import closed, command, command_id, companion_state, live_app, nothing, recv


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _padded(size: int) -> str:
    text = json.dumps(companion_state())
    return text + " " * (size - len(text.encode()))


@pytest.mark.parametrize("role", ["host", "controller"])
def test_a_message_over_16_kib_closes_1009(live: Any, role: str) -> None:
    started = live.session()
    token = started.host_token if role == "host" else live.controller(started)
    with live.joined(token, None) if role == "host" else live.joined(token) as ws:
        ws.send_text(_padded(MESSAGE_MAX_BYTES))  # at the limit: taken
        ws.send_text(_padded(MESSAGE_MAX_BYTES + 1))
        assert closed(ws) == 1009


@pytest.mark.parametrize("role", ["host", "controller"])
def test_more_than_10_messages_a_second_closes_1008(live: Any, role: str) -> None:
    started = live.session()
    token = started.host_token if role == "host" else live.controller(started)
    with live.joined(token, None) if role == "host" else live.joined(token) as ws:
        for _ in range(10):
            ws.send_text("not a message")  # dropped, and counted against the limit
        nothing(ws)
        ws.send_text("not a message")
        assert closed(ws) == 1008


def test_ten_a_second_go_on_as_the_seconds_pass(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        for _ in range(3):
            for _ in range(10):
                host.send_text("{}")
            nothing(host, 0.1)
            live.clock.now += 1.0
        assert live.hub.connected(started.session_id) == (True, ())


def test_a_phones_flood_never_closes_the_host(live: Any) -> None:
    started = live.session()
    with (
        live.joined(started.host_token, None) as host,
        live.joined(live.controller(started)) as phone,
    ):
        recv(host)
        for n in range(10):
            phone.send_json(command(n))
        assert [recv(host)["id"] for _ in range(2)] == [command_id(0), command_id(1)]
        assert [recv(phone)["reason"] for _ in range(8)] == ["rate"] * 8
        nothing(host)
        assert live.hub.connected(started.session_id) == (True, (1,))


class _Stuck:
    """A peer that never takes what it is sent."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closes: list[int] = []

    async def send_text(self, data: str) -> None:
        self.sent.append(data)
        await asyncio.Event().wait()

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        self.closes.append(code)


def test_a_connection_that_does_not_read_is_closed_not_queued_for() -> None:
    async def run() -> tuple[_Stuck, Link]:
        peer = _Stuck()
        link = Link(peer, "controller", uuid.uuid4(), 1, "code")
        link.writer = asyncio.create_task(link.write())
        for n in range(OUTBOX_MAX + 2):
            link.put(str(n))
            await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert link.writer.done()
        return peer, link

    peer, link = asyncio.run(run())
    assert link.close_code == 1008
    assert peer.sent == ["0"]  # the one send that never completed; nothing more was tried
    link.put("late")  # a closing link takes nothing
    assert link.closing


def test_an_ended_goes_out_before_the_close() -> None:
    class Peer:
        def __init__(self) -> None:
            self.log: list[object] = []

        async def send_text(self, data: str) -> None:
            self.log.append(data)

        async def close(self, code: int = 1000, reason: str | None = None) -> None:
            self.log.append(code)

    async def run() -> list[object]:
        peer = Peer()
        link = Link(peer, "host", uuid.uuid4())
        writer = asyncio.create_task(link.write())
        link.put("ended")
        link.close(4403)
        link.close(4409)  # the first close is the one sent
        await asyncio.wait_for(writer, 1)
        return peer.log

    assert asyncio.run(run()) == ["ended", 4403]


def test_uvicorn_serves_websockets() -> None:
    async def app(_scope: object, _receive: object, _send: object) -> None:
        return None

    config = Config(app)  # pyright: ignore[reportArgumentType]
    config.load()
    assert config.ws_protocol_class is not None
