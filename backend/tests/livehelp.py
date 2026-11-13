"""Test helper for the live WebSocket on fakes: an app with the live routes, the registry and the
hub, no database (its two calls are faked), a clock the test moves, and WebSocket sessions that
read with a deadline so that a test waiting for a message that never comes fails instead of
hanging. Tokens are made at run time; none is written in a file."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import anyio
from fastapi import FastAPI
from jsonschema import Draft202012Validator
from starlette.testclient import TestClient, WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.http_errors import install_error_handlers
from player_backend.live import router
from player_backend.live.hub import Hub
from player_backend.live.registry import Registry, Started
from player_backend.live.service import LiveService
from player_backend.mail import Mailer
from player_backend.settings import Settings
from player_backend.site.state import SiteState
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash

SITE = "https://player.example.test"
WS = "/api/live/ws"
SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "live" / "v1"
SITE_SESSION = b"s" * 32


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@dataclass
class Live:
    client: TestClient
    hub: Hub
    clock: Clock
    ends: list[tuple[uuid.UUID, str]] = field(default_factory=list[tuple[uuid.UUID, str]])
    # The audit events written after `auth_enter_device` (faked): event name and detail.
    events: list[tuple[str, dict[str, str]]] = field(
        default_factory=list[tuple[str, dict[str, str]]]
    )

    @property
    def registry(self) -> Registry:
        return self.hub.service.registry

    def session(self) -> Started:
        started = self.registry.start(uuid.uuid4(), uuid.uuid4(), b"d" * 32, self.clock())
        assert started is not None
        return started

    def controller(self, started: Started, signed_in: bool = False) -> str:
        """A controller token for the session, held as the controller routes hold one."""
        token = new_token("ctl")
        slot = self.registry.add_controller(
            started.session_id, token_hash(token), SITE_SESSION if signed_in else None
        )
        assert slot is not None
        return token

    @contextmanager
    def connect(self, origin: str | None = SITE) -> Generator[WebSocketTestSession]:
        headers = {} if origin is None else {"origin": origin}
        # Starlette's test client is typed loosely: the session is what `websocket_connect` makes.
        session = cast(WebSocketTestSession, self.client.websocket_connect(WS, headers=headers))  # pyright: ignore[reportUnknownMemberType]
        with session as ws:
            yield ws

    @contextmanager
    def joined(self, token: str, origin: str | None = SITE) -> Generator[WebSocketTestSession]:
        """Connected and said `hello`; its `welcome` is read and checked."""
        with self.connect(origin) as ws:
            ws.send_json(hello(token))
            assert recv(ws)["type"] == "welcome"
            yield ws


def until(check: Callable[[], bool], seconds: float = 3.0) -> bool:
    """Whether `check` holds within `seconds` (an expired session's end is written off the
    event loop, on a worker thread)."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.01)
    return check()


def hello(token: str) -> dict[str, object]:
    return {"v": 1, "type": "hello", "token": token}


async def _receive(ws: WebSocketTestSession, seconds: float) -> Any:
    with anyio.fail_after(seconds):
        return await ws._send_rx.receive()  # pyright: ignore[reportPrivateUsage]


def frame(ws: WebSocketTestSession, seconds: float = 3.0) -> dict[str, Any]:
    """The next ASGI message the server sent, within `seconds`."""
    return cast(dict[str, Any], ws.portal.call(_receive, ws, seconds))


def recv(ws: WebSocketTestSession, seconds: float = 3.0) -> dict[str, Any]:
    """The next message, checked against the schema its type has from the server."""
    sent = frame(ws, seconds)
    if sent["type"] == "websocket.close":
        raise WebSocketDisconnect(code=sent.get("code", 1000))
    assert sent["type"] == "websocket.send", sent
    return cast(dict[str, Any], json.loads(sent["text"]))


def closed(ws: WebSocketTestSession, seconds: float = 3.0) -> int:
    """The close code the server sends next (after nothing else)."""
    sent = frame(ws, seconds)
    assert sent["type"] == "websocket.close", sent
    return int(sent.get("code", 1000))


def nothing(ws: WebSocketTestSession, seconds: float = 0.3) -> None:
    """The server sends nothing on `ws` for `seconds`."""
    try:
        sent = frame(ws, seconds)
    except TimeoutError:
        return
    raise AssertionError(f"unexpected: {sent}")


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((SCHEMA / name).read_text(encoding="utf-8")))


def command_id(n: int) -> str:
    return (f"{n:04d}" + "A" * 22)[:22]


RUN = "R" * 22


def command(n: int, action: str = "pause", **extra: object) -> dict[str, object]:
    base: dict[str, object] = {"v": 1, "type": "command", "id": command_id(n), "run": RUN}
    return base | {"basis": 3, "action": action} | extra


def result(
    slot: int, n: int, outcome: str = "applied", reason: str | None = None
) -> dict[str, object]:
    return {
        "v": 1,
        "type": "command_result",
        "slot": slot,
        "id": command_id(n),
        "result": outcome,
        "reason": reason,
    }


def companion_state() -> dict[str, Any]:
    path = SCHEMA / "examples" / "companion-state" / "valid" / "following-locked.json"
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


@contextmanager
def live_app(
    monkeypatch: Any, hello_within: float = 5.0, proxies: tuple[Any, ...] = ()
) -> Generator[Live]:
    clock = Clock()
    ends: list[tuple[uuid.UUID, str]] = []

    def record_end(_pool: Pool, _hash: bytes, session_id: uuid.UUID, reason: str) -> str:
        ends.append((session_id, reason))
        return db_live.RECORDED

    events: list[tuple[str, dict[str, str]]] = []

    def record_event(
        _pool: Pool, _hash: bytes, event: str, detail: dict[str, str], _client: object = None
    ) -> str:
        events.append((event, dict(detail)))
        return db_live.RECORDED

    monkeypatch.setattr(db_live, "record_end", record_end)
    monkeypatch.setattr(db_live, "record_event", record_event)
    # No pool is used: the one database call the WebSocket can reach is faked above.
    service = LiveService(Registry(), cast(Pool, object()), clock)
    app = FastAPI()
    app.state.settings = settings = Settings(
        database_url="postgresql://unused", site_origin=SITE, trusted_proxies=proxies
    )
    # The control routes take the caller's address as the site does (site/deps.py).
    app.state.site = SiteState(settings, cast(Pool, object()), cast(Mailer, object()))
    app.state.live = service
    app.state.live_hub = hub = Hub(service, hello_within)
    app.include_router(router)
    install_error_handlers(app)
    with TestClient(app, client=("203.0.113.7", 50000)) as client:
        yield Live(client=client, hub=hub, clock=clock, ends=ends, events=events)
