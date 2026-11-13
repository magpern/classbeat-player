"""The headers a response gets, chosen from its path and the deployment's prefix (ADR 0002,
section 5; ADR 0005, section 8; #284, #290). Pure: strings in, a dict out.

- The headers follow the path the router matched (route_path_policy.py): the companion page's
  own under `/control`, the page headers everywhere else.
- `Cache-Control: no-store` when the routed path or the full path is a never-stored path, so a
  prefix that is itself the start of an API path (`root_path="/api"`) cannot take it off.
  It only ever replaces a weaker cache rule; nothing here removes a header.
"""

from __future__ import annotations

from player_backend.control_page_policy import control_headers, is_control_path
from player_backend.request_policy import NEVER_STORED, response_headers
from player_backend.route_path_policy import routed_path


def headers_for(path: str, root_path: str, site_origin: str) -> dict[str, str]:
    """The headers of a response to `path` (the full path, prefix included) under `root_path`."""
    routed = routed_path(path, root_path)
    if is_control_path(routed):
        headers = control_headers(routed, site_origin)
    else:
        headers = response_headers(routed)
    if path.startswith(NEVER_STORED):
        headers["Cache-Control"] = "no-store"
    return headers
