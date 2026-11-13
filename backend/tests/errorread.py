"""Test helper: the error codes a route's code can answer, read from its source, failing closed
(for tests/test_live_route_errors.py; #223 N1, #227).

`Reader.function` reads a function and every function of this package it calls by name or
through a module (`devices.entered(...)`). The one error form it reads is a call by name to
`ApiError` (or to a subclass of it whose `__init__` is only `super().__init__(status, code)`)
with a literal status and a code that is a string or a subscript of a module-level dict of
strings; a response class may be called with its content alone (a 200). Any other reference to
an error form in a function it reads fails at once (`Unreadable`): `ApiError` or a response
class through a module or attribute, `error_response`, `HTTPException`, `status_code=`, a
subclass that sets its code another way, a code it cannot resolve. Annotations and the types
of `except` clauses are not answers and are skipped.

What the reading does not follow (a method of an object) is covered by `FORM_WORDS`: the test
checks that no module or class it does not read names any of them.
"""

from __future__ import annotations

import ast
import inspect
import re
import textwrap
import types
from collections.abc import Callable
from typing import Any, Final, cast

from fastapi import HTTPException as FastApiHTTPException
from starlette.exceptions import HTTPException
from starlette.responses import Response

from player_backend import http_errors
from player_backend.http_errors import ApiError, error_response

# A source that names none of these answers no error itself.
FORM_WORDS: Final = re.compile(
    r"ApiError|error_response|http_errors|Response|HTTPException|status_code"
)


class Unreadable(AssertionError):
    """An error answer the reading cannot read: the test fails rather than pass it over."""


def _ours(value: object) -> bool:
    return getattr(value, "__module__", "").startswith("player_backend.")


def _is_form(value: object) -> bool:
    if value is http_errors or value is error_response:
        return True
    if inspect.isclass(value):
        return issubclass(value, (ApiError, Response, HTTPException, FastApiHTTPException))
    return False


def _resolve(node: ast.expr, names: dict[str, Any]) -> object:
    if isinstance(node, ast.Name):
        return names.get(node.id)
    if isinstance(node, ast.Attribute):
        base = _resolve(node.value, names)
        if isinstance(base, types.ModuleType):
            return getattr(base, node.attr, None)
    return None


def _skipped(tree: ast.AST) -> set[int]:
    """The nodes that are types, not answers: annotations and `except` clauses' types."""
    roots: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            roots += [
                a.annotation for a in ast.walk(node.args) if isinstance(a, ast.arg) and a.annotation
            ]
            roots += [node.returns] if node.returns is not None else []
        elif isinstance(node, ast.AnnAssign):
            roots.append(node.annotation)
        elif isinstance(node, ast.ExceptHandler) and node.type is not None:
            roots.append(node.type)
    return {id(n) for root in roots for n in ast.walk(root)}


class Reader:
    def __init__(self) -> None:
        # The functions and error classes read.
        self.read: set[Any] = set()
        self.raised: set[tuple[int, str]] = set()
        # Classes of this package the read code names (not error forms): checked by the test.
        self.classes: set[type] = set()

    def function(self, fn: Callable[..., Any]) -> None:
        fn = inspect.unwrap(fn)
        if fn in self.read:
            return
        self.read.add(fn)
        tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        names: dict[str, Any] = getattr(fn, "__globals__", {})
        handled = _skipped(tree)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                # A name bound inside the function is not in its globals: it would go unseen.
                raise Unreadable(f"{fn.__qualname__}: an import inside the function")
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Name):
                target = names.get(node.exc.id)
                if _is_form(target):
                    self._subclass(cast(type, target))
                    handled.add(id(node.exc))
            elif isinstance(node, ast.Call):
                self._call(node, names, handled)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Name, ast.Attribute)) and id(node) not in handled:
                target = _resolve(node, names)
                if _is_form(target):
                    raise Unreadable(f"{fn.__qualname__}: {ast.unparse(node)}")
                if inspect.isclass(target) and _ours(target):
                    self.classes.add(target)
            if isinstance(node, ast.keyword) and node.arg == "status_code":
                raise Unreadable(f"{fn.__qualname__}: status_code=")

    def _call(self, call: ast.Call, names: dict[str, Any], handled: set[int]) -> None:
        target = _resolve(call.func, names)
        by_name = isinstance(call.func, ast.Name)
        if target is ApiError and by_name:
            self._api_error(call, names)
        elif inspect.isclass(target) and issubclass(target, ApiError) and by_name:
            self._subclass(target)
        elif inspect.isclass(target) and issubclass(target, Response) and by_name:
            if len(call.args) != 1 or call.keywords:
                raise Unreadable(f"a response not read: {ast.unparse(call)}")
        elif inspect.isfunction(target) and _ours(target) and not _is_form(target):
            self.function(target)
            return
        else:
            return
        handled.add(id(call.func))

    def _subclass(self, cls: type) -> None:
        """A subclass of `ApiError` whose `__init__` is `super().__init__(status, code)` only."""
        if cls is ApiError or not issubclass(cls, ApiError) or cls.__bases__ != (ApiError,):
            raise Unreadable(f"not a readable error class: {cls.__qualname__}")
        self.read.add(cls)
        body = [s for s in _body(ast.parse(textwrap.dedent(inspect.getsource(cls))).body[0])]
        inits = [s for s in body if isinstance(s, ast.FunctionDef) and s.name == "__init__"]
        if len(body) != 1 or len(inits) != 1:
            raise Unreadable(f"{cls.__qualname__}: more than an `__init__`")
        init = _body(inits[0])
        call = init[0].value if len(init) == 1 and isinstance(init[0], ast.Expr) else None
        if not (
            isinstance(call, ast.Call)
            and isinstance(call.func, ast.Attribute)
            and call.func.attr == "__init__"
            and isinstance(call.func.value, ast.Call)
            and ast.unparse(call.func.value) == "super()"
        ):
            raise Unreadable(f"{cls.__qualname__}: its code is set another way")
        self._api_error(call, vars(inspect.getmodule(cls)))

    def _api_error(self, call: ast.Call, names: dict[str, Any]) -> None:
        if len(call.args) < 2:
            raise Unreadable(f"status and code not given in order: {ast.unparse(call)}")
        status, code = call.args[0], call.args[1]
        if not (isinstance(status, ast.Constant) and isinstance(status.value, int)):
            raise Unreadable(f"a status this test cannot read: {ast.unparse(status)}")
        for value in _codes(code, names):
            self.raised.add((status.value, value))


def _body(node: ast.stmt) -> list[ast.stmt]:
    """A class's or function's statements without its docstring."""
    statements = list(cast(Any, node).body)
    first = statements[0] if statements else None
    if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
        statements = statements[1:]
    return statements


def _codes(node: ast.expr, names: dict[str, Any]) -> set[str]:
    """The codes an expression can be: a string, or a subscript of a module-level dict."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        table = names.get(node.value.id)
        if isinstance(table, dict):
            values = list(cast(dict[object, object], table).values())
            if all(isinstance(v, str) for v in values):
                return {cast(str, v) for v in values}
    raise Unreadable(f"a code this test cannot read: {ast.unparse(node)}")


def naming_forms(module: types.ModuleType) -> set[str]:
    """The top-level definitions of a module whose source names an error form (imports aside)."""
    tree = ast.parse(inspect.getsource(module))
    found: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module's docstring
        if FORM_WORDS.search(ast.unparse(node)):
            name = getattr(node, "name", None) or ast.unparse(node).split("=")[0].strip()
            found.add(str(name))
    return found
