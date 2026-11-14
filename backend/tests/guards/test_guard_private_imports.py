"""Guard: no backend module reaches a private part of Starlette (private_import_check.py; #284,
#290, #339). Each form the allowlist refuses has a case, the earlier reviewers' probes among
them, and each form it permits has one that must pass."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.guards.private_import_check import DYNAMIC_IMPORTS, check_source, check_tree
from tests.guards.sql_source_check import source_files

SRC = Path(__file__).resolve().parents[2] / "src"
OUTSIDE = "player_backend/routes.py"


def _violations(snippet: str, rel: str = OUTSIDE) -> list[str]:
    return [v.rule for v in check_source(snippet + "\n", rel)]


def test_backend_source_passes_the_guard() -> None:
    files = source_files(SRC)
    assert files, "the scan read no source"
    assert [str(v) for v in check_tree(SRC)] == []


def test_every_dynamic_importer_is_a_source_file() -> None:
    assert set(DYNAMIC_IMPORTS) <= set(source_files(SRC))


@pytest.mark.parametrize(
    "snippet",
    [
        # Static imports (#284, #290).
        "from starlette._utils import get_route_path",
        "import starlette._utils",
        "import starlette._utils as x",
        "import starlette . _utils as x",
        "from starlette import _utils",
        "from starlette import routing, _utils as u",
        "from starlette import (\n    routing,\n    _utils,\n)",
        "from starlette.middleware._x import y",
        "from starlette.routing import _private",
        "from starlette.routing import __private",
        # An attribute of a name an import bound (#292 N1).
        "import starlette\nstarlette._utils",
        "import starlette as s\ns._utils.get_route_path",
        "import starlette.routing\nstarlette.routing._x",
        "from starlette import routing as r\nr._x",
        "from starlette.routing import Router\nRouter()._x",
        "import starlette as s\nm = s\nn = m.routing\nn._x",
        "import starlette as s\nm: object = s.routing\nm._x",
        "import starlette as s\nif (m := s):\n    m._x",
        # A private name looked up on a bound name.
        "import starlette as s\ns.__dict__['_utils']",
        "import starlette as s\nvars(s).get('_utils')",
        # Reflection without a literal public name.
        "import starlette as s\ngetattr(s, '_utils')",
        "getattr(mod, '_x')",
        "hasattr(mod, '_x')",
        "setattr(mod, '_x', 1)",
        "delattr(mod, '_x')",
        "getattr(mod, name)",
        "getattr(mod, '_' + 'x')",
        "getattr(builtins_module, '__import__')",
        "getattr(builtins_module, 'eval')",
        # Dynamic imports.
        "import importlib\nimportlib.import_module('x._y')",
        "importlib.import_module('starlette._utils')",
        "from importlib import import_module\nimport_module('starlette' + '._utils')",
        "import importlib.util",
        "__import__('starlette._utils')",
        "x = __import__",
        "import builtins\nbuiltins.__import__('starlette._utils')",
        "eval('1')",
        "exec('import starlette._utils')",
        "compile('x', 'f', 'exec')",
        "import runpy",
        "import pkgutil",
        "from zipimport import zipimporter",
        # A private module named in a key or an argument.
        "import sys\nsys.modules['starlette._utils']",
        "load(name='starlette._utils')",
    ],
)
def test_the_scan_refuses_each_form(snippet: str) -> None:
    assert _violations(snippet) != []


@pytest.mark.parametrize(
    "snippet",
    [
        "from starlette.routing import Route, Router",
        "import starlette.routing as routing",
        "from starlette import status",
        "from mystarlette._x import y",
        "from ._utils import x",
        "from player_backend.db.executor._errors import DatabaseError",
        # Dunders are public here (#292 N2).
        "import starlette\nstarlette.__version__",
        "from starlette import __version__",
        "import starlette.routing as r\nr.Router.__init__",
        "getattr(loaded, '__file__', None)",
        # Comments and strings are not imports (#292 N2).
        "# from starlette._utils import get_route_path",
        '"""Not starlette._utils: the routed path is ours."""',
        "message = 'starlette._utils is private'",
        "log('see starlette._utils for why')",
        # Our own private names, and public reflection.
        "class A:\n    _x = 1\n\n\nA._x",
        "getattr(route, 'path', None)",
        "import re\nre.compile('x')",
        "sys.modules.get(key)",
    ],
)
def test_the_scan_permits_each_public_form(snippet: str) -> None:
    assert _violations(snippet) == []


@pytest.mark.parametrize(
    ("rel", "snippet"),
    [
        ("player_backend/db/executor/__init__.py", "from importlib import import_module as _m"),
        ("player_backend/site/answers.py", "import importlib.util"),
    ],
)
def test_a_dynamic_importer_may_use_its_listed_form_only(rel: str, snippet: str) -> None:
    assert _violations(snippet, rel) == []
    assert _violations(snippet, OUTSIDE) != []
    assert _violations("import importlib", rel) != []
    assert _violations("__import__('x')", rel) != []
    assert _violations("x = import_module('starlette._utils')", rel) != []
