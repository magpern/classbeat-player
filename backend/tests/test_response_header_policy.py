"""The headers chosen for a path under a prefix (response_header_policy.py, #284, #290):
by the routed path, and `no-store` when the full path or the routed path is never stored."""

from __future__ import annotations

import pytest

from player_backend import response_header_policy
from player_backend.control_page_policy import control_headers
from player_backend.request_policy import NEVER_STORED, response_headers
from player_backend.response_header_policy import headers_for
from player_backend.rider_page_policy import rider_headers
from player_backend.route_path_policy import routed_path

ORIGIN = "https://player.test"
PAGE = response_headers("/healthz")


@pytest.mark.parametrize("prefix", NEVER_STORED)
@pytest.mark.parametrize("root_path", ["", "/", "/player", "/api", "/api/"])
def test_an_api_path_is_never_stored_whatever_the_prefix(prefix: str, root_path: str) -> None:
    path = prefix + "nothing"
    assert headers_for(path, root_path, ORIGIN) == {**PAGE, "Cache-Control": "no-store"}


@pytest.mark.parametrize("prefix", NEVER_STORED)
def test_an_api_path_under_a_page_prefix_is_never_stored(prefix: str) -> None:
    path = "/player" + prefix + "nothing"
    assert headers_for(path, "/player", ORIGIN) == {**PAGE, "Cache-Control": "no-store"}


@pytest.mark.parametrize(
    ("path", "root_path"),
    [
        ("/api/live/ws", "/api"),
        ("/api/live/ws", "/api/live"),
        ("/api/site/me", "/api"),
        ("/api/site/me", "/api/site"),
        ("/api/pairing/start", "/api"),
        ("/api/player/classes", "/api/player"),
        ("/api/source/x", "/api"),
    ],
)
def test_a_prefix_that_starts_an_api_path_keeps_no_store(path: str, root_path: str) -> None:
    """#285 N2: the router sees `/live/ws`, which is no never-stored path; the full path is."""
    assert not routed_path(path, root_path).startswith(NEVER_STORED)
    assert headers_for(path, root_path, ORIGIN)["Cache-Control"] == "no-store"


def test_the_routed_path_alone_still_decides_no_store(monkeypatch: pytest.MonkeyPatch) -> None:
    """No-store on the routed path is the policy's own check, not only the page headers'."""

    def page_only(_path: str) -> dict[str, str]:
        return dict(PAGE)

    monkeypatch.setattr(response_header_policy, "response_headers", page_only)
    assert headers_for("/player/api/live/ws", "/player", ORIGIN)["Cache-Control"] == "no-store"
    assert headers_for("/player/healthz", "/player", ORIGIN) == PAGE


@pytest.mark.parametrize(
    ("path", "root_path"),
    [
        ("/healthz", ""),
        ("/player/healthz", "/player"),
        ("/playerx/api/live/ws", "/player"),
        ("/api/livex", "/api"),
        ("/apix/live/ws", "/api"),
    ],
)
def test_a_page_path_keeps_the_page_headers(path: str, root_path: str) -> None:
    assert headers_for(path, root_path, ORIGIN) == PAGE


def test_the_companion_page_keeps_its_own_headers() -> None:
    page = headers_for("/player/control", "/player", ORIGIN)
    assert page == control_headers("/control", ORIGIN)
    asset = headers_for("/player/control/companion.js", "/player", ORIGIN)
    assert asset == control_headers("/control/companion.js", ORIGIN)
    assert asset["Cache-Control"] == "no-cache"


def test_the_rider_page_keeps_its_own_headers() -> None:
    page = headers_for("/player/j", "/player", ORIGIN)
    assert page == rider_headers("/j", ORIGIN)
    asset = headers_for("/player/j/rider.js", "/player", ORIGIN)
    assert asset == rider_headers("/j/rider.js", ORIGIN)
    assert asset["Cache-Control"] == "no-cache"
    # `/join` and `/jx` are not the page: the site's headers.
    assert headers_for("/join", "", ORIGIN) == PAGE
    assert headers_for("/player/jx", "/player", ORIGIN) == PAGE


def test_a_companion_asset_under_an_api_prefix_is_never_stored() -> None:
    """`root_path="/api/live"` routes `/api/live/control/x.js` as the companion's script; the
    full path is the live API's, so the weaker `no-cache` gives way to `no-store`."""
    headers = headers_for("/api/live/control/companion.js", "/api/live", ORIGIN)
    assert headers == {
        **control_headers("/control/companion.js", ORIGIN),
        "Cache-Control": "no-store",
    }
