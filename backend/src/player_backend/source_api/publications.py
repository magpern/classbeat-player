"""What a source does with its token (ADR 0002, section 7): publish, read its own numbers, and
end its own link.

- `POST /api/source/publications`: the envelope of ADR 0003, section 6. Applied, a repeat, or
  refused as stale or as a conflict; every outcome but a repeat is an audit event.
- `GET /api/source/classes/{source_class_id}`: the highest number seen and whether it was a
  removal. Numbers only: no content.
- `DELETE /api/source/link`: the source ends its own link. The classes stay.

The source id is always the token's, never the request's. The body is read as bytes and the
class key as text, both checked here, so a malformed request is refused by the route and still
counts as the token's use (section 10; param_policy.py).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from player_backend import publication_policy
from player_backend.class_schemas import schemas
from player_backend.db import classes, sources
from player_backend.http_errors import ApiError
from player_backend.param_policy import source_class_id_of
from player_backend.publication_policy import BODY_MAX, Publication
from player_backend.site.deps import TheCaller
from player_backend.source_api.deps import AuditedRefusal, SourceToken

router = APIRouter()

# Section 11: "publication applied, refused as stale or as a conflict".
APPLIED = "publication.applied"
REFUSED_EVENTS = {
    "stale": ("publication.stale", "stale_publication"),
    "conflict": ("publication.conflict", "publication_conflict"),
    "class_limit": ("publication.refused", "too_many_classes"),
}


async def publication_body(request: Request) -> bytes:
    """The request's body, read no further than the largest a publication may be."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > BODY_MAX:
        raise ApiError(413, "document_too_large")
    read = bytearray()
    async for chunk in request.stream():
        read.extend(chunk)
        if len(read) > BODY_MAX:
            raise ApiError(413, "document_too_large")
    return bytes(read)


PublicationBody = Annotated[bytes, Depends(publication_body)]


def _detail(pub: Publication, highest: int) -> dict[str, object]:
    # No title, no content and no hash (section 11): the class's key and its numbers.
    return {
        "source_class_id": pub.source_class_id,
        "publication_number": pub.number,
        "highest_publication_number": highest,
        "removed": pub.removed,
    }


@router.post("/publications")
def publish(raw: PublicationBody, entry: SourceToken, who: TheCaller) -> JSONResponse:
    class_schema, publication_schema = schemas()
    checked = publication_policy.check(raw, class_schema, publication_schema)
    if isinstance(checked, publication_policy.Refusal):
        raise ApiError(checked.status, checked.code)
    decision = classes.publish(entry.context, entry.source_id, checked)
    if decision.outcome in classes.REFUSED:
        event, code = REFUSED_EVENTS[decision.outcome]
        extra = {"highest_publication_number": decision.highest}
        # Raised: the placeholder and anything else written for it are rolled back, and the
        # event is written in a second transaction (source_api/deps.py).
        raise AuditedRefusal(409, code, event, _detail(checked, decision.highest), extra)
    if decision.outcome == "applied":
        sources.add_event(entry.context, APPLIED, who.info, _detail(checked, decision.highest))
    return JSONResponse(
        {"status": decision.outcome, "highest_publication_number": decision.highest}
    )


@router.get("/classes/{source_class_id}")
def highest(source_class_id: str, entry: SourceToken) -> JSONResponse:
    # Raw text, checked here: a value the framework refused would roll back the token's count.
    class_id = source_class_id_of(source_class_id)
    if class_id is None:
        raise ApiError(422, "invalid_request")
    found = classes.highest(entry.context, entry.source_id, class_id)
    if found is None:
        raise ApiError(404, "not_found")
    return JSONResponse(
        {
            "source_class_id": class_id,
            "highest_publication_number": found.number,
            "removed": found.removed,
        }
    )


@router.delete("/link")
def end_own_link(entry: SourceToken, who: TheCaller) -> Response:
    """The source ends its own link: its token stops working with the next request."""
    sources.revoke(entry.context, entry.context.credential_id, who.info)
    return Response(status_code=204)
