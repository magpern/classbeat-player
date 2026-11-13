"""What the error reading (tests/errorread.py) refuses to read: each error form it cannot read
fails it, and the forms it reads are read (#223 N1, #227). No database."""

from __future__ import annotations

import importlib
from collections.abc import Callable

import pytest
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from player_backend import http_errors
from player_backend.http_errors import ApiError, error_response
from player_backend.site.deps import NotSignedIn
from tests.errorread import Reader, Unreadable


class _SetsItsCode(ApiError):
    def __init__(self) -> None:
        super().__init__(410, "gone")
        self.code = "other"


class _CodeAnotherWay(ApiError):
    def __init__(self) -> None:
        ApiError.__init__(self, 410, "gone")


class _Deeper(NotSignedIn):
    pass


def _through_a_module() -> None:
    raise http_errors.ApiError(410, "gone")


def _returned() -> JSONResponse:
    return error_response(410, "gone")


def _with_a_status() -> JSONResponse:
    return JSONResponse({"error": "gone"}, status_code=410)


def _http_exception() -> None:
    raise HTTPException(410)


def _a_code_by_name() -> None:
    code = "gone"
    raise ApiError(410, code)


def _a_status_by_name() -> None:
    status = 410
    raise ApiError(status, "gone")


def _sets_its_code() -> None:
    raise _SetsItsCode


def _code_another_way() -> None:
    raise _CodeAnotherWay()


def _deeper() -> None:
    raise _Deeper


def _passed_on(make: Callable[..., Exception] = ApiError) -> None:
    raise make(410, "gone")


@pytest.mark.parametrize(
    "fn",
    [
        _through_a_module,
        _returned,
        _with_a_status,
        _http_exception,
        _a_code_by_name,
        _a_status_by_name,
        _sets_its_code,
        _code_another_way,
        _deeper,
        _passed_on,
    ],
)
def test_an_error_form_the_reading_cannot_read_fails_it(fn: Callable[[], object]) -> None:
    with pytest.raises(Unreadable):
        Reader().function(fn)


def _readable() -> JSONResponse:
    if False:
        raise NotSignedIn
    try:
        raise ApiError(409, "gone")
    except ApiError:
        pass
    return JSONResponse({"ok": True})


def test_the_forms_it_reads_are_read() -> None:
    reader = Reader()
    reader.function(_readable)
    assert reader.raised == {(401, "not_signed_in"), (409, "gone")}


def _local_import() -> None:
    from player_backend.http_errors import ApiError as Local

    raise Local(410, "gone")


def test_an_import_inside_a_function_is_unreadable() -> None:
    with pytest.raises(Unreadable, match="import inside"):
        Reader().function(_local_import)


def _plain_import() -> None:
    import player_backend.http_errors as h

    raise h.ApiError(410, "gone")


def _dunder_import() -> None:
    raise __import__("player_backend.http_errors").http_errors.ApiError(410, "gone")


def _import_module_call() -> None:
    raise importlib.import_module("player_backend.http_errors").ApiError(410, "gone")


@pytest.mark.parametrize("fn", [_plain_import, _dunder_import, _import_module_call])
def test_a_dynamic_or_plain_import_inside_a_function_is_unreadable(
    fn: Callable[[], None],
) -> None:
    with pytest.raises(Unreadable, match="import"):
        Reader().function(fn)
