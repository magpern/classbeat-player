"""The device's own row, for the app (ADR 0002, sections 3 and 6).

A device token reads its own name and may revoke itself. It reads nothing else of the account
here: not the account, not its other devices, not its sources.
"""

from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from player_backend.db import devices
from player_backend.http_errors import ApiError
from player_backend.player_api.deps import DeviceToken
from player_backend.site.deps import TheCaller

router = APIRouter(prefix="/api/player")


@router.get("/device")
def own_device(context: DeviceToken) -> JSONResponse:
    device = devices.own_device(context)
    if device is None:
        raise ApiError(404, "not_found")
    return JSONResponse(
        {
            "device": {
                "name": device.name,
                "platform": device.platform,
                "version": device.version,
                "paired_at": device.paired_at.isoformat(),
            }
        }
    )


@router.delete("/device")
def revoke_own_device(context: DeviceToken, who: TheCaller) -> Response:
    """The app revokes its own token: it stops working with the next request."""
    devices.revoke(context, context.credential_id, who.info)
    return Response(status_code=204)
