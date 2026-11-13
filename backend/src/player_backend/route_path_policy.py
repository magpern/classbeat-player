"""The path a request is routed by: its path with the deployment's prefix, `root_path`, taken
off the way Starlette's router takes it off (#284). Pure: two strings in, one out.

The prefix comes off only when the path starts with it and the next character is a `/`; a path
equal to the prefix routes as the empty path, which no route matches. Any other path is routed
as it is, so `root_path="/"` and a prefix with a trailing `/` take nothing off a path.
tests/test_route_path_policy.py pins this against the router itself.
"""

from __future__ import annotations


def routed_path(path: str, root_path: str) -> str:
    """`path` as the router matches it under `root_path`."""
    if not root_path or not path.startswith(root_path):
        return path
    if path == root_path:
        return ""
    rest = path[len(root_path) :]
    return rest if rest.startswith("/") else path
