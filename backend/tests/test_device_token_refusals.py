"""A player route that refuses a request with a working device token (ADR 0002, sections 9, 10).

The same shape as a signed-in request (`site_session`): when the route raises an `ApiError`,
what the route wrote is rolled back, and what the token's use wrote before it is kept (the count
of its 60 requests a minute, the device's "last used"). Any other error rolls back everything.

No player route refuses yet, so the routes here are the tests' own, added to the app under test
with the real dependency.
"""

from __future__ import annotations

from fastapi import Response

from player_backend.db import devices
from player_backend.http_errors import ApiError
from player_backend.player_api.deps import DeviceToken
from player_backend.site.deps import TheCaller
from tests import pairhelp
from tests.pairhelp import DEVICE, bearer
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"
REFUSING = "/api/player/test-only/refusing"
BROKEN = "/api/player/test-only/broken"


def _refusing(context: DeviceToken, who: TheCaller) -> Response:
    """Writes (revokes its own device, with the event), then refuses the request."""
    assert devices.revoke(context, context.credential_id, who.info)
    raise ApiError(404, "not_found")


def _broken(context: DeviceToken, who: TheCaller) -> Response:
    """Writes, then fails with something that is not a refusal."""
    assert devices.revoke(context, context.credential_id, who.info)
    raise RuntimeError("broken")


def _paired(site: Site) -> tuple[Browser, str]:
    """The app, and the token of a device that has never been used."""
    site.allow(EMAIL)
    token = pairhelp.pair(site, site.sign_in(EMAIL))
    site.app.add_api_route(REFUSING, _refusing, methods=["POST"])
    site.app.add_api_route(BROKEN, _broken, methods=["POST"])
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", False, False)]
    return pairhelp.app_client(site, raise_errors=False), token


def _revocations(site: Site) -> int:
    return [event for event, _ in site.events(EMAIL)].count("device.revoked")


def test_a_refusing_route_keeps_last_used_and_undoes_its_own_writes(site: Site) -> None:
    app, token = _paired(site)
    refused = app.post(REFUSING, headers=bearer(token))
    assert refused.status_code == 404 and refused.json() == {"error": "not_found"}
    assert refused.headers["cache-control"] == "no-store"
    # "Last used" is kept: the token was used. The route's revocation and its event are not.
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", True, False)]
    assert _revocations(site) == 0
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200


def test_refused_requests_count_towards_the_sixty_a_minute(site: Site) -> None:
    app, token = _paired(site)
    pairhelp.settle(site, 60)
    for _ in range(60):
        assert app.post(REFUSING, headers=bearer(token)).status_code == 404
    for path in (REFUSING, DEVICE):
        limited = app.request("POST" if path == REFUSING else "GET", path, headers=bearer(token))
        assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
        assert 1 <= int(limited.headers["retry-after"]) <= 60
    hits = site.su.execute("SELECT hits FROM player.rate_limits WHERE hits >= 60").fetchall()
    assert hits == [(62,)]
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", True, False)]
    assert _revocations(site) == 0


def test_any_other_error_rolls_back_everything(site: Site) -> None:
    app, token = _paired(site)
    failed = app.post(BROKEN, headers=bearer(token))
    assert failed.status_code == 500 and failed.json() == {"error": "internal_error"}
    # Nothing of the request stays: not the route's write, not "last used", not the count.
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", False, False)]
    assert _revocations(site) == 0
    counted = site.su.execute(
        "SELECT count(*) FROM player.rate_limits WHERE expires_at - window_start = '1 minute'"
    ).fetchone()
    assert counted == (0,)
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
