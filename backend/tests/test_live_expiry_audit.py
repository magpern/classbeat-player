"""A live session ended on expiry is audited the same way on every path, on the test database
(live/table.py, live/service.py; ADR 0002, sections 8 and 11; ADR 0005, section 2; #220).

The sweep, a host's `hello` (`host_session`), a controller's `hello` (`controller_seat`), the
control-code exchange and a sign-in (`sign_in_controller`) each end a session past its lifetime
and write exactly one `live.session_ended`, after `auth_enter_device` with the session's stored
hash: the same credential, the same detail (its id and why it ended) and nothing else in it.
A session already ended is not ended, nor written, again by any path.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from player_backend.client_policy import ClientInfo
from player_backend.live.registry import Registry
from player_backend.live.service import LiveService
from player_backend.live_session_policy import UNCONFIRMED_LIMIT
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests import pairhelp
from tests.sitehelp import Site

EMAIL = "rider@example.test"
SITE_SESSION = b"s" * 32
ADDRESS = b"a" * 32
CLIENT = ClientInfo(network=None, family="")


@dataclass
class Held:
    """A running session of the app's own device, on a service with the test's clock."""

    service: LiveService
    device_hash: bytes
    account_id: uuid.UUID
    session_id: uuid.UUID
    join_code: str
    host_token: str
    controller_token: str
    control_code: str
    clock: list[float]


def _held(site: Site) -> Held:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    app = pairhelp.app_client(site)
    device_token = pairhelp.pair(site, browser, "Studio PC", app)
    clock = [0.0]
    registry = Registry()
    service = LiveService(registry, site.app.state.live.pool, lambda: clock[0])
    account_id, device_hash = uuid.uuid4(), token_hash(device_token)
    started = registry.start(account_id, uuid.uuid4(), device_hash, 0.0)
    assert started is not None
    registry.host_connected(started.session_id)
    controller = new_token("ctl")
    assert registry.add_controller(started.session_id, token_hash(controller), None) == 1
    made = registry.make_code(started.session_id, 0.0)
    assert made is not None
    return Held(
        service,
        device_hash,
        account_id,
        started.session_id,
        started.join_code,
        started.host_token,
        controller,
        made.code,
        clock,
    )


def _sweep(held: Held) -> object:
    held.service.sweep()
    return None


def _host_hello(held: Held) -> object:
    return held.service.registry.host_session(held.host_token, held.clock[0])


def _controller_hello(held: Held) -> object:
    return held.service.registry.controller_seat(held.controller_token, held.clock[0])


def _exchange(held: Held) -> object:
    return held.service.by_code(held.join_code, held.control_code, ADDRESS, CLIENT).granted


def _sign_in(held: Held) -> object:
    registry = held.service.registry
    return registry.sign_in_controller(
        held.session_id, held.account_id, SITE_SESSION, held.clock[0]
    )


PATHS: dict[str, Callable[[Held], object]] = {
    "sweep": _sweep,
    "host_session": _host_hello,
    "controller_seat": _controller_hello,
    "exchange": _exchange,
    "sign_in_controller": _sign_in,
}


def _ended_rows(site: Site, held: Held) -> list[tuple[object, ...]]:
    """Each `live.session_ended`: its credential kind, whether that credential is the session's
    device, and its detail."""
    return site.su.execute(
        "SELECT e.credential_kind, e.credential_id = d.id, e.detail "
        "FROM player.audit_events e, player.devices d "
        "WHERE e.event = 'live.session_ended' AND d.token_hash = %s",
        (held.device_hash,),
    ).fetchall()


@pytest.mark.parametrize("path", list(PATHS))
def test_a_session_ended_on_expiry_is_audited_once(site: Site, path: str) -> None:
    held = _held(site)
    # Just inside its lifetime the path ends nothing and writes nothing.
    held.clock[0] = UNCONFIRMED_LIMIT - 0.001
    PATHS["sweep"](held)
    assert len(held.service.registry.running()) == 1 and _ended_rows(site, held) == []
    held.clock[0] = UNCONFIRMED_LIMIT
    assert PATHS[path](held) is None
    assert held.service.registry.running() == []
    ended = {"session_id": str(held.session_id), "reason": "unconfirmed"}
    # Written as the session's device, with the session's id and why it ended, nothing else:
    # no token, code or address.
    assert _ended_rows(site, held) == [("device", True, ended)]
    assert site.events(EMAIL).count(("live.session_ended", ended)) == 1
    # Every path again, the sweep included: the session is gone, and nothing more is written.
    for again in PATHS.values():
        assert again(held) is None
    assert _ended_rows(site, held) == [("device", True, ended)]
