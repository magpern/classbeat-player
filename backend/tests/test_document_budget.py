"""The device token's two budgets (ADR 0002, section 10; migration 0009): reads of one class's
document, 600 a minute, and everything else, 60 a minute, both counted inside
`auth_enter_device` with the numbers as its own constants (principle 7)."""

from __future__ import annotations

import uuid

from player_backend.bearer_policy import (
    DOCUMENT_READ_MAX,
    DOCUMENT_READS,
    REQUEST_MAX,
    budget_of,
    documents_key,
    requests_key,
)
from player_backend.token_policy import token_hash
from tests import pairhelp
from tests import sourcehelp as sh
from tests.pairhelp import bearer
from tests.sitehelp import Browser, Site
from tests.test_player_sync import CHANGES, CLASSES, CURSOR

EMAIL = "rider@example.test"
DEVICE = "/api/player/device"


def _paired(site: Site) -> tuple[Browser, str, str]:
    """The app, its device token, and the id of one class the account holds."""
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL, site.browser("198.51.100.1"))
    app = pairhelp.app_client(site, "198.51.100.1")
    token = pairhelp.pair(site, browser, "Studio PC", app)
    source_token = sh.link(site, browser)
    published = sh.publish(
        sh.server(site, "192.0.2.30"), source_token, sh.envelope("c1", 1, sh.document())
    )
    assert published.status_code == 200
    page = app.get(CHANGES, headers=bearer(token)).json()
    return app, token, str(page["changes"][0]["class_id"])


def _hits(site: Site, key: bytes) -> int:
    """The hits of the window that is running now."""
    row = site.su.execute(
        "SELECT coalesce(sum(hits), 0)::int FROM player.rate_limits "
        "WHERE key_hash = %s AND expires_at > now()",
        (key,),
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def test_the_budgets_match_the_issue() -> None:
    assert (REQUEST_MAX, DOCUMENT_READ_MAX) == (60, 600)
    assert DOCUMENT_READS == {("GET", "/api/player/classes/{class_id}")}
    assert budget_of("GET", "/api/player/classes/{class_id}") == "documents"
    assert budget_of("get", "/api/player/classes/{class_id}") == "documents"
    for method, route in (
        ("GET", "/api/player/changes"),
        ("GET", "/api/player/cursor"),
        ("GET", "/api/player/device"),
        ("DELETE", "/api/player/device"),
        ("DELETE", "/api/player/classes/{class_id}"),
        ("GET", "/api/player/classes/c1"),
        ("GET", None),
    ):
        assert budget_of(method, route) == "requests", (method, route)
    digest = b"t" * 32
    assert documents_key(digest) != requests_key(digest) and len(documents_key(digest)) == 32


def test_six_hundred_document_reads_a_minute_and_sync_pages_still_sixty(site: Site) -> None:
    app, token, class_id = _paired(site)
    digest = token_hash(token)
    # 600 requests take some seconds: stay in one window of the counters.
    pairhelp.settle(site, 60, margin=30.0)
    before = _hits(site, requests_key(digest))
    unknown = str(uuid.uuid4())
    paths = (f"{CLASSES}/{class_id}", f"{CLASSES}/{unknown}", f"{CLASSES}/not-an-id")
    statuses = [
        app.get(paths[n % 3], headers=bearer(token)).status_code for n in range(DOCUMENT_READ_MAX)
    ]
    assert statuses.count(200) == 200 and set(statuses) == {200, 404, 422}
    over = app.get(f"{CLASSES}/{class_id}", headers=bearer(token))
    assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}
    assert 1 <= int(over.headers["retry-after"]) <= 60
    # The refused read is counted too; none of them touched the other budget.
    assert _hits(site, documents_key(digest)) == DOCUMENT_READ_MAX + 1
    assert _hits(site, requests_key(digest)) == before
    # Pages, the cursor and the device's own route still have their 60, and only 60.
    others = (CHANGES, CURSOR, DEVICE)
    for n in range(REQUEST_MAX - before):
        assert app.get(others[n % 3], headers=bearer(token)).status_code == 200
    limited = app.get(CHANGES, headers=bearer(token))
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}


def test_sixty_pages_leave_the_document_reads_untouched(site: Site) -> None:
    app, token, class_id = _paired(site)
    digest = token_hash(token)
    pairhelp.settle(site, 60, margin=10.0)
    for _ in range(REQUEST_MAX - _hits(site, requests_key(digest))):
        assert app.get(CURSOR, headers=bearer(token)).status_code == 200
    assert app.get(CHANGES, headers=bearer(token)).status_code == 429
    assert app.get(f"{CLASSES}/{class_id}", headers=bearer(token)).status_code == 200
    assert _hits(site, documents_key(digest)) == 1


def test_a_refused_document_read_keeps_last_used(site: Site) -> None:
    app, token, _ = _paired(site)
    site.su.execute("UPDATE player.devices SET last_used_at = now() - interval '1 hour'")
    answer = app.get(f"{CLASSES}/{uuid.uuid4()}", headers=bearer(token))
    assert answer.status_code == 404
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", True, False)]
