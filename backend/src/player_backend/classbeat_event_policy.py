"""Pure rules for the events classbeat sends (ADR 0010, section 8). No I/O.

classbeat's server posts one OpenID Connect back-channel logout token to
`POST /api/classbeat/events`, as `application/x-www-form-urlencoded`. The route takes no
credential: a request with `Sec-Fetch-Site` (which every browser sends) is refused. The token is
an ES256 JWT typed `logout+jwt`, checked as an ID token is (section 3: algorithm, key, `iss`,
`aud`, `exp`, `iat`), and then here: no `nonce`, a `jti`, a `sub`, and an `events` object whose
members are exactly the back-channel logout event and one of the two classbeat events, each with
the value `{}`. Every number and name is a constant, changed only in a security-critical pull
request. A refusal is a fixed word, never a value of the token.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Final, Literal
from urllib.parse import parse_qsl

from player_backend.classbeat_policy import (
    SUBJECT_MAX,
    Json,
    audience_refusal,
    issued_refusal,
)

LOGOUT_TYPE: Final = "logout+jwt"
BACKCHANNEL_LOGOUT: Final = "http://schemas.openid.net/event/backchannel-logout"
# Pinned with classbeat (its ADR 0034).
ACCOUNT_DELETED: Final = "urn:classbeat:player:account-deleted"
SESSIONS_REVOKED: Final = "urn:classbeat:player:sessions-revoked"
FORM_TYPE: Final = "application/x-www-form-urlencoded"
FORM_FIELD: Final = "logout_token"
JTI_MAX: Final = 255
# A `jti` is single use for longer than classbeat retries (7 days).
JTI_KEPT: Final = timedelta(days=8)
# Section 9, the limits: events per address.
LIMIT_WINDOW: Final = timedelta(minutes=1)
LIMIT_MAX: Final = 600

type EventKind = Literal["account_deleted", "sessions_revoked"]

_KINDS: Final[Mapping[str, EventKind]] = {
    ACCOUNT_DELETED: "account_deleted",
    SESSIONS_REVOKED: "sessions_revoked",
}


@dataclass(frozen=True)
class Event:
    """What a checked event token says. `jti` and `subject` are never logged."""

    issuer: str
    subject: str
    jti: str
    kind: EventKind


def from_browser(sec_fetch_site: str | None) -> bool:
    """A request with `Sec-Fetch-Site`, of any value, comes from a browser and is refused."""
    return sec_fetch_site is not None


def is_form(content_type: str | None) -> bool:
    media_type = (content_type or "").partition(";")[0].strip().lower()
    return media_type == FORM_TYPE


def logout_token_of(raw: bytes) -> str | None:
    """The one `logout_token` of a form body that holds it and nothing else, or None."""
    try:
        text = raw.decode("ascii")
        fields = parse_qsl(text, keep_blank_values=True, strict_parsing=True, max_num_fields=2)
    except ValueError:
        return None
    if len(fields) != 1 or fields[0][0] != FORM_FIELD or not fields[0][1]:
        return None
    return fields[0][1]


def limit_key(address_hash: bytes) -> bytes:
    """The counter of one address's events: a hash, never the address."""
    return hashlib.sha256(b"classbeat.events:" + address_hash).digest()


def jti_hash(jti: str) -> bytes:
    """What `classbeat_event_ids` keeps of a `jti`: its SHA-256."""
    return hashlib.sha256(jti.encode("utf-8")).digest()


def _is_empty_object(value: object) -> bool:
    return isinstance(value, dict) and not value


def _kind_of(events: object) -> EventKind | None:
    """The classbeat event of an `events` claim that holds exactly the back-channel logout
    event and one of the two, each `{}`; None for anything else."""
    if not isinstance(events, dict):
        return None
    members: dict[object, object] = dict(events)  # pyright: ignore[reportUnknownArgumentType]
    if len(members) != 2 or not _is_empty_object(members.pop(BACKCHANNEL_LOGOUT, None)):
        return None
    ((name, value),) = members.items()
    if not isinstance(name, str) or name not in _KINDS or not _is_empty_object(value):
        return None
    return _KINDS[name]


def _text(value: object, longest: int) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= longest


def event_refusal(claims: Json, *, issuer: str, client_id: str, now: int) -> str | None:
    """`iss` exact, `aud` and `azp` the client, the times, then the event's own claims."""
    if claims.get("iss") != issuer:
        return "iss"
    refusal = audience_refusal(claims, client_id) or issued_refusal(claims, now)
    if refusal is not None:
        return refusal
    if "nonce" in claims:
        return "nonce"
    if not _text(claims.get("sub"), SUBJECT_MAX):
        return "sub"
    if not _text(claims.get("jti"), JTI_MAX):
        return "jti"
    if _kind_of(claims.get("events")) is None:
        return "events"
    return None


def event_of(claims: Json) -> Event:
    """The event of claims that passed `event_refusal`."""
    issuer, subject, jti = claims.get("iss"), claims.get("sub"), claims.get("jti")
    kind = _kind_of(claims.get("events"))
    if not (isinstance(issuer, str) and isinstance(subject, str) and isinstance(jti, str)):
        raise ValueError("claims not checked")
    if kind is None:
        raise ValueError("claims not checked")
    return Event(issuer, subject, jti, kind)
