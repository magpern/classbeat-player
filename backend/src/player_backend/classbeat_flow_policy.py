"""Pure rules of the classbeat sign-in flow around the ID token (ADR 0010, sections 2, 5 and 6).

The authorize address, the PKCE challenge of the binding token, what the callback accepts, and
where it sends the browser afterwards. No I/O.
"""

from __future__ import annotations

import base64
import hashlib
import re
from collections.abc import Sequence
from typing import Final, Literal
from urllib.parse import urlencode

type Purpose = Literal["sign_in", "reauth"]

# The browser's cookie, and the row it names, live 10 minutes (section 2, step 1).
FLOW_LIFETIME: Final = 600
CALLBACK_PATH: Final = "/api/site/sign-in/classbeat/callback"
SCOPE: Final = "openid email"
# Every refusal sends the browser here, with no reason in the address (section 2, step 2).
ERROR_PATH: Final = "/sign-in#error=classbeat"
# A sign-in carries no return entry (section 6): every callback that signs in lands here.
DONE_PATH: Final = "/classes"

# `state` is 32 random bytes as base64url, as made here. classbeat's code is opaque: a bound on
# its length and the characters an OAuth code uses (RFC 6749, appendix A.11).
_STATE: Final = re.compile(r"[A-Za-z0-9_-]{43}")
_CODE: Final = re.compile(r"[\x21-\x7e]{1,512}")
_CALLBACK_KEYS: Final = frozenset({"code", "state", "iss", "error", "error_description"})


def code_challenge(verifier: str) -> str:
    """PKCE S256: base64url(SHA-256(verifier)), without padding."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorize_address(
    authorize_url: str,
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    nonce: str,
    challenge: str,
    purpose: Purpose,
) -> str:
    """The address the page's script navigates to. `prompt=login` only to re-authenticate."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if purpose == "reauth":
        params["prompt"] = "login"
    return authorize_url + "?" + urlencode(params)


def is_navigation(sec_fetch_mode: str | None, sec_fetch_dest: str | None) -> bool:
    """The callback is a top-level navigation: each header, when present, says so."""
    if sec_fetch_mode is not None and sec_fetch_mode != "navigate":
        return False
    return sec_fetch_dest is None or sec_fetch_dest == "document"


def callback_values(items: Sequence[tuple[str, str]], issuer: str) -> tuple[str, str] | None:
    """(code, state) of a callback's query, or None when it is to be refused.

    Refused: an `error`, a parameter that is not one of the flow's, any of them twice, a
    missing or malformed `code` or `state`, or an `iss` (RFC 9207) that is not the issuer.
    """
    keys = [key for key, _ in items]
    if len(set(keys)) != len(keys) or not set(keys) <= _CALLBACK_KEYS or "error" in keys:
        return None
    values = dict(items)
    code, state = values.get("code"), values.get("state")
    if code is None or state is None or "iss" in values and values["iss"] != issuer:
        return None
    if _CODE.fullmatch(code) is None or _STATE.fullmatch(state) is None:
        return None
    return code, state
