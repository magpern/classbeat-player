"""The pure rule modules: tokens, the client, the request and sign-in (no database)."""

from __future__ import annotations

import hashlib
import ipaddress
from datetime import UTC, datetime, timedelta

import pytest

from player_backend.client_policy import (
    address_hash,
    audit_network,
    browser_family,
    client_address,
)
from player_backend.login_policy import (
    address_limit_key,
    normalise_email,
    retry_after,
    sign_in_mail,
)
from player_backend.request_policy import cross_site_refusal, is_recent_sign_in, response_headers
from player_backend.settings import Settings, SettingsError
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash

SITE = "https://player.test"
PROXIES = (ipaddress.ip_network("10.0.0.0/8"), ipaddress.ip_network("fd00::/8"))


def test_a_new_token_has_its_prefix_256_random_bits_and_a_sha256_hash() -> None:
    tokens = {new_token("ses") for _ in range(50)}
    assert len(tokens) == 50
    token = tokens.pop()
    assert token.startswith("cbp_ses_") and len(token) == len("cbp_ses_") + 43
    assert is_token("ses", token)
    assert token_hash(token) == hashlib.sha256(token.encode()).digest()


def test_a_token_is_accepted_for_its_own_type_only() -> None:
    session = new_token("ses")
    assert not is_token("ml", session) and not is_token("lgn", session)
    for value in (None, 7, b"x", "", session[:-1], session + "A", " " + session, session + "\n"):
        assert not is_token("ses", value)
    assert not is_token("ses", session.replace("cbp_", "cbq_"))
    assert not is_token("ses", session[:-1] + "!")


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        ("203.0.113.9", None, "203.0.113.9"),
        # An untrusted peer's header is never believed.
        ("203.0.113.9", "198.51.100.1", "203.0.113.9"),
        ("10.0.0.5", "198.51.100.1", "198.51.100.1"),
        # Read from the right: what the client wrote on the left is not believed.
        ("10.0.0.5", "192.0.2.66, 198.51.100.1", "198.51.100.1"),
        ("10.0.0.5", "198.51.100.1, 10.0.0.7", "198.51.100.1"),
        ("10.0.0.5", "garbage, 198.51.100.1", "198.51.100.1"),
        ("10.0.0.5", "198.51.100.1, garbage", "10.0.0.5"),
        ("10.0.0.5", None, "10.0.0.5"),
        ("10.0.0.5", "10.0.0.6, 10.0.0.7", "10.0.0.6"),
        ("fd00::1", "2001:db8::7", "2001:db8::7"),
        ("::ffff:10.0.0.5", "198.51.100.1", "198.51.100.1"),
        ("testclient", "198.51.100.1", None),
        (None, "198.51.100.1", None),
    ],
)
def test_the_client_address(peer: str | None, forwarded: str | None, expected: str | None) -> None:
    found = client_address(peer, forwarded, PROXIES)
    assert (None if found is None else str(found)) == expected


def test_what_is_kept_of_an_address() -> None:
    v4, v6 = ipaddress.ip_address("203.0.113.77"), ipaddress.ip_address("2001:db8:1:2:3:4:5:6")
    assert audit_network(v4) == "203.0.113.0/24"
    assert audit_network(v6) == "2001:db8:1::/48"
    assert audit_network(None) is None
    # The counter key: a hash; an IPv6 client is its /64.
    assert len(address_hash(v4)) == 32 and address_hash(v4) != address_hash(None)
    assert address_hash(v4) != address_hash(ipaddress.ip_address("203.0.113.78"))
    assert address_hash(v6) == address_hash(ipaddress.ip_address("2001:db8:1:2::9"))
    assert address_hash(v6) != address_hash(ipaddress.ip_address("2001:db8:1:3::9"))
    assert address_limit_key(address_hash(v4)) != address_hash(v4)


@pytest.mark.parametrize(
    ("agent", "family"),
    [
        ("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox"),
        ("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Chrome"),
        ("Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0", "Edge"),
        ("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", "Safari"),
        ("curl/8.5.0", "Other"),
        ("x" * 500, "Other"),
        (None, "Other"),
    ],
)
def test_the_browser_family_is_a_short_fixed_name(agent: str | None, family: str) -> None:
    assert browser_family(agent) == family


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "post", "delete"])
def test_a_state_change_needs_the_sites_origin(method: str) -> None:
    assert cross_site_refusal(method, SITE, None, SITE) is None
    assert cross_site_refusal(method, SITE, "same-origin", SITE) is None
    assert cross_site_refusal(method, None, None, SITE) == "origin"
    assert cross_site_refusal(method, None, "same-origin", SITE) == "origin"
    assert cross_site_refusal(method, "https://evil.test", None, SITE) == "origin"
    assert cross_site_refusal(method, SITE.upper(), None, SITE) == "origin"
    for other in ("cross-site", "same-site", "none", ""):
        assert cross_site_refusal(method, SITE, other, SITE) == "sec_fetch_site"


def test_a_read_is_not_a_state_change() -> None:
    for method in ("GET", "HEAD", "OPTIONS"):
        assert cross_site_refusal(method, None, "cross-site", SITE) is None


def test_a_sign_in_is_recent_for_10_minutes() -> None:
    now = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)
    assert is_recent_sign_in(now, now)
    assert is_recent_sign_in(now - timedelta(minutes=10), now)
    assert not is_recent_sign_in(now - timedelta(minutes=10, seconds=1), now)
    assert not is_recent_sign_in(now + timedelta(seconds=1), now)


def test_the_response_headers() -> None:
    page = response_headers("/healthz")
    assert page == {
        "Content-Security-Policy": (
            "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        ),
        "Referrer-Policy": "no-referrer",
    }
    assert response_headers("/api/site/sessions") == {**page, "Cache-Control": "no-store"}
    assert "Cache-Control" not in response_headers("/api/sitex")


def test_an_email_is_trimmed_and_lower_cased_or_refused() -> None:
    assert normalise_email("  Rider@Example.Test\n") == "rider@example.test"
    for bad in ("", "a", "a@", "@b", "no at sign", "a b@c.test", "a@b\x00.test", "a@" + "b" * 254):
        assert normalise_email(bad) is None
    assert normalise_email("a@" + "b" * 252) is not None


def test_retry_after_is_the_rest_of_the_fixed_window() -> None:
    assert retry_after(3600 * 5 + 1) == 3599
    assert retry_after(3600 * 5 + 3599.5) == 1
    assert retry_after(3600 * 5) == 3600
    assert retry_after(100, timedelta(minutes=15)) == 800


def test_the_sign_in_mail_has_the_token_in_the_fragment_only() -> None:
    token = new_token("ml")
    mail = sign_in_mail(SITE, "rider@example.test", token)
    assert mail.to == "rider@example.test"
    assert f"{SITE}/sign-in#{token}" in mail.body.split()
    assert mail.body.count(token) == 1 and token not in mail.subject and token not in repr(mail)


def test_the_site_origin_is_required_and_is_an_https_origin() -> None:
    base = {"PLAYER_DATABASE_URL": "postgresql://player_app:placeholder@127.0.0.1:1/none"}
    with pytest.raises(SettingsError):
        Settings.from_env(base)
    for bad in ("http://player.test", "https://player.test/", "https://player.test/x", "player"):
        with pytest.raises(SettingsError):
            Settings.from_env({**base, "PLAYER_SITE_ORIGIN": bad})
    settings = Settings.from_env({**base, "PLAYER_SITE_ORIGIN": "https://player.test:8443"})
    assert settings.site_origin == "https://player.test:8443" and settings.trusted_proxies == ()


def test_trusted_proxies_are_addresses_or_networks() -> None:
    base = {
        "PLAYER_DATABASE_URL": "postgresql://player_app:placeholder@127.0.0.1:1/none",
        "PLAYER_SITE_ORIGIN": SITE,
    }
    settings = Settings.from_env({**base, "PLAYER_TRUSTED_PROXIES": "10.0.0.1, fd00::/8"})
    assert [str(n) for n in settings.trusted_proxies] == ["10.0.0.1/32", "fd00::/8"]
    with pytest.raises(SettingsError):
        Settings.from_env({**base, "PLAYER_TRUSTED_PROXIES": "proxy.internal"})
