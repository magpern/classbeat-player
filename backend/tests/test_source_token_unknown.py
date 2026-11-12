"""Made-up source tokens from one address (ADR 0002, section 10): the address is counted first,
so an address over its limit writes no per-token counter, and a valid token still works."""

from __future__ import annotations

from player_backend.token_issue import new_token
from tests import sourcehelp as sh
from tests.pairhelp import settle
from tests.sitehelp import Site

EMAIL = "teacher@example.test"
COUNT = "SELECT count(*)::int, sum(hits)::int FROM player.rate_limits"


def _unknown(site: Site, address: str = "192.0.2.10") -> int:
    answer = sh.publish(sh.server(site, address), new_token("src"), sh.envelope("c1", 1, None))
    return answer.status_code


def test_many_unknown_source_tokens_from_one_address_grow_no_table(site: Site) -> None:
    site.allow(EMAIL)
    token = sh.link(site, site.sign_in(EMAIL))
    app = sh.server(site)
    settle(site, 300, margin=8.0)
    site.su.execute("DELETE FROM player.rate_limits")
    for _ in range(200):
        assert _unknown(site) == 401
    limited = sh.publish(app, new_token("src"), sh.envelope("c1", 1, None))
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    rows = site.su.execute(COUNT).fetchone()
    assert rows is not None and isinstance(rows[1], int)
    for _ in range(4):
        assert _unknown(site) == 429
    # 205 made-up tokens: one row for the address and one for each of the first 200.
    after = site.su.execute(COUNT).fetchone()
    assert after == (rows[0], rows[1] + 4)
    assert isinstance(rows[0], int) and rows[0] <= 201
    # A valid token from the same address keeps working, and another address is not held back.
    assert sh.publish(app, token, sh.envelope("c1", 1, sh.document())).status_code == 200
    assert _unknown(site, "198.51.100.9") == 401
