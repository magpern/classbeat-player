"""Pure rules for the live tokens (ADR 0002, sections 2, 3 and 8; ADR 0005, sections 2 and 3).

The WebSocket's `hello` gives the role by the token's prefix and the session by the token. Two
roles have WebSocket routes so far: the host (`cbp_hst_`) and the controller (`cbp_ctl_`). A
rider token (`cbp_rdr_`) is given out by `POST /api/live/join` (ADR 0007), but gets no role on
the WebSocket until its rider role is built (ADR 0007, section 8, item 7): exactly like a token
of any other type or none, nothing is looked up for it.

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
