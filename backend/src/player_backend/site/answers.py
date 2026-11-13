"""The site API's answer models, generated in the contract lane (schema/site-api/v1).

The generated modules are the one source: the backend loads them as they are in
`schema/generated/python/`, once per process, and never copies or edits them. A missing or
unreadable file fails the first request that needs it loudly, never quietly.
"""

from __future__ import annotations

import importlib.util
import sys
from functools import cache
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, Final, cast

if TYPE_CHECKING:
    # Found by pyright through `extraPaths` (pyproject.toml); loaded below at run time.
    from site_api_me import MeAnswer

# backend/src/player_backend/site/ -> the repository's root.
GENERATED_DIR: Final = Path(__file__).resolve().parents[4] / "schema" / "generated" / "python"


# The generated modules are registered under this prefix, never under their bare names, so that
# an unrelated module of the same name is never taken for one of them.
NAMESPACE: Final = "player_backend._generated"


def _load(name: str) -> ModuleType:
    """The generated module `name`, from its file, under `NAMESPACE`."""
    if not name.isidentifier():
        raise ValueError("not a generated module name: " + name)
    path = GENERATED_DIR / f"{name}.py"
    key = f"{NAMESPACE}.{name}"
    loaded = sys.modules.get(key)
    if loaded is not None:
        # Only ever the module this function loaded from the generated file.
        if getattr(loaded, "__file__", None) != str(path):
            raise ImportError("not the generated module: " + key)
        return loaded
    spec = importlib.util.spec_from_file_location(key, path)
    if spec is None or spec.loader is None:
        raise ImportError("no generated module: " + name)
    module = importlib.util.module_from_spec(spec)
    # Registered before it runs, so that its model resolves its annotations in its own module.
    sys.modules[key] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[key]
        raise
    return module


@cache
def me_answer() -> type[MeAnswer]:
    """`MeAnswer`: the answer of `GET /api/site/me`. It refuses any field but the email."""
    return cast("type[MeAnswer]", _load("site_api_me").MeAnswer)
