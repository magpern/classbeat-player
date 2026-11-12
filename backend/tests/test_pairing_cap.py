"""The cap of 10 active devices at the decision, through the API (ADR 0002, sections 6 and 11).

Whatever fills the cap (devices, or pairings that are approved and whose token is not collected
yet), an approval above it is answered `409 too_many_devices`, leaves the pairing pending and
writes the account's `pairing.refused` event. It is not a wrong code. A wrong code at the cap is
still `404`, and counted.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from tests import pairhelp
from tests.pairhelp import DECIDE, FIND
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"
WRONG = "BCDF-GHJK"
REFUSED = ("pairing.refused", {"reason": "device_limit"})


def _signed_in(site: Site, email: str = EMAIL) -> Browser:
    site.allow(email)
    return site.sign_in(email)


def _devices(site: Site, browser: Browser, numbers: range) -> None:
    for number in numbers:
        site.su.execute("DELETE FROM player.rate_limits")
        pairhelp.pair(site, browser, f"Device {number}")


def _uncollected_approvals(site: Site, browser: Browser, numbers: range) -> None:
    for number in numbers:
        site.su.execute("DELETE FROM player.rate_limits")
        pairing = pairhelp.start(site)
        assert pairhelp.approve(browser, pairing, f"Device {number}").status_code == 200


def _fill_with_devices(site: Site, browser: Browser) -> None:
    _devices(site, browser, range(10))


def _fill_with_uncollected_approvals(site: Site, browser: Browser) -> None:
    _uncollected_approvals(site, browser, range(10))
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)


def _fill_with_both(site: Site, browser: Browser) -> None:
    _devices(site, browser, range(4))
    _uncollected_approvals(site, browser, range(4, 10))


def _waiting(site: Site) -> list[tuple[object, ...]]:
    return site.su.execute(
        "SELECT state, device_name FROM player.pairings WHERE state = 'pending'"
    ).fetchall()


@pytest.mark.parametrize(
    "fill", [_fill_with_devices, _fill_with_uncollected_approvals, _fill_with_both]
)
def test_an_approval_above_the_cap_is_told_apart_and_written_as_an_event(
    site: Site, fill: Callable[[Site, Browser], None]
) -> None:
    browser = _signed_in(site)
    fill(site, browser)
    site.su.execute("DELETE FROM player.rate_limits")
    pairhelp.settle(site, 900)
    pairing = pairhelp.start(site)
    assert REFUSED not in site.events(EMAIL)
    for count in (1, 2):
        refused = pairhelp.approve(browser, pairing, "Eleventh")
        assert refused.status_code == 409 and refused.json() == {"error": "too_many_devices"}
        assert refused.headers["cache-control"] == "no-store"
        # Written by the function and kept: the answer is returned, not raised.
        assert site.events(EMAIL).count(REFUSED) == count
    assert _waiting(site) == [("pending", None)]
    # Not wrong codes: after four wrong ones more the form is still open.
    for _ in range(4):
        assert browser.post(FIND, json={"code": WRONG}).status_code == 404
    assert browser.post(FIND, json={"code": pairing.user_code}).status_code == 200
    # A denial is still possible at the cap.
    denied = pairhelp.deny(browser, pairing)
    assert denied.status_code == 200 and denied.json() == {"status": "denied"}


def test_a_wrong_code_at_the_cap_is_not_found_and_counted(site: Site) -> None:
    browser = _signed_in(site)
    _fill_with_devices(site, browser)
    site.su.execute("DELETE FROM player.rate_limits")
    pairhelp.settle(site, 900)
    pairing = pairhelp.start(site)
    events = site.events(EMAIL)
    for _ in range(5):
        wrong = browser.post(DECIDE, json={"code": WRONG, "approve": True, "name": "Eleventh"})
        assert wrong.status_code == 404 and wrong.json() == {"error": "pairing_not_found"}
    # No event for a code that names no pending pairing. Five of them closed the form, so the
    # right code is now answered like a wrong one, not with the cap.
    assert site.events(EMAIL) == events
    closed = pairhelp.approve(browser, pairing, "Eleventh")
    assert closed.status_code == 404 and closed.json() == {"error": "pairing_not_found"}
    assert site.events(EMAIL) == events


def test_the_cap_is_per_account(site: Site) -> None:
    browser = _signed_in(site)
    _fill_with_uncollected_approvals(site, browser)
    other = _signed_in(site, "other@example.test")
    site.su.execute("DELETE FROM player.rate_limits")
    pairing = pairhelp.start(site)
    assert pairhelp.approve(browser, pairing, "Eleventh").status_code == 409
    assert pairhelp.approve(other, pairing, "First").status_code == 200
