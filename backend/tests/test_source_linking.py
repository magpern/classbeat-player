"""Linking a source (ADR 0002, section 7): the approval on the site, the code exchange, the
listing and revoking of links, and the limits of sections 7 and 10. Through the real routes."""

from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest

from player_backend.token_issue import new_token
from tests import sourcehelp as sh
from tests.pairhelp import settle
from tests.sitehelp import Browser, Site

EMAIL = "teacher@example.test"


@pytest.fixture
def signed_in(site: Site) -> Browser:
    site.allow(EMAIL)
    return site.sign_in(EMAIL)


def test_the_check_names_a_known_source_and_refuses_anything_else(
    site: Site, signed_in: Browser
) -> None:
    known = signed_in.post(sh.CHECK, json={"source": "classbeat", "redirect_uri": sh.REDIRECT})
    assert known.status_code == 200
    assert known.json() == {
        "source": "classbeat",
        "name": "classbeat",
        "scope": ["publish_classes", "remove_classes", "read_publication_numbers"],
    }
    for source, redirect in (
        ("other", sh.REDIRECT),
        ("classbeat", sh.REDIRECT + "/more"),
        ("classbeat", "https://evil.test/player/linked"),
        ("classbeat", sh.REDIRECT + "?x=1"),
    ):
        answer = signed_in.post(sh.CHECK, json={"source": source, "redirect_uri": redirect})
        assert answer.status_code == 400 and answer.json() == {"error": "unknown_source"}
        assert "location" not in answer.headers
        _, challenge = sh.pkce()
        body = {
            "source": source,
            "redirect_uri": redirect,
            "state": "s",
            "code_challenge": challenge,
        }
        refused = signed_in.post(sh.APPROVE, json=body)
        assert refused.status_code == 400 and "redirect" not in refused.text


def test_the_approval_needs_a_sign_in_and_the_sites_origin(site: Site, signed_in: Browser) -> None:
    _, challenge = sh.pkce()
    assert sh.approve(site.browser(), challenge).status_code == 401
    stranger = site.browser(headers={"Origin": "https://evil.test"})
    stranger.take_cookies(signed_in)
    assert sh.approve(stranger, challenge).status_code == 403
    assert site.su.execute("SELECT count(*) FROM player.source_link_codes").fetchone() == (0,)


def test_the_approval_answers_the_address_back_with_the_code_and_the_state(
    site: Site,
    signed_in: Browser,
) -> None:
    _, challenge = sh.pkce()
    answer = sh.approve(signed_in, challenge, state="abc~!*")
    assert answer.status_code == 200
    assert answer.headers["cache-control"] == "no-store"
    query = parse_qs(urlsplit(str(answer.json()["redirect"])).query)
    assert query["state"] == ["abc~!*"]
    assert query["code"][0].startswith("cbp_lc_")
    # Stored only as its hash, with its bindings, for 60 seconds.
    row = site.su.execute(
        "SELECT source_id, redirect_uri, code_challenge, "
        "expires_at - now() <= interval '60 seconds' FROM player.source_link_codes"
    ).fetchone()
    assert row == ("classbeat", sh.REDIRECT, challenge, True)
    # Section 6: the account is told, and the mail holds no code.
    (mail,) = [m for m in site.mailer.sent if m.subject == "A source was linked"]
    assert mail.to == EMAIL and query["code"][0] not in mail.body


@pytest.mark.parametrize(
    ("challenge", "method", "state"),
    [
        ("short", "S256", "s"),
        ("A" * 43, "plain", "s"),
        ("A" * 43, "S256", "has space"),
        ("A" * 43, "S256", ""),
    ],
)
def test_a_bad_challenge_or_state_is_refused(
    site: Site,
    signed_in: Browser,
    challenge: str,
    method: str,
    state: str,
) -> None:
    body = {
        "source": "classbeat",
        "redirect_uri": sh.REDIRECT,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": method,
    }
    assert signed_in.post(sh.APPROVE, json=body).status_code == 422


def test_the_exchange_gives_the_token_once(site: Site, signed_in: Browser) -> None:
    verifier, challenge = sh.pkce()
    code = sh.code_of(sh.approve(signed_in, challenge))
    app = sh.server(site)
    answer = sh.exchange(app, code, verifier)
    assert answer.status_code == 200
    assert answer.headers["cache-control"] == "no-store"
    token = answer.json()["source_token"]
    assert token.startswith("cbp_src_") and answer.json()["token_type"] == "Bearer"
    again = sh.exchange(app, code, verifier)
    assert again.status_code == 400 and again.json() == {"error": "invalid_grant"}
    # The token works, and its link is stored by its hash only.
    assert sh.publish(app, token, sh.envelope("c1", 1, sh.document())).status_code == 200
    stored = site.su.execute("SELECT token_hash, source_id FROM player.source_links").fetchall()
    assert len(stored) == 1 and stored[0][1] == "classbeat"
    digest = stored[0][0]
    assert isinstance(digest, bytes) and token.encode() not in digest
    assert [e for e, _ in site.events(EMAIL)].count("source.linked") == 1


@pytest.mark.parametrize(
    "change",
    [
        {"redirect_uri": sh.REDIRECT + "/other"},
        {"source": "other"},
        {"code_verifier": "x" * 43},
        {"code_verifier": "short"},
    ],
)
def test_a_wrong_binding_is_refused_and_uses_the_code_up(
    site: Site,
    signed_in: Browser,
    change: dict[str, str],
) -> None:
    verifier, challenge = sh.pkce()
    code = sh.code_of(sh.approve(signed_in, challenge))
    app = sh.server(site)
    wrong = sh.exchange(app, code, verifier, **change)
    assert wrong.status_code == 400 and wrong.json() == {"error": "invalid_grant"}
    # Single use: the right bindings after a wrong one get nothing.
    assert sh.exchange(app, code, verifier).status_code == 400
    assert site.su.execute("SELECT count(*) FROM player.source_links").fetchone() == (0,)
    refused = [d for e, d in site.events(EMAIL) if e == "source.link_refused"]
    assert len(refused) == 1


def test_an_expired_code_is_refused(site: Site, signed_in: Browser) -> None:
    verifier, challenge = sh.pkce()
    code = sh.code_of(sh.approve(signed_in, challenge))
    site.su.execute("UPDATE player.source_link_codes SET expires_at = now() - interval '1 second'")
    assert sh.exchange(sh.server(site), code, verifier).status_code == 400
    assert [d for e, d in site.events(EMAIL) if e == "source.link_refused"] == [
        {"source": "classbeat", "reason": "expired"}
    ]


def test_a_code_of_another_shape_is_refused_without_a_lookup(site: Site) -> None:
    app = sh.server(site)
    for code in ("", "nope", new_token("src"), new_token("dc")):
        answer = sh.exchange(app, code, "v" * 43)
        assert answer.status_code == 400
    # Not counted: nothing was looked up.
    assert site.su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)


def test_exchanges_are_limited_per_address(site: Site, signed_in: Browser) -> None:
    settle(site, 60)
    app = sh.server(site, "192.0.2.77")
    for _ in range(10):
        assert sh.exchange(app, new_token("lc"), "v" * 43).status_code == 400
    limited = sh.exchange(app, new_token("lc"), "v" * 43)
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 1
    # Another address is not held by it.
    assert sh.exchange(sh.server(site, "192.0.2.78"), new_token("lc"), "v" * 43).status_code == 400


def test_at_most_five_links_per_account(site: Site, signed_in: Browser) -> None:
    for _ in range(5):
        sh.link(site, signed_in)
    _, challenge = sh.pkce()
    assert sh.approve(signed_in, challenge).status_code == 409
    # A code approved before the fifth link was made is refused at the exchange, inside the
    # database.
    site.su.execute(
        "DELETE FROM player.source_links WHERE id IN (SELECT id FROM player.source_links LIMIT 1)"
    )
    verifier, challenge = sh.pkce()
    code = sh.code_of(sh.approve(signed_in, challenge))
    sh.link(site, signed_in)
    assert sh.exchange(sh.server(site), code, verifier).status_code == 400
    assert {"source": "classbeat", "reason": "link_limit"} in [
        d for e, d in site.events(EMAIL) if e == "source.link_refused"
    ]


def test_links_are_listed_and_revoked_on_the_site(site: Site, signed_in: Browser) -> None:
    token = sh.link(site, signed_in)
    app = sh.server(site)
    assert sh.publish(app, token, sh.envelope("c1", 1, sh.document())).status_code == 200
    (listed,) = signed_in.get(sh.LINKS).json()["source_links"]
    assert listed["source"] == "classbeat" and listed["name"] == "classbeat"
    assert listed["last_used_at"] is not None and "token" not in str(listed)
    assert signed_in.delete(f"{sh.LINKS}/{listed['id']}").status_code == 204
    assert signed_in.delete(f"{sh.LINKS}/{listed['id']}").status_code == 404
    assert signed_in.get(sh.LINKS).json()["source_links"] == []
    refused = sh.publish(app, token, sh.envelope("c1", 2, sh.document()))
    assert refused.status_code == 401 and refused.json() == {"error": "token_unknown"}
    # Revoking a link keeps the classes: they belong to the account.
    assert [row[:2] for row in sh.class_rows(site, EMAIL)] == [("c1", 1)]
    assert ("source.revoked", {"source": "classbeat", "by": "user"}) in site.events(EMAIL)


def test_the_source_ends_its_own_link(site: Site, signed_in: Browser) -> None:
    token = sh.link(site, signed_in)
    app = sh.server(site)
    assert app.delete(sh.OWN_LINK, headers=sh.bearer(token)).status_code == 204
    assert app.delete(sh.OWN_LINK, headers=sh.bearer(token)).status_code == 401
    assert signed_in.get(sh.LINKS).json()["source_links"] == []
    assert ("source.revoked", {"source": "classbeat", "by": "source"}) in site.events(EMAIL)


def test_a_token_ends_after_365_days_without_use(site: Site, signed_in: Browser) -> None:
    token = sh.link(site, signed_in)
    site.su.execute(
        "UPDATE player.source_links SET created_at = now() - interval '366 days', "
        "last_used_at = now() - interval '365 days 1 minute'"
    )
    refused = sh.publish(sh.server(site), token, sh.envelope("c1", 1, sh.document()))
    assert refused.status_code == 401
    assert signed_in.get(sh.LINKS).json()["source_links"] == []
