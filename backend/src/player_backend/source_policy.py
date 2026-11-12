"""Pure rules of linking a source and of the source token (ADR 0002, sections 3, 7 and 10).

- Known sources are a setting: an id, a display name and the exact redirect addresses allowed.
  A request for an unknown source or address is refused without redirecting.
- The approval's answer is the redirect address with the `cbp_lc_` code and the `state`.
- The code's bindings, the PKCE verifier, the 60 seconds and the cap of 5 links are checked
  inside `auth_exchange_link_code`. Here: what the request may carry, and the two limits counted
  by the request (code exchanges per address, source API requests per token).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Final
from urllib.parse import urlencode, urlsplit

from player_backend.mail import Mail
from player_backend.token_policy import is_token

# Section 7: at most 5 links per account (the function refuses above it as well).
MAX_LINKS: Final = 5
# Section 10: source code exchanges, 10 per address per minute; source API requests, 60 per
# source token per minute. Every request with a source token counts under that one limit:
# publications, number reads and ending the link, refused or not.
EXCHANGE_WINDOW: Final = timedelta(minutes=1)
EXCHANGE_MAX: Final = 10
REQUEST_WINDOW: Final = timedelta(minutes=1)
REQUEST_MAX: Final = 60
# What a source may do, as the approval page shows it (section 3, "Source token").
SCOPE: Final = ("publish_classes", "remove_classes", "read_publication_numbers")

_SOURCE_ID: Final = re.compile(r"[a-z][a-z0-9-]{0,39}")
_CHALLENGE: Final = re.compile(r"[A-Za-z0-9_-]{43}")
# OAuth's `state`: printable ASCII without spaces, as a source would make it.
_STATE: Final = re.compile(r"[\x21-\x7e]{1,500}")
_LOOPBACK: Final = frozenset({"127.0.0.1", "[::1]", "localhost"})
REDIRECT_MAX: Final = 2000


class SourcesError(ValueError):
    """The known-sources setting is not allowed. Never carries the value."""


@dataclass(frozen=True)
class KnownSource:
    id: str
    name: str
    redirect_uris: frozenset[str]


def valid_redirect(uri: object) -> bool:
    """An address a source may be sent back to: HTTPS (or HTTP on loopback, for development),
    with no query, fragment or user part, so that the code and state can be appended."""
    if not isinstance(uri, str) or not 1 <= len(uri) <= REDIRECT_MAX:
        return False
    if any(c.isspace() or ord(c) < 0x21 or ord(c) > 0x7E for c in uri):
        return False
    parts = urlsplit(uri)
    if parts.query or parts.fragment or "?" in uri or "#" in uri or "@" in parts.netloc:
        return False
    if not parts.netloc:
        return False
    if parts.scheme == "https":
        return True
    host = parts.netloc.rsplit(":", 1)[0] if not parts.netloc.endswith("]") else parts.netloc
    return parts.scheme == "http" and host in _LOOPBACK


def known_source(raw: object) -> KnownSource:
    """One entry of the setting: {"id", "name", "redirect_uris"}."""
    if not isinstance(raw, dict):
        raise SourcesError("each known source must be an object")
    entry: dict[object, object] = raw  # pyright: ignore[reportUnknownVariableType]
    source_id, name, uris = entry.get("id"), entry.get("name"), entry.get("redirect_uris")
    if set(entry) != {"id", "name", "redirect_uris"}:
        raise SourcesError("a known source has exactly id, name and redirect_uris")
    if not isinstance(source_id, str) or _SOURCE_ID.fullmatch(source_id) is None:
        raise SourcesError("a known source's id must match [a-z][a-z0-9-]{0,39}")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
        raise SourcesError("a known source's name must be 1 to 40 characters")
    if not isinstance(uris, list) or not uris:
        raise SourcesError("a known source needs at least one redirect address")
    listed: list[object] = uris  # pyright: ignore[reportUnknownVariableType]
    checked: list[str] = []
    for uri in listed:
        if not isinstance(uri, str) or not valid_redirect(uri):
            raise SourcesError("a redirect address must be https:// with no query or fragment")
        checked.append(uri)
    return KnownSource(source_id, name.strip(), frozenset(checked))


def find_source(
    sources: tuple[KnownSource, ...], source_id: object, redirect_uri: object
) -> KnownSource | None:
    """The known source that asks, when it asks for one of its exact redirect addresses."""
    for source in sources:
        if source.id == source_id and redirect_uri in source.redirect_uris:
            return source
    return None


def valid_challenge(challenge: object, method: object) -> bool:
    """A PKCE challenge of method S256: 43 base64url characters."""
    return (
        method in (None, "S256")
        and isinstance(challenge, str)
        and _CHALLENGE.fullmatch(challenge) is not None
    )


def valid_state(state: object) -> bool:
    return isinstance(state, str) and _STATE.fullmatch(state) is not None


def back_to_source(redirect_uri: str, code: str, state: str) -> str:
    """The address the approval page's script goes to: the code and the state in the query."""
    return redirect_uri + "?" + urlencode({"code": code, "state": state})


def bearer_source_token(authorization: str | None) -> str | None:
    """The source token of an `Authorization` header, or None when it holds no well-formed one."""
    if authorization is None:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return value if is_token("src", value) else None


def exchange_limit_key(address_hash: bytes) -> bytes:
    """The counter of code exchanges from one address."""
    return hashlib.sha256(b"source.exchange:" + address_hash).digest()


def requests_key(token_hash: bytes) -> bytes:
    """The counter of source API requests with one source token."""
    return hashlib.sha256(b"source.requests:" + token_hash).digest()


def linked_mail(site_origin: str, email: str, source_name: str) -> Mail:
    """The notice that a source was linked. It holds no token and no code."""
    body = (
        source_name + " can now send classes to your account.\n\n"
        "If this was not you, sign in at " + site_origin + " and revoke it under Sources.\n"
    )
    return Mail(to=email, subject="A source was linked", body=body)
