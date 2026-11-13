"""The account's class library on the site (plan, section 5; ADR 0002, sections 7 and 12).

- `GET /classes?before=<cursor>&limit=<n>`: a page of the account's classes and the markers of
  those removed, the latest change first: title, length, source, number, last change and
  whether it is removed. A marker has no title and no length.
- `GET /classes/{class_id}`: one class the account holds now, with its document. A marker, an
  unknown id and another account's id are all `404 not_found`.
- `DELETE /classes/{class_id}`: the document goes at once and the marker stays, so every device
  learns of it at its next sync. `204` again for a class already removed; `404` for an id the
  account has no class with.

Everything is the session's account (deps.py). The parameters are raw text, parsed by
`library_policy.py` and `param_policy.py`, so that a malformed one is refused by the route and
the session's "last used" stays (section 10).
"""

from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from player_backend.db import library
from player_backend.http_errors import ApiError
from player_backend.library_policy import page_request
from player_backend.param_policy import uuid_of
from player_backend.site.deps import SiteSession, TheCaller

router = APIRouter()


def _entry(entry: library.LibraryEntry) -> dict[str, object]:
    return {
        "class_id": str(entry.id),
        "source": entry.source_id,
        "source_class_id": entry.source_class_id,
        "publication_number": entry.publication_number,
        "removed": entry.removed,
        "title": entry.title,
        "length_ms": entry.length_ms,
        "changed_at": entry.changed_at.isoformat(),
    }


@router.get("/classes")
def list_classes(
    context: SiteSession, before: str | None = None, limit: str | None = None
) -> JSONResponse:
    # Raw text, parsed here: a value the framework refused would roll back "last used".
    requested = page_request(before, limit)
    if requested is None:
        raise ApiError(422, "invalid_request")
    page = library.list_classes(context, requested)
    return JSONResponse(
        {
            "classes": [_entry(entry) for entry in page.entries],
            "cursor": page.cursor,
            "more": page.more,
        }
    )


@router.get("/classes/{class_id}")
def read_class(class_id: str, context: SiteSession) -> JSONResponse:
    # Raw text, parsed here, for the same reason as above.
    parsed = uuid_of(class_id)
    if parsed is None:
        raise ApiError(422, "invalid_request")
    found = library.read_class(context, parsed)
    if found is None:
        raise ApiError(404, "not_found")
    return JSONResponse(
        {
            "class_id": str(found.id),
            "source": found.source_id,
            "source_class_id": found.source_class_id,
            "publication_number": found.publication_number,
            "content_hash": found.content_hash,
            "changed_at": found.changed_at.isoformat(),
            "document": found.document,
        }
    )


@router.delete("/classes/{class_id}")
def delete_class(class_id: str, context: SiteSession, who: TheCaller) -> Response:
    # Raw text, parsed here, for the same reason as above.
    parsed = uuid_of(class_id)
    if parsed is None:
        raise ApiError(422, "invalid_request")
    if not library.delete_class(context, parsed, who.info):
        raise ApiError(404, "not_found")
    return Response(status_code=204)
