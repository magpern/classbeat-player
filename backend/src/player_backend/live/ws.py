"""`wss://<site>/api/live/ws`: the live WebSocket (ADR 0002, sections 8 and 10; ADR 0005,
sections 1, 3 and 6).

- The handshake is refused (before it is accepted) for an address over its connection limits.
- No token in the address and no cookie: the first message must be `hello` with the token,
  within 5 seconds, at most 1 KiB, valid by its schema. The token's prefix gives the role; a
  rider token gets none in the companion part of PL8. A controller's handshake `Origin` must be
  the site's origin, checked before its token is looked up. Any failure closes with 4401, the
  same for every cause.
- After `hello`: a message is at most 16 KiB (else 1009) and a connection sends at most 10 a
  second, the host's included (else 1008). Every message within the limits goes to the hub's
  router, which drops anything the allowlist does not route.
- Nothing about a connection is logged but fixed words; never a token or a message.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Final

from fastapi import WebSocket
from starlette.types import Message as Frame

from player_backend.client_policy import address_hash, client_address
from player_backend.live.hub import Hub
from player_backend.live.link import Link
from player_backend.live.routes import router
from player_backend.live.schemas import valid
from player_backend.live.state import live_hub
from player_backend.live_limit_policy import too_big
from player_backend.live_token_policy import hello_role, origin_allowed
from player_backend.live_wire_policy import HELLO_REFUSED, TOO_BIG, TOO_MANY, decode, size
from player_backend.settings import Settings

# How long a close the reader asked for may take to be sent, and the last-chance close.
CLOSE_WITHIN: Final = 2.0


@router.websocket("/ws")
async def live_socket(websocket: WebSocket) -> None:
    settings: Settings = websocket.app.state.settings
    await serve(live_hub(websocket), websocket, settings)


async def serve(hub: Hub, websocket: WebSocket, settings: Settings) -> None:
    hub.bind()  # before any lookup: see hub.py on the watchers
    peer = websocket.client.host if websocket.client is not None else None
    address = client_address(
        peer, websocket.headers.get("x-forwarded-for"), settings.trusted_proxies
    )
    key = address_hash(address)
    if not hub.gate.admit(key, hub.service.clock()):
        await websocket.close(TOO_MANY)  # before `accept`: the handshake is refused
        return
    try:
        await websocket.accept()
        link = await _hello(hub, websocket, websocket.headers.get("origin"), settings.site_origin)
    finally:
        hub.gate.hello_over(key)
    if link is not None:
        await _run(hub, websocket, link)


async def _refuse(websocket: WebSocket, code: int) -> None:
    with contextlib.suppress(Exception):
        await websocket.close(code)


async def _hello(hub: Hub, websocket: WebSocket, origin: str | None, site: str) -> Link | None:
    try:
        frame = await asyncio.wait_for(websocket.receive(), hub.hello_within)
    except TimeoutError:
        await _refuse(websocket, HELLO_REFUSED)
        return None
    if frame["type"] == "websocket.disconnect":
        return None
    text = frame.get("text")
    if not isinstance(text, str):
        await _refuse(websocket, HELLO_REFUSED)
        return None
    if too_big(size(text), after_hello=False):
        await _refuse(websocket, TOO_BIG)
        return None
    message = decode(text)
    if message is None or not valid("hello.schema.json", message):
        await _refuse(websocket, HELLO_REFUSED)
        return None
    token = message["token"]
    role = hello_role(token)
    if role is None or not origin_allowed(role, origin, site):
        await _refuse(websocket, HELLO_REFUSED)
        return None
    registry = hub.service.registry
    if role == "host":
        session_id = registry.host_session(token, hub.service.clock())
        if session_id is not None:
            return hub.attach_host(websocket, session_id)
    else:
        seat = registry.controller_seat(token, hub.service.clock())
        if seat is not None:
            return hub.attach_controller(websocket, seat)
    await _refuse(websocket, HELLO_REFUSED)
    return None


def _frame_size(frame: Frame) -> tuple[str | None, int]:
    text = frame.get("text")
    if isinstance(text, str):
        return text, size(text)
    data = frame.get("bytes")
    return None, len(data) if isinstance(data, bytes) else 0


async def _read(hub: Hub, websocket: WebSocket, link: Link) -> None:
    """Until the peer goes, or a limit is broken (the link is then closing)."""
    while not link.closing:
        frame = await websocket.receive()
        if frame["type"] == "websocket.disconnect":
            return
        if not link.messages.take(hub.service.clock()):
            link.close(TOO_MANY)
            return
        text, frame_size = _frame_size(frame)
        if too_big(frame_size, after_hello=True):
            link.close(TOO_BIG)
            return
        hub.handle(link, text)


def _settled(task: asyncio.Task[None]) -> None:
    """Take a finished task's outcome, so that none is reported as never retrieved."""
    if not task.cancelled():
        task.exception()


async def _run(hub: Hub, websocket: WebSocket, link: Link) -> None:
    link.writer = writer = asyncio.create_task(link.write())
    reader = asyncio.create_task(_read(hub, websocket, link))
    for task in (reader, writer):
        task.add_done_callback(_settled)
    try:
        await asyncio.wait({reader, writer}, return_when=asyncio.FIRST_COMPLETED)
        if link.closing and not writer.done():
            # A close is queued (a limit, an end, a newer connection): let it be sent.
            await asyncio.wait({writer}, timeout=CLOSE_WITHIN)
        reader.cancel()
        code = link.close_code
        if code is not None and (not writer.done() or writer.cancelled()):
            # The writer was stopped before its close went out (a peer that does not read).
            writer.cancel()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(websocket.close(code), CLOSE_WITHIN)
    finally:
        # Nothing is awaited here: a cancelled handler (the server stopping) leaves at once.
        reader.cancel()
        writer.cancel()
        hub.detach(link)
