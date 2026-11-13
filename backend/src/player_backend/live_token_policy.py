"""Pure rules for the live tokens (ADR 0002, sections 2, 3 and 8; ADR 0005, sections 2 and 3).

The WebSocket's `hello` gives the role by the token's prefix and the session by the token. In
the companion part of PL8 two roles have routes: the host (`cbp_hst_`) and the controller
(`cbp_ctl_`). A rider token (`cbp_rdr_`) has a well-formed shape but no route until the riders'
issues build `POST /api/live/join`: it gets no role, exactly like a token of any other type or
none, so nothing is looked up for it.

For a controller the handshake's `Origin` must be the site's origin, exactly; it is checked
before its token is looked up. The host is the app, not a page of the site: its `Origin` is not
checked.
"""

from __future__ import annotations

from typing import Literal

from player_backend.token_policy import is_token

type HelloRole = Literal["host", "controller"]
# How a controller got its token: the contract's `via` (controller-joined.schema.json).
type Via = Literal["sign_in", "code"]


def hello_role(token: object) -> HelloRole | None:
    """The role a `hello` token asks for, or None when it gets none (a rider's included)."""
    if is_token("hst", token):
        return "host"
    if is_token("ctl", token):
        return "controller"
    return None


def origin_allowed(role: HelloRole, origin: str | None, site_origin: str) -> bool:
    """Whether a connection of `role` with this handshake `Origin` may say `hello`."""
    return role == "host" or origin == site_origin
