"""The pure rules of a live session's life and of the live tokens (live_session_policy.py,
live_token_policy.py): ADR 0002, section 8; ADR 0005, sections 2 and 6."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import get_args

import pytest

from player_backend import live_session_policy as p
from player_backend.live_token_policy import hello_role, origin_allowed
from player_backend.token_issue import new_token
from player_backend.token_policy import token_string

ENDED_SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "live" / "v1" / "ended.schema.json"
ACCOUNT, OTHER = uuid.uuid4(), uuid.uuid4()
DEVICE, DEVICE_2, DEVICE_3, DEVICE_4 = (uuid.uuid4() for _ in range(4))


def _held(device: uuid.UUID, account: uuid.UUID = ACCOUNT) -> p.Held:
    return p.Held(uuid.uuid4(), account, device)


def test_the_numbers_are_the_adrs() -> None:
    assert p.SESSIONS_PER_ACCOUNT == 3
    assert p.HOST_AWAY_LIMIT == 15 * 60
    assert p.LIFETIME_LIMIT == 12 * 60 * 60
    assert p.RECHECK_EVERY == 30
    assert p.UNCONFIRMED_LIMIT == 90


def test_a_start_ends_the_devices_earlier_session_and_nothing_else() -> None:
    mine, other_device, other_account = _held(DEVICE), _held(DEVICE_2), _held(DEVICE, OTHER)
    plan = p.plan_start([mine, other_device, other_account], ACCOUNT, DEVICE)
    assert plan == p.StartPlan(replaced=(mine.session_id,), full=False)


def test_three_sessions_on_other_devices_refuse_a_fourth_and_end_nothing() -> None:
    running = [_held(DEVICE_2), _held(DEVICE_3), _held(DEVICE_4)]
    assert p.plan_start(running, ACCOUNT, DEVICE) == p.StartPlan(replaced=(), full=True)
    # Two elsewhere and this device's own: the start replaces it and is not full.
    mine = _held(DEVICE)
    plan = p.plan_start([*running[:2], mine], ACCOUNT, DEVICE)
    assert plan == p.StartPlan(replaced=(mine.session_id,), full=False)


def test_another_accounts_sessions_never_count() -> None:
    running = [_held(uuid.uuid4(), OTHER) for _ in range(5)]
    assert p.plan_start(running, ACCOUNT, DEVICE) == p.StartPlan(replaced=(), full=False)


@pytest.mark.parametrize(
    ("clocks", "now", "reason"),
    [
        (p.Clocks(0.0, None, 0.0), 89.9, None),
        (p.Clocks(0.0, 0.0, 0.0), 15 * 60 - 0.1, "unconfirmed"),
        (p.Clocks(0.0, 0.0, 850.0), 15 * 60 - 0.1, None),
        (p.Clocks(0.0, 0.0, 850.0), 15 * 60, "host_away"),
        (p.Clocks(0.0, 100.0, 1000.0), 15 * 60 + 99.9, None),
        (p.Clocks(0.0, None, 43_190.0), 12 * 3600 - 0.1, None),
        (p.Clocks(0.0, None, 43_190.0), 12 * 3600, "lifetime"),
        (p.Clocks(0.0, 43_000.0, 43_190.0), 12 * 3600, "lifetime"),
        (p.Clocks(0.0, None, 10.0), 100.0, "unconfirmed"),
        (p.Clocks(0.0, None, 10.1), 100.0, None),
    ],
)
def test_the_lifetimes(clocks: p.Clocks, now: float, reason: str | None) -> None:
    assert p.expiry(clocks, now) == reason


def test_every_end_reason_is_told_with_a_reason_of_the_contract() -> None:
    schema = json.loads(ENDED_SCHEMA.read_text(encoding="utf-8"))
    wire = set(schema["properties"]["reason"]["enum"])
    assert set(get_args(p.WireReason.__value__)) == wire
    told = {reason: p.wire_reason(reason) for reason in get_args(p.EndReason.__value__)}
    assert told == {
        "host_ended": "host_ended",
        "replaced": "host_ended",
        "host_away": "expired",
        "lifetime": "expired",
        "revoked": "revoked",
        "unconfirmed": "expired",
    }


def test_only_a_revoked_devices_end_is_not_audited() -> None:
    for reason in get_args(p.EndReason.__value__):
        assert p.audited(reason) is (reason != "revoked")


def test_the_listener_is_opened_again_after_1_2_4_8_then_15_seconds() -> None:
    assert [p.listen_retry_after(n) for n in range(1, 8)] == [1, 2, 4, 8, 15, 15, 15]


def test_a_notice_names_an_account_or_nothing() -> None:
    assert p.notice_account(str(ACCOUNT)) == ACCOUNT
    for payload in ("", "x", "1; DROP", str(ACCOUNT) + "x"):
        assert p.notice_account(payload) is None


def test_hello_gives_the_host_and_the_controller_a_role_and_a_rider_none() -> None:
    assert hello_role(new_token("hst")) == "host"
    assert hello_role(new_token("ctl")) == "controller"
    # ADR 0005, section 2: no rider route in the companion part of PL8.
    assert hello_role(new_token("rdr")) is None
    for kind in ("dev", "ses", "src", "lgn", "ml", "dc", "lc"):
        assert hello_role(new_token(kind)) is None  # pyright: ignore[reportArgumentType]
    for value in (None, 1, "", token_string("hst", "short"), new_token("hst") + "x"):
        assert hello_role(value) is None


def test_only_a_controller_needs_the_sites_origin() -> None:
    site = "https://player.example.test"
    assert origin_allowed("controller", site, site)
    for other in (
        None,
        "",
        "null",
        "https://evil.example",
        site + "/",
        "http://player.example.test",
    ):
        assert not origin_allowed("controller", other, site)
    # The host is the app: its handshake's Origin is not checked.
    for any_origin in (None, "", "https://evil.example", site):
        assert origin_allowed("host", any_origin, site)
