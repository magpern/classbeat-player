"""Linking a source and publishing in the tests, through the real routes.

The source's server is a client without cookies and without an `Origin` header. Codes, tokens
and PKCE verifiers are made at run time. The documents are the contract lane's own examples.
Nothing is sent anywhere: the redirect address is only read back, never opened.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import secrets
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx

from player_backend.publication_policy import content_hash
from tests.sitehelp import SOURCE, Browser, Site

CHECK = "/api/site/source-links/check"
APPROVE = "/api/site/source-links/approve"
LINKS = "/api/site/source-links"
EXCHANGE = "/api/source/token"
PUBLICATIONS = "/api/source/publications"
CLASSES = "/api/source/classes"
OWN_LINK = "/api/source/link"
REDIRECT = next(iter(SOURCE.redirect_uris))
SERVER_HEADERS = {"User-Agent": "classbeat-server/1.0"}
EXAMPLES = Path(__file__).resolve().parents[2] / "schema" / "class-format" / "v1" / "examples"


def document(title: str = "Quick spin") -> dict[str, Any]:
    """A valid class document (the contract lane's example), with its own title."""
    path = EXAMPLES / "valid" / "short-class-no-music.json"
    loaded: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    found = copy.deepcopy(loaded)
    found["class"]["title"] = title
    return found


def envelope(class_id: str, number: int, doc: dict[str, Any] | None) -> dict[str, Any]:
    """A publication: a class when `doc` is given, a removal otherwise."""
    if doc is None:
        return {"source_class_id": class_id, "publication_number": number, "removed": True}
    return {
        "source_class_id": class_id,
        "publication_number": number,
        "content_hash": content_hash(doc),
        "document": doc,
    }


def server(site: Site, address: str = "192.0.2.10", *, raise_errors: bool = True) -> Browser:
    """The source's own server: no cookies, no `Origin`."""
    return site.browser(address, headers=SERVER_HEADERS, raise_errors=raise_errors)


def pkce() -> tuple[str, str]:
    """(verifier, S256 challenge)."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def approve(browser: Browser, challenge: str, state: str = "st-1") -> httpx.Response:
    body = {
        "source": SOURCE.id,
        "redirect_uri": REDIRECT,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return browser.post(APPROVE, json=body)


def code_of(answer: httpx.Response) -> str:
    """The link code in the address the approval sends the browser back to."""
    assert answer.status_code == 200, answer.text
    address = str(answer.json()["redirect"])
    assert address.startswith(REDIRECT + "?")
    return parse_qs(urlsplit(address).query)["code"][0]


def exchange(app: Browser, code: str, verifier: str, **changes: str) -> httpx.Response:
    body = {"source": SOURCE.id, "code": code, "redirect_uri": REDIRECT, "code_verifier": verifier}
    return app.post(EXCHANGE, json={**body, **changes})


def link(site: Site, browser: Browser, app: Browser | None = None) -> str:
    """A source linked to the account `browser` is signed in to. Returns its source token."""
    verifier, challenge = pkce()
    code = code_of(approve(browser, challenge))
    answer = exchange(app or server(site), code, verifier)
    assert answer.status_code == 200, answer.text
    return str(answer.json()["source_token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": "Bearer " + token}


def publish(app: Browser, token: str, body: object) -> httpx.Response:
    return app.post(PUBLICATIONS, json=body, headers=bearer(token))


def class_rows(site: Site, email: str) -> list[tuple[object, ...]]:
    """(source_class_id, number, kind, title or None, sync_position) of the account's classes."""
    return site.su.execute(
        "SELECT c.source_class_id, c.publication_number, c.kind, "
        "c.document -> 'class' ->> 'title', c.sync_position "
        "FROM player.classes c JOIN player.accounts a ON a.id = c.account_id "
        "WHERE a.email = %s ORDER BY c.source_class_id",
        (email,),
    ).fetchall()
