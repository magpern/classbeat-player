"""Pure rules that turn a credentialed request's raw text into values (ADR 0002, section 10).

A route that enters an account (a site session, a device token or a source token) takes its
path and query parameters as text and its body as bytes, and parses them with these functions
(or a module of its own, like `sync_policy.py`). A value the framework refused would be refused
inside the credential's transaction and roll back what the credential check wrote: the count
of the token's requests and "last used". Refused here, the route answers `422` itself and they
stay. A guard holds every such route to it (tests/guards/test_guard_raw_parameters.py).
"""

from __future__ import annotations

import re
from typing import Final
from uuid import UUID

from pydantic import BaseModel, ValidationError

# The source API's key of a class, as the publication schema has it: 1 to 100 characters.
SOURCE_CLASS_ID_MAX: Final = 100

_CANONICAL_UUID: Final = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def uuid_of(raw: str) -> UUID | None:
    """An id from the path: only the canonical 8-4-4-4-12 hexadecimal form."""
    if _CANONICAL_UUID.fullmatch(raw) is None:
        return None
    return UUID(raw)


def source_class_id_of(raw: str) -> str | None:
    """A source's key of a class from the path: 1 to 100 characters, and no U+0000, which
    PostgreSQL's text cannot hold (the envelope's own rule, publication_policy.py)."""
    if not 1 <= len(raw) <= SOURCE_CLASS_ID_MAX or "\x00" in raw:
        return None
    return raw


def is_json(content_type: str | None) -> bool:
    """Whether a body is sent as JSON: `application/json` or an `application/...+json` type."""
    media_type = (content_type or "").partition(";")[0].strip().lower()
    kind, _, subtype = media_type.partition("/")
    return kind == "application" and (subtype == "json" or subtype.endswith("+json"))


def json_body_of[M: BaseModel](model: type[M], content_type: str | None, raw: bytes) -> M | None:
    """The body as `model`, or None when it is not sent as JSON or is not one valid `model`."""
    if not is_json(content_type):
        return None
    try:
        return model.model_validate_json(raw)
    except ValidationError:
        return None
