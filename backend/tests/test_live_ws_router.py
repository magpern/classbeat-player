"""The live router, on fakes (live/hub.py; ADR 0005, sections 1 and 3 to 6; ADR 0002, s. 8).

- a controller's `command` goes to the host with the slot the server gave it; a phone-sent
  `slot` fails the schema and the message is dropped;
- `ack` is sent by the server only, to the controller that sent the command, once: the host's
  `command_result` for a command that controller's connection sent, or the server's own
  `host_away` or `rate`; nothing is kept for a host that is away;
- 2 commands a second per controller; more get `rate` and never reach the host;
- `companion_state` goes from the host to the controllers only;
- `host_status` tells the controllers when the host comes and goes, and while it is away they
  get nothing else; `controller_joined` and `controller_left` tell the host of the phones;
- one connection per token: a newer one replaces the older (4409);
- every message the table does not route from its sender's role is dropped and counted;
- the host's rider messages (ADR 0007) reach no controller, and a controller's are dropped;
  the riders' side is test_live_ws_riders.py's.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import ExitStack
from typing import Any

import pytest

from player_backend.live import hub as hub_module
from player_backend.live.schemas import routes
from player_backend.live_route_policy import acted_on
from tests.livehelp import SCHEMA as LIVE_SCHEMA
from tests.livehelp import (
    closed,
    command,
    command_id,
    companion_state,
    live_app,
    nothing,
    recv,
    result,
)


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def test_the_handlers_are_keyed_by_the_routed_types_exactly(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    on = live.hub._on  # pyright: ignore[reportPrivateUsage]
    assert set(on) == set(acted_on(routes()))
    for kind, handler in on.items():
        assert handler.__name__ == "_on_" + kind
    # A routed type with no handler, or a handler for a type the table does not route: no hub.
    for changed in (acted_on(routes()) + ("rider_reading",), acted_on(routes())[1:]):

        def table(_routes: object, kinds: tuple[str, ...] = changed) -> tuple[str, ...]:
            return kinds

        monkeypatch.setattr(hub_module, "acted_on", table)
        with pytest.raises(RuntimeError):
            hub_module.Hub(live.hub.service)


def _all_in(live: Any, stack: ExitStack, signed_in: bool = False) -> tuple[Any, Any, Any]:
    """A session with its host and two phones connected; the joins are read."""
    started = live.session()
    tokens = live.controller(started), live.controller(started, signed_in)
    host = stack.enter_context(live.joined(started.host_token, None))
    phones: list[Any] = []
    for slot, token in enumerate(tokens, start=1):
        phones.append(stack.enter_context(live.joined(token)))
        assert recv(host)["type"] == "controller_joined" and slot
    return host, phones[0], phones[1]


@pytest.mark.parametrize("slot", [1, 2])
def test_a_command_reaches_the_host_with_the_servers_slot(live: Any, slot: int) -> None:
    with ExitStack() as stack:
        host, *phones = _all_in(live, stack)
        sent = command(1, "nudge", deltaMs=5000)
        phones[slot - 1].send_json(sent)
        assert recv(host) == {**sent, "slot": slot}


def test_a_phone_sent_slot_fails_the_schema_and_is_dropped(live: Any) -> None:
    with ExitStack() as stack:
        host, phone, _ = _all_in(live, stack)
        phone.send_json(command(1) | {"slot": 2})
        phone.send_json(command(2))  # the probe: the next thing the host gets
        assert recv(host)["id"] == command_id(2)
        assert live.hub.dropped["invalid"] == 1


def test_ack_goes_only_to_the_controller_that_sent_the_command(live: Any) -> None:
    with ExitStack() as stack:
        host, one, two = _all_in(live, stack)
        one.send_json(command(1))
        assert recv(host)["slot"] == 1
        host.send_json(result(2, 1))  # the right id, the other slot: reaches no one
        host.send_json(result(1, 1, "refused", "stale"))
        assert recv(one) == {
            "v": 1,
            "type": "ack",
            "id": command_id(1),
            "result": "refused",
            "reason": "stale",
        }
        host.send_json(result(1, 1))  # a second answer to the same command
        host.send_json(result(1, 9))  # an id never forwarded
        nothing(one)
        nothing(two)
        assert live.hub.dropped["unmatched_result"] == 3


def test_the_host_cannot_send_host_away_or_rate_or_an_ack(live: Any) -> None:
    with ExitStack() as stack:
        host, one, _ = _all_in(live, stack)
        one.send_json(command(1))
        recv(host)
        host.send_json(result(1, 1, "refused", "host_away"))
        host.send_json(result(1, 1, "refused", "rate"))
        host.send_json({"v": 1, "type": "ack", "id": command_id(1), "result": "applied"})
        nothing(one)
        assert live.hub.dropped["invalid"] == 2
        assert live.hub.dropped["not_from_role"] == 1


def test_with_the_host_away_a_command_is_answered_host_away_and_kept_nowhere(live: Any) -> None:
    started = live.session()
    token = live.controller(started)
    with live.joined(token) as phone:
        phone.send_json(command(1))
        assert recv(phone) == {
            "v": 1,
            "type": "ack",
            "id": command_id(1),
            "result": "refused",
            "reason": "host_away",
        }
        with live.joined(started.host_token, None) as host:
            assert recv(host) == {"v": 1, "type": "controller_joined", "slot": 1, "via": "code"}
            assert recv(phone) == {"v": 1, "type": "host_status", "connected": True}
            nothing(host)  # the earlier command was not kept for it


def test_two_commands_a_second_per_controller_and_rate_beyond(live: Any) -> None:
    with ExitStack() as stack:
        host, one, two = _all_in(live, stack)
        for n in (1, 2, 3):
            one.send_json(command(n))
        assert [recv(host)["id"] for _ in range(2)] == [command_id(1), command_id(2)]
        assert recv(one) == {
            "v": 1,
            "type": "ack",
            "id": command_id(3),
            "result": "refused",
            "reason": "rate",
        }
        two.send_json(command(4))  # the other phone has its own two
        assert recv(host) == {**command(4), "slot": 2}
        live.clock.now += 1.0
        one.send_json(command(5))
        assert recv(host)["id"] == command_id(5)
        nothing(host)


def test_companion_state_goes_to_the_controllers_only(live: Any) -> None:
    with ExitStack() as stack:
        host, one, two = _all_in(live, stack)
        state = companion_state()
        host.send_json(state)
        assert recv(one) == state
        assert recv(two) == state
        nothing(host)


def test_a_companion_state_with_a_rider_field_is_dropped(live: Any) -> None:
    with ExitStack() as stack:
        host, one, _ = _all_in(live, stack)
        host.send_json(companion_state() | {"riders": 12})
        nothing(one)
        assert live.hub.dropped["invalid"] == 1


def test_a_controller_cannot_publish_state_or_act_as_the_host(live: Any) -> None:
    with ExitStack() as stack:
        host, one, two = _all_in(live, stack)
        for message in (
            companion_state(),
            result(1, 1),
            {"v": 1, "type": "end"},
            {"v": 1, "type": "make_code"},
            {"v": 1, "type": "drop", "slot": 2},
            {"v": 1, "type": "host_status", "connected": False},
        ):
            one.send_json(message)
        one.send_json(command(1))  # the probe
        assert recv(host)["id"] == command_id(1)
        nothing(two)
        assert live.hub.dropped["not_from_role"] == 6
        assert live.hub.connected(live.registry.running()[0].session_id) == (True, (1, 2))


def test_unknown_types_and_non_messages_are_dropped_and_counted(live: Any) -> None:
    with ExitStack() as stack:
        host, one, _ = _all_in(live, stack)
        for text in ("nope", "[]", '{"v":1}', '{"v":1,"type":"rider_hello"}', '{"v":1.0}'):
            one.send_text(text)
            host.send_text(text)
        one.send_bytes(b'{"v":1,"type":"end"}')
        nothing(host)
        nothing(one)
        assert live.hub.dropped["not_a_message"] == 7
        assert live.hub.dropped["unknown_type"] == 4


# The host's messages about riders, one valid example of each (schema/live/v1/examples).
RIDER_EXAMPLES = (
    "rider-state/valid/running-three-coming.json",
    "drop-rider/valid/one-rider.json",
    "lock/valid/lock.json",
    "new-join-code/valid/new-join-code.json",
)


def _example(name: str) -> dict[str, Any]:
    return json.loads((LIVE_SCHEMA / "examples" / name).read_text(encoding="utf-8"))


def test_the_hosts_rider_messages_reach_no_controller(live: Any) -> None:
    examples = [_example(name) for name in RIDER_EXAMPLES]
    assert [m["type"] for m in examples] == ["rider_state", "drop_rider", "lock", "new_join_code"]
    with ExitStack() as stack:
        host, one, two = _all_in(live, stack)
        for message in examples:
            host.send_json(message)
            one.send_json(message)  # from a controller: no route from its role
        host.send_json(companion_state())  # the probe: the next thing the phones get
        assert recv(one)["type"] == "companion_state"
        assert recv(two)["type"] == "companion_state"
        one.send_json(command(1))  # the probe for the host: its answers came first
        assert [recv(host)["type"] for _ in range(2)] == ["lock_state", "join_code"]
        assert recv(host)["id"] == command_id(1)
        assert live.hub.dropped["unknown_rider"] == 1  # the example's rider is no rider here
        assert live.hub.dropped["not_from_role"] == 4
        assert live.hub.dropped["invalid"] == 0
        assert sum(live.hub.refused.values()) == 0
        assert live.hub.connected(live.registry.running()[0].session_id) == (True, (1, 2))


def test_host_status_follows_the_host_and_nothing_else_comes_while_it_is_away(live: Any) -> None:
    started = live.session()
    with live.joined(live.controller(started)) as phone:
        with live.joined(started.host_token, None) as host:
            assert recv(phone) == {"v": 1, "type": "host_status", "connected": True}
            host.send_json(companion_state())
            assert recv(phone)["type"] == "companion_state"
        assert recv(phone) == {"v": 1, "type": "host_status", "connected": False}
        nothing(phone)
        assert live.hub.connected(started.session_id) == (False, (1,))


def test_the_host_hears_of_phones_coming_and_going_with_how_they_got_in(live: Any) -> None:
    started = live.session()
    by_code, by_sign_in = live.controller(started), live.controller(started, signed_in=True)
    with live.joined(started.host_token, None) as host:
        with live.joined(by_code):
            assert recv(host) == {"v": 1, "type": "controller_joined", "slot": 1, "via": "code"}
            with live.joined(by_sign_in):
                assert recv(host) == {
                    "v": 1,
                    "type": "controller_joined",
                    "slot": 2,
                    "via": "sign_in",
                }
            assert recv(host) == {"v": 1, "type": "controller_left", "slot": 2, "via": "sign_in"}
        assert recv(host) == {"v": 1, "type": "controller_left", "slot": 1, "via": "code"}


def test_a_returning_host_is_told_of_the_phones_already_in(live: Any) -> None:
    started = live.session()
    tokens = live.controller(started), live.controller(started, signed_in=True)
    with live.joined(tokens[0]), live.joined(tokens[1]):
        with live.joined(started.host_token, None) as host:
            assert [recv(host) for _ in range(2)] == [
                {"v": 1, "type": "controller_joined", "slot": 1, "via": "code"},
                {"v": 1, "type": "controller_joined", "slot": 2, "via": "sign_in"},
            ]


def test_a_newer_host_connection_replaces_the_older(live: Any) -> None:
    started = live.session()
    with live.joined(live.controller(started)) as phone:
        with live.joined(started.host_token, None) as old:
            assert recv(old)["type"] == "controller_joined"
            assert recv(phone)["connected"] is True
            with live.joined(started.host_token, None) as new:
                assert recv(new)["type"] == "controller_joined"
                assert recv(new) == {"v": 1, "type": "lock_state", "locked": False}  # a return
                assert closed(old) == 4409
                nothing(phone)  # the host never left
                phone.send_json(command(1))
                assert recv(new)["id"] == command_id(1)


def test_a_newer_controller_connection_replaces_the_older(live: Any) -> None:
    started = live.session()
    token = live.controller(started)
    with live.joined(started.host_token, None) as host:
        with live.joined(token) as old:
            recv(host)
            with live.joined(token) as new:
                assert closed(old) == 4409
                assert recv(host) == {
                    "v": 1,
                    "type": "controller_joined",
                    "slot": 1,
                    "via": "code",
                }
                new.send_json(command(1))
                assert recv(host)["slot"] == 1
                nothing(host)  # the older one's close tells the host nothing


def test_a_result_for_a_command_sent_before_the_phone_reconnected_reaches_no_one(
    live: Any,
) -> None:
    started = live.session()
    token = live.controller(started)
    with live.joined(started.host_token, None) as host:
        with live.joined(token) as phone:
            recv(host)
            phone.send_json(command(1))
            recv(host)
        recv(host)  # controller_left
        with live.joined(token) as again:
            recv(host)
            host.send_json(result(1, 1))
            nothing(again)
    assert live.hub.dropped["unmatched_result"] == 1


def test_make_code_and_drop_from_the_host_are_taken(live: Any) -> None:
    # What they do is tests/test_live_control_codes.py's; here: routed, not dropped.
    with ExitStack() as stack:
        host, one, _ = _all_in(live, stack)
        host.send_json({"v": 1, "type": "make_code"})
        assert recv(host)["type"] == "control_code"
        host.send_json({"v": 1, "type": "drop", "slot": 1})
        assert recv(one) == {"v": 1, "type": "ended", "reason": "dropped"}
        assert closed(one) == 4403
        assert recv(host)["type"] == "controller_left"
        assert sum(live.hub.dropped.values()) == 0


def test_nothing_the_hub_sends_skips_the_allowlist(live: Any) -> None:
    with ExitStack() as stack:
        host, one, _ = _all_in(live, stack)
        one.send_json(command(1))
        recv(host)
        host.send_json(result(1, 1))
        recv(one)
        host.send_json(companion_state())
        recv(one)
    assert sum(live.hub.refused.values()) == 0
