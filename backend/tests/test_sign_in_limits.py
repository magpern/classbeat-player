"""The rate limits of sign-in link requests (ADR 0002, section 10), through the site's API.

Per email and requesting address together (3 per 15 minutes, 10 a day) and per email from all
addresses (30 a day): the usual answer and no mail. Per address whatever the email (10 an
hour): the only 429.
"""

from __future__ import annotations

import ipaddress
import time

import pytest

from tests.sitehelp import ADDRESS, Site, running_site

EMAIL = "rider@example.test"
LINK = "/api/site/sign-in/link"


@pytest.fixture(autouse=True)
def _away_from_a_window_edge() -> None:  # pyright: ignore[reportUnusedFunction]
    """The windows are fixed, starting on the quarter hour: do not let one end mid-test."""
    left = 900 - time.time() % 900
    if left < 5:
        time.sleep(left + 0.1)


def _address(n: int) -> str:
    return f"198.51.100.{n}"


def _forget_the_short_windows(site: Site) -> None:
    """As if 15 minutes and an hour had passed: only the day counters stay."""
    site.su.execute(
        "DELETE FROM player.rate_limits WHERE expires_at - window_start < interval '1 day'"
    )


def test_three_links_per_email_and_address_in_15_minutes(site: Site) -> None:
    site.allow(EMAIL)
    site.allow("other@example.test")
    here = site.browser(_address(1))
    assert [site.ask(here, EMAIL) is not None for _ in range(4)] == [True, True, True, False]
    # The limit is of this email from this address: neither alone is held.
    assert site.ask(here, "other@example.test") is not None
    assert site.ask(site.browser(_address(2)), EMAIL) is not None


def test_a_link_over_the_limit_does_not_cancel_the_one_in_the_mail(site: Site) -> None:
    site.allow(EMAIL)
    tokens = [site.ask(site.first, EMAIL) for _ in range(4)]
    assert tokens[3] is None
    done = site.first.post("/api/site/sign-in/complete", json={"token": tokens[2]})
    assert done.status_code == 200


def test_ten_links_per_email_and_address_in_a_day(site: Site) -> None:
    site.allow(EMAIL)
    here = site.browser(_address(1))
    sent: list[bool] = []
    for _ in range(4):
        sent += [site.ask(here, EMAIL) is not None for _ in range(3)]
        _forget_the_short_windows(site)
    assert sent == [True] * 10 + [False] * 2
    assert site.ask(site.browser(_address(2)), EMAIL) is not None


def test_thirty_links_per_email_in_a_day_from_all_addresses(site: Site) -> None:
    site.allow(EMAIL)
    # One stranger at one address: 3 mails, and what is over their own limit counts for nobody.
    stranger = site.browser(_address(1))
    assert sum(site.ask(stranger, EMAIL) is not None for _ in range(10)) == 3
    for n in range(2, 11):
        browser = site.browser(_address(n))
        assert all(site.ask(browser, EMAIL) is not None for _ in range(3))
    assert len(site.mailer.sent) == 30
    # The brake on mail to one mailbox: the usual answer, no mail, from any further address.
    assert site.ask(site.browser(_address(11)), EMAIL) is None
    assert len(site.mailer.sent) == 30


def test_ten_requests_per_address_in_an_hour_then_429(site: Site) -> None:
    site.allow(EMAIL)
    here = site.browser(_address(1))
    for n in range(10):
        assert here.post(LINK, json={"email": f"user{n}@example.test"}).status_code == 200
    links = site.su.execute("SELECT count(*) FROM player.login_links").fetchone()
    # The 429 does not depend on the email: the same for an allowed one and for a bad one.
    for email in (EMAIL, "user0@example.test", "not an address"):
        limited = here.post(LINK, json={"email": email})
        assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
        assert 1 <= int(limited.headers["retry-after"]) <= 3600
        assert limited.headers.get_list("set-cookie") == []
    assert site.mailer.sent == []
    assert site.su.execute("SELECT count(*) FROM player.login_links").fetchone() == links
    # Another address is not held by it.
    assert site.ask(site.browser(_address(2)), EMAIL) is not None


def test_the_proxy_header_is_ignored_from_an_untrusted_peer(site: Site) -> None:
    here = site.browser(_address(1))
    statuses = [
        here.post(
            LINK, json={"email": "x@example.test"}, headers={"X-Forwarded-For": f"192.0.2.{n}"}
        ).status_code
        for n in range(11)
    ]
    assert statuses == [200] * 10 + [429]


def test_behind_a_trusted_proxy_the_header_gives_the_client(app_url: str, db_url: str) -> None:
    proxy = ipaddress.ip_network(ADDRESS)
    with running_site(app_url, db_url, proxies=(proxy,)) as site:
        site.allow(EMAIL)
        site.sign_in(EMAIL)
        site.su.execute("DELETE FROM player.rate_limits")
        via_proxy = site.browser()  # its peer is the proxy
        for n in range(11):
            forwarded = {"X-Forwarded-For": f"192.0.2.66, 198.51.100.{n}"}
            asked = via_proxy.post(LINK, json={"email": EMAIL}, headers=forwarded)
            assert asked.status_code == 200
        # Eleven clients, not one: no 429, a mail each, and each event has its client's network.
        assert len(site.mailer.sent) == 12
        networks = site.su.execute(
            "SELECT DISTINCT client_network::text FROM player.audit_events "
            "WHERE event = 'login.link_requested'"
        ).fetchall()
        assert networks == [("198.51.100.0/24",)]
        # One client behind the proxy is still held to its own limit.
        one = {"X-Forwarded-For": "198.51.100.200"}
        statuses = [
            via_proxy.post(LINK, json={"email": f"u{n}@example.test"}, headers=one).status_code
            for n in range(11)
        ]
        assert statuses == [200] * 10 + [429]


def test_counters_hold_hashes_only(site: Site) -> None:
    site.allow(EMAIL)
    site.ask(site.browser(_address(1)), EMAIL)
    keys = site.su.execute("SELECT key_hash FROM player.rate_limits").fetchall()
    assert len(keys) == 4  # the address, the pair twice (15 minutes, a day), the email
    for (key,) in keys:
        assert isinstance(key, bytes) and len(key) == 32
        assert b"example" not in key and b"198.51" not in key
