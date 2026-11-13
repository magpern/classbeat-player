"""The headers chosen for a path under a prefix (response_header_policy.py, #284, #290):
by the routed path, and `no-store` when the full path or the routed path is never stored."""

from __future__ import annotations

import pytest

from player_backend.control_page_policy import control_headers
from player_backend.request_policy import NEVER_STORED, response_headers
from player_backend.response_header_policy import headers_for

ORIGIN = "https://player.test"
PAGE = response_headers("/healthz")


@pytest.mark.parametrize("prefix", NEVER_STORED)
@pytest.mark.parametrize("root_path", ["", "/", "/player", "/api", "/api/"])
def test_an_api_path_is_never_stored_whatever_the_prefix(prefix: str, root_path: str) -> None:
    path = prefix + "nothing"
    assert headers_for(path, root_path, ORIGIN) == {**PAGE, "Cache-Control": "no-store"}
    assert headers_for("/player" + path, "/player", ORIGIN)["Cache-Control"] == "no-store"


def test_the_routed_path_alone_still_decides_no_store() -> None:
    assert headers_for("/player/api/live/ws", "/player", ORIGIN)["Cache-Control"] == "no-store"


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


def test_a_companion_asset_under_an_api_prefix_is_never_stored() -> None:
    """`root_path="/api/live"` routes `/api/live/control/x.js` as the companion's script; the
    full path is the live API's, so the weaker `no-cache` gives way to `no-store`."""
    headers = headers_for("/api/live/control/companion.js", "/api/live", ORIGIN)
    assert headers == {
        **control_headers("/control/companion.js", ORIGIN),
        "Cache-Control": "no-store",
    }
