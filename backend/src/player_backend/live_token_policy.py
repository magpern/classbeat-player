"""Pure rules for the live tokens (ADR 0002, sections 2, 3 and 8; ADR 0005, sections 2 and 3).

The WebSocket's `hello` gives the role by the token's prefix and the session by the token: the
host (`cbp_hst_`), the controller (`cbp_ctl_`) and the rider (`cbp_rdr_`, given out by
`POST /api/live/join`, ADR 0007). A token of any other type, or none, gets no role, and nothing
is looked up for it. Each role's token is looked up only as that role's: a host or controller
token is never a rider's, and a rider token never a host's or a controller's.

For a controller and a rider the handshake's `Origin` must be the site's origin, exactly (the
companion page and the rider page are pages of the site); it is checked before the token is
looked up. The host is the app, not a page of the site: its `Origin` is not checked.
"""

from __future__ import annotations

from typing import Literal

from player_backend.token_policy import is_token

type HelloRole = Literal["host", "controller", "rider"]
# How a controller got its token: the contract's `via` (controller-joined.schema.json).
type Via = Literal["sign_in", "code"]


def hello_role(token: object) -> HelloRole | None:
    """The role a `hello` token asks for, or None when it gets none."""
    if is_token("hst", token):
        return "host"
    if is_token("ctl", token):
        return "controller"
    if is_token("rdr", token):
        return "rider"
    return None


def origin_allowed(role: HelloRole, origin: str | None, site_origin: str) -> bool:
    """Whether a connection of `role` with this handshake `Origin` may say `hello`."""
    return role == "host" or origin == site_origin
