"""A malformed request to a route that takes a credential is refused by the route, and what the
credential check wrote stays (ADR 0002, section 10): the session's "last used", the count of a
source token's requests. The player API's own cases are in test_player_sync.py.

The guard that holds every such route to raw parameters is tests/guards/
test_guard_raw_parameters.py; these show the answer and what is kept, route by route.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from tests import sourcehelp as sh
from tests.pairhelp import DECIDE, DEVICES, FIND, settle
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"
SESSIONS = "/api/site/sessions"
FRESH = "SELECT last_used_at > now() - interval '1 minute' FROM player.sessions"
JSON = {"Content-Type": "application/json"}
TEXT = {"Content-Type": "text/plain"}


@dataclass(frozen=True)
class Malformed:
    method: str
    path: str
    content: bytes | None = None
    headers: dict[str, str] | None = None


SESSION_CASES = [
    Malformed("DELETE", f"{SESSIONS}/not-an-id"),
    Malformed("DELETE", f"{SESSIONS}/11111111111141118111111111111111"),
    Malformed("DELETE", f"{DEVICES}/not-an-id"),
    Malformed("DELETE", f"{sh.LINKS}/not-an-id"),
    Malformed("POST", FIND, b"not json", JSON),
    Malformed("POST", FIND, b'{"code": 5}', JSON),
    Malformed("POST", FIND, b"{}", JSON),
    Malformed("POST", FIND, b'{"code": "ABCD-EFGH"}', TEXT),
    Malformed("POST", FIND, b'{"code": "ABCD-EFGH"}'),
    Malformed("POST", DECIDE, b'{"code": "ABCD-EFGH", "approve": "maybe"}', JSON),
    Malformed("POST", DECIDE, b'{"code": "ABCD-EFGH"}', JSON),
    Malformed("POST", sh.CHECK, b'{"source": 1, "redirect_uri": "x"}', JSON),
    Malformed("POST", sh.APPROVE, b'{"source": "classbeat"}', JSON),
    Malformed("POST", sh.APPROVE, b"[" * 10000, JSON),
]


def _signed_in_a_while_ago(site: Site) -> Browser:
    """Last seen 6 minutes ago: "last used" is due for a write with the next request."""
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '6 minutes'")
    return browser


@pytest.mark.parametrize("case", SESSION_CASES, ids=lambda c: f"{c.method} {c.path}")
def test_a_malformed_signed_in_request_keeps_last_used(site: Site, case: Malformed) -> None:
    browser = _signed_in_a_while_ago(site)
    answer = browser.request(case.method, case.path, content=case.content, headers=case.headers)
    assert answer.status_code == 422 and answer.json() == {"error": "invalid_request"}
    assert site.su.execute(FRESH).fetchone() == (True,)
    # Refused, so nothing else is written: the session is not ended, nothing is revoked.
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


@pytest.mark.parametrize("case", SESSION_CASES, ids=lambda c: f"{c.method} {c.path}")
def test_a_malformed_request_without_a_session_is_not_signed_in(
    site: Site, case: Malformed
) -> None:
    # The credential is checked first: a stranger learns nothing of what the route would parse.
    answer = site.first.request(case.method, case.path, content=case.content, headers=case.headers)
    assert answer.status_code == 401 and answer.json() == {"error": "not_signed_in"}


SOURCE_CASES = [
    Malformed("GET", f"{sh.CLASSES}/{'x' * 101}"),
    Malformed("GET", f"{sh.CLASSES}/c%00"),
    Malformed("POST", sh.PUBLICATIONS, b"not json", JSON),
]


def test_malformed_requests_count_towards_the_source_tokens_limit(site: Site) -> None:
    site.allow(EMAIL)
    token = sh.link(site, site.sign_in(EMAIL))
    server = sh.server(site)
    settle(site, 60)
    statuses: list[int] = []
    for n in range(60):
        case = SOURCE_CASES[n % len(SOURCE_CASES)]
        headers = {**sh.bearer(token), **(case.headers or {})}
        statuses.append(
            server.request(case.method, case.path, content=case.content, headers=headers).status_code
        )
    assert set(statuses) == {422}
    used = site.su.execute("SELECT last_used_at IS NOT NULL FROM player.source_links")
    assert used.fetchone() == (True,)
    for case in SOURCE_CASES[:2]:
        over = server.get(case.path, headers=sh.bearer(token))
        assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}
