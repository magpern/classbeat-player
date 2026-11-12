"""Pure rules of a publication as it arrives (ADR 0002, section 7; ADR 0003, sections 4 and 6).

The body is the envelope: `source_class_id`, `publication_number`, `removed`, `content_hash`,
`document`. It is checked against the contract lane's schemas and validator (readers' mode: any
minor of a major the backend knows). The server computes the content hash itself and refuses a
mismatch. The document is stored in its RFC 8785 form, the form its hash is taken over.
Which publication wins (applied, repeat, stale, conflict) is `classformat.decide`, applied
under the class row's lock by the data access.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Final, Literal

import rfc8785

# The contract lane's package ships no type stubs; its sources are read for types.
from classformat import (  # pyright: ignore[reportMissingTypeStubs]
    Incoming,
    Stored,
    check_publication,
    content_hash,
    decide,
)

# Section 7: a document is at most 1 MiB, measured in the form it is stored and hashed in. A
# request body may be larger (white space), up to twice that.
DOCUMENT_MAX: Final = 1024 * 1024
BODY_MAX: Final = 2 * DOCUMENT_MAX
# Section 7: `publication_number` is an integer from 1 to 2^63 - 1.
NUMBER_MAX: Final = 2**63 - 1
ENVELOPE: Final = frozenset(
    {"source_class_id", "publication_number", "removed", "content_hash", "document"}
)


@dataclass(frozen=True)
class Publication:
    source_class_id: str
    number: int
    removed: bool
    # Both None for a removal.
    content_hash: str | None
    document: str | None  # RFC 8785 JSON text


@dataclass(frozen=True)
class Refusal:
    status: int
    code: str


INVALID: Final = Refusal(422, "invalid_publication")


type Outcome = Literal["accepted", "repeat", "stale", "conflict"]


def outcome(highest: int, removal: bool, stored_hash: str | None, pub: Publication) -> Outcome:
    """What the backend does with `pub` against the class row's highest number (0: none yet).

    Higher: applied. Equal, same kind and hash: a repeat. Equal otherwise: a conflict. Lower:
    stale. A row with number 0 is the placeholder of a first publication.
    """
    stored = None if highest == 0 else Stored(highest, removal, stored_hash)
    found = decide(stored, Incoming(pub.number, pub.removed, pub.content_hash))
    assert found in ("accepted", "repeat", "stale", "conflict")
    return found


class _Rejected(ValueError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    # A key given twice would make the document's meaning depend on the parser.
    found: dict[str, Any] = {}
    for key, value in pairs:
        if key in found:
            raise _Rejected
        found[key] = value
    return found


def _no_constant(_: str) -> Any:
    # NaN and Infinity are not JSON.
    raise _Rejected


def _parse(raw: bytes) -> Any:
    try:
        return json.loads(raw, object_pairs_hook=_no_duplicates, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return None


def _number(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 1 <= value <= NUMBER_MAX else None


def check(
    raw: bytes, class_schema: dict[str, Any], publication_schema: dict[str, Any]
) -> Publication | Refusal:
    """The publication in `raw`, or why it is refused."""
    if len(raw) > BODY_MAX:
        return Refusal(413, "document_too_large")
    pub = _parse(raw)
    if not isinstance(pub, dict):
        return INVALID
    body: dict[str, Any] = pub  # pyright: ignore[reportUnknownVariableType]
    if not set(body) <= ENVELOPE:
        # The envelope has no version: a field it does not have is refused, never ignored.
        return INVALID
    canonical: str | None = None
    if "document" in body:
        try:
            encoded = rfc8785.dumps(body["document"])
        except Exception:  # noqa: BLE001 - any value the canonical form cannot hold
            return INVALID
        if len(encoded) > DOCUMENT_MAX:
            return Refusal(413, "document_too_large")
        canonical = encoded.decode("utf-8")
    found = check_publication(class_schema, publication_schema, body, mode="reader")
    if found:
        kinds = {kind for kind, _ in found}
        if "hash_mismatch" in kinds:
            return Refusal(422, "content_hash_mismatch")
        if "unsupported_major" in kinds:
            return Refusal(422, "unsupported_format_version")
        return INVALID
    number = _number(body.get("publication_number"))
    class_id = body.get("source_class_id")
    if number is None or not isinstance(class_id, str):
        return INVALID
    if body.get("removed") is True:
        return Publication(class_id, number, True, None, None)
    if canonical is None:
        return INVALID
    computed = content_hash(body["document"])
    if computed != body.get("content_hash"):
        return Refusal(422, "content_hash_mismatch")
    return Publication(class_id, number, False, computed, canonical)
