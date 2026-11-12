"""The account's devices on the site (ADR 0002, section 6): list them, revoke one.

Revoking sets `revoked_at`, so the device's token is refused with the next request.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from player_backend.db import devices
from player_backend.http_errors import ApiError
from player_backend.site.deps import SiteSession, TheCaller

router = APIRouter()


@router.get("/devices")
def list_devices(context: SiteSession) -> JSONResponse:
    return JSONResponse(
        {
            "devices": [
                {
                    "id": str(device.id),
                    "name": device.name,
                    "platform": device.platform,
                    "version": device.version,
                    "paired_at": device.paired_at.isoformat(),
                    # None: never used. The token may have been lost on its way to the app.
                    "last_used_at": (
                        None if device.last_used_at is None else device.last_used_at.isoformat()
                    ),
                }
                for device in devices.list_devices(context)
            ]
        }
    )


@router.delete("/devices/{device_id}")
def revoke_device(device_id: UUID, context: SiteSession, who: TheCaller) -> Response:
    if not devices.revoke(context, device_id, who.info):
        raise ApiError(404, "not_found")
    return Response(status_code=204)
