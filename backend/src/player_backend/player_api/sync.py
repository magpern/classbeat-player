"""Class sync for the app (ADR 0002, sections 3, 6 and 7; plan, section 5). Read only.

- `GET /api/player/changes?after=<cursor>&limit=<n>`: the account's class and removal changes
  after the cursor, in sync order, each with its number and hash and no content; the page's
  cursor, and whether more follow. A cursor above the account's own answers
  `409 resync_required` with the current cursor.
- `GET /api/player/classes/{class_id}`: one class the account holds now, with its document.
  A removal, an unknown id and another account's id are all `404 not_found`.
- `GET /api/player/cursor`: the account's current cursor.

Everything is the device token's account (deps.py); nothing is written here.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from player_backend.db import class_sync
from player_backend.http_errors import ApiError
from player_backend.player_api.deps import DeviceToken
from player_backend.sync_policy import PAGE_DEFAULT, is_page_request, needs_resync

router = APIRouter(prefix="/api/player")


def _change(change: class_sync.Change) -> dict[str, object]:
    return {
        "class_id": str(change.id),
        "source": change.source_id,
        "source_class_id": change.source_class_id,
        "publication_number": change.publication_number,
        "removed": change.removed,
        "content_hash": change.content_hash,
        "published_at": change.published_at.isoformat(),
        "position": change.position,
    }


@router.get("/changes")
def changes(context: DeviceToken, after: int = 0, limit: int = PAGE_DEFAULT) -> JSONResponse:
    if not is_page_request(after, limit):
        raise ApiError(422, "invalid_request")
    current = class_sync.cursor(context)
    if needs_resync(after, current):
        raise ApiError(409, "resync_required", extra={"cursor": current})
    page = class_sync.changes(context, after, limit)
    return JSONResponse(
        {
            "changes": [_change(change) for change in page.changes],
            "cursor": page.cursor,
            "more": page.more,
        }
    )


@router.get("/classes/{class_id}")
def held_class(class_id: UUID, context: DeviceToken) -> JSONResponse:
    found = class_sync.held_class(context, class_id)
    if found is None:
        raise ApiError(404, "not_found")
    return JSONResponse(
        {
            "class_id": str(found.id),
            "source": found.source_id,
            "source_class_id": found.source_class_id,
            "publication_number": found.publication_number,
            "content_hash": found.content_hash,
            "position": found.position,
            "document": found.document,
        }
    )


@router.get("/cursor")
def cursor(context: DeviceToken) -> JSONResponse:
    return JSONResponse({"cursor": class_sync.cursor(context)})
