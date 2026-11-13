"""The cap on request bodies (ADR 0002, section 10; body_policy.py, body_cap.py): 16 KiB for
every body the site and the app send, refused with 413 before the body is read in full and
before any credential is looked at or any transaction opened. A publication keeps its own
limit and is refused inside the source token's transaction, so it counts as the token's use."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Iterator
from contextlib import AbstractContextManager

import httpx
import pytest

from player_backend.body_policy import BODY_MAX, body_cap, declared_over
from player_backend.db.executor import Handle, Pool
from player_backend.publication_policy import BODY_MAX as PUBLICATION_MAX
from player_backend.source_policy import REQUEST_MAX
from tests import pairhelp
from tests import sourcehelp as sh
from tests.routehelp import routes_of
from tests.sitehelp import ORIGIN, SAME_ORIGIN, Browser, Site

EMAIL = "rider@example.test"
TOO_LARGE = {"error": "body_too_large"}
CHUNK = 4096
# Routes whose body FastAPI reads as a model; they take no credential.
MODEL_BODIES = frozenset(
    {
        "/api/site/sign-in/link",
        "/api/site/sign-in/complete",
        "/api/pairing/start",
        "/api/pairing/token",
        "/api/source/token",
    }
)
# Routes that read their body through `RawBody`, before their session.
RAW_BODIES = frozenset(
    {
        "/api/site/pairing/find",
        "/api/site/pairing/decide",
        "/api/site/source-links/check",
        "/api/site/source-links/approve",
    }
)


def _filled(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "11111111-1111-4111-8111-111111111111", path)


def _every_route(site: Site) -> list[tuple[str, str]]:
    return [(route.method, _filled(route.path)) for route in routes_of(site.app)]


@pytest.fixture
def handles(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[str]]:
    """Every handle the app asks the pool for while a test runs."""
    taken: list[str] = []
    real = Pool.handle

    def counted(self: Pool) -> AbstractContextManager[Handle]:
        taken.append("handle")
        return real(self)

    monkeypatch.setattr(Pool, "handle", counted)
    yield taken


class Upload:
    """A body sent in chunks with no `Content-Length`, which counts what was taken of it."""

    def __init__(self, size: int) -> None:
        self.size = size
        self.taken = 0

    async def chunks(self) -> AsyncIterator[bytes]:
        while self.taken < self.size:
            part = b" " * min(CHUNK, self.size - self.taken)
            self.taken += len(part)
            yield part


def _streamed(
    site: Site, path: str, upload: Upload, headers: dict[str, str], root_path: str = ""
) -> httpx.Response:
    transport = httpx.ASGITransport(
        app=site.app, client=("198.51.100.9", 40000), root_path=root_path
    )

    async def send() -> httpx.Response:
        async with httpx.AsyncClient(transport=transport, base_url=ORIGIN) as client:
            return await client.post(path, content=upload.chunks(), headers=headers)

    return site.loop.run_until_complete(send())


def test_the_cap_and_the_route_that_sets_its_own() -> None:
    assert BODY_MAX == 16 * 1024
    assert body_cap("/api/site/pairing/find") == BODY_MAX
    assert body_cap("/api/pairing/start") == BODY_MAX
    assert body_cap("/api/source/token") == BODY_MAX
    assert body_cap("/api/source/publications/") == BODY_MAX
    assert body_cap("/no/such/route") == BODY_MAX
    assert body_cap(None) == BODY_MAX
    assert body_cap("/api/source/publications") is None


@pytest.mark.parametrize(
    ("declared", "over"),
    [
        (None, False),
        ("", False),
        ("0", False),
        (str(BODY_MAX), False),
        ("0" * 40 + str(BODY_MAX), False),
        (str(BODY_MAX + 1), True),
        ("9" * 5000, True),
        ("-1", False),
        ("+99999", False),
        (" 99999", False),
        ("1e9", False),
        ("٩" * 9, False),  # Arabic-Indic digits are not a length
    ],
)
def test_a_declared_length(declared: str | None, over: bool) -> None:
    assert declared_over(declared, BODY_MAX) is over


def test_a_declared_oversized_body_is_refused_on_every_route(
    site: Site, handles: list[str]
) -> None:
    browser = site.browser()
    body = b"{" + b" " * BODY_MAX + b"}"
    seen = 0
    for method, path in _every_route(site):
        if path == sh.PUBLICATIONS:
            continue
        headers = {**SAME_ORIGIN, "Content-Type": "application/json"}
        answer = browser.request(method, path, content=body, headers=headers)
        assert (answer.status_code, answer.json()) == (413, TOO_LARGE), (method, path)
        assert answer.headers["content-security-policy"]
        seen += 1
    assert seen >= 20
    # Answered before any credential, counter or transaction.
    assert handles == []


@pytest.mark.parametrize("path", sorted(MODEL_BODIES | RAW_BODIES))
def test_a_streamed_oversized_body_is_refused_before_it_is_read_in_full(
    site: Site, handles: list[str], path: str
) -> None:
    headers = {"Content-Type": "application/json"}
    if path.startswith("/api/site/"):
        headers = {**SAME_ORIGIN, **headers}
    upload = Upload(10 * BODY_MAX)
    answer = _streamed(site, path, upload, headers)
    assert (answer.status_code, answer.json()) == (413, TOO_LARGE)
    assert BODY_MAX < upload.taken <= BODY_MAX + 2 * CHUNK
    # A route with a session refuses the body before it looks for one: no 401, no handle.
    assert handles == []


def test_a_body_up_to_the_cap_is_read(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    padded = b'{"email": "' + EMAIL.encode() + b'"' + b" " * BODY_MAX
    body = padded[: BODY_MAX - 1] + b"}"
    assert len(body) == BODY_MAX
    headers = {**SAME_ORIGIN, "Content-Type": "application/json"}
    answer = browser.post("/api/site/sign-in/link", content=body, headers=headers)
    assert answer.status_code == 200 and answer.json() == {"status": "accepted"}


def test_a_signed_in_route_reads_up_to_the_cap(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    body = (b'{"code": "BCDF-GHJK"' + b" " * BODY_MAX)[: BODY_MAX - 1] + b"}"
    headers = {"Content-Type": "application/json"}
    answer = browser.post("/api/site/pairing/find", content=body, headers=headers)
    assert answer.status_code == 404 and answer.json() == {"error": "pairing_not_found"}
    over = browser.post("/api/site/pairing/find", content=body + b" ", headers=headers)
    assert (over.status_code, over.json()) == (413, TOO_LARGE)


@pytest.fixture
def linked(site: Site) -> tuple[Browser, str]:
    site.allow(EMAIL)
    return sh.server(site), sh.link(site, site.sign_in(EMAIL))


def _last_used(site: Site) -> object:
    row = site.su.execute("SELECT last_used_at FROM player.source_links").fetchone()
    assert row is not None
    return row[0]


def test_an_oversized_publication_counts_towards_the_tokens_limit(
    site: Site, linked: tuple[Browser, str]
) -> None:
    server, token = linked
    pairhelp.settle(site, 60, margin=10.0)
    huge = b" " * (PUBLICATION_MAX + 1)
    site.su.execute("UPDATE player.source_links SET last_used_at = NULL")
    for _ in range(REQUEST_MAX):
        answer = server.post(sh.PUBLICATIONS, content=huge, headers=sh.bearer(token))
        assert answer.status_code == 413 and answer.json() == {"error": "document_too_large"}
    # The token was used: "last used" is written.
    assert _last_used(site) is not None
    over = server.post(sh.PUBLICATIONS, content=huge, headers=sh.bearer(token))
    assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}


def test_a_streamed_oversized_publication_is_read_no_further_than_its_limit(
    site: Site, linked: tuple[Browser, str]
) -> None:
    _, token = linked
    site.su.execute("UPDATE player.source_links SET last_used_at = NULL")
    upload = Upload(2 * PUBLICATION_MAX)
    answer = _streamed(site, sh.PUBLICATIONS, upload, sh.bearer(token))
    assert answer.status_code == 413 and answer.json() == {"error": "document_too_large"}
    assert PUBLICATION_MAX < upload.taken <= PUBLICATION_MAX + CHUNK
    # Refused inside the token's transaction: it counts as the token's use.
    assert _last_used(site) is not None


def test_an_oversized_publication_without_a_token_is_refused_as_unsigned(
    site: Site, handles: list[str]
) -> None:
    server = sh.server(site)
    answer = server.post(sh.PUBLICATIONS, content=b" " * (PUBLICATION_MAX + 1))
    assert answer.status_code == 401 and answer.json() == {"error": "invalid_token"}
    assert handles == []


PREFIX = "/player"


def test_under_a_path_prefix_each_route_keeps_its_cap(
    site: Site, linked: tuple[Browser, str], handles: list[str]
) -> None:
    """Served under a `root_path`, a publication keeps its own limit of 2 MiB (#115), and
    every other route its 16 KiB: the cap is keyed on the route that matched."""
    _, token = linked
    upload = Upload(2 * PUBLICATION_MAX)
    path = PREFIX + sh.PUBLICATIONS
    answer = _streamed(site, path, upload, sh.bearer(token), root_path=PREFIX)
    assert answer.status_code == 413 and answer.json() == {"error": "document_too_large"}
    assert PUBLICATION_MAX < upload.taken <= PUBLICATION_MAX + CHUNK
    handles.clear()
    small = Upload(10 * BODY_MAX)
    headers = {**SAME_ORIGIN, "Content-Type": "application/json"}
    other = _streamed(site, PREFIX + "/api/site/pairing/find", small, headers, PREFIX)
    assert (other.status_code, other.json()) == (413, TOO_LARGE)
    assert BODY_MAX < small.taken <= BODY_MAX + 2 * CHUNK and handles == []


def test_only_the_publication_route_with_its_method_sets_its_own_limit(site: Site) -> None:
    """The same path with another method is no match of the route: it gets the cap."""
    answer = sh.server(site).request("PUT", sh.PUBLICATIONS, content=b" " * (BODY_MAX + 1))
    assert (answer.status_code, answer.json()) == (413, TOO_LARGE)
