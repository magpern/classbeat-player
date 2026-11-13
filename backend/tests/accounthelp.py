"""An account that holds a row in every table an account can own, for the export and deletion
tests (ADR 0002, section 12). Made through the app's own flows where the app has one, and with
the tests' superuser connection for passkeys, which have no route yet."""

from __future__ import annotations

import base64
import secrets
from dataclasses import dataclass
from uuid import UUID

from tests import pairhelp
from tests import sourcehelp as sh
from tests.pairhelp import DEVICE, bearer
from tests.sitehelp import SESSION_COOKIE, Browser, Site

EXPORT = "/api/site/account/export"
DELETE = "/api/site/account/delete"
LIBRARY = "/api/site/classes"


@dataclass(frozen=True)
class Held:
    """What one account holds: its browsers, its app, its tokens and its id."""

    email: str
    account_id: UUID
    browser: Browser  # signed in; the one that exports or deletes
    other: Browser  # a second session of the same account
    app: Browser
    device_token: str
    server: Browser
    source_token: str
    session_tokens: tuple[str, ...]


def _cookie(browser: Browser) -> str:
    value = browser.cookies.get(SESSION_COOKIE)
    assert value is not None
    return value


def full_account(site: Site, email: str, address: str, server_address: str) -> Held:
    """Sessions, a used device, an approved pairing not yet collected, a source link and a link
    code waiting for its exchange, classes and a removal marker with the sync cursor, a passkey
    with a registration under way, and the audit events of making them."""
    site.allow(email)
    browser = site.sign_in(email, site.browser(address))
    other = site.sign_in(email, site.browser(address))
    app = pairhelp.app_client(site, address)
    token = pairhelp.pair(site, browser, email.split("@")[0] + " PC", app)
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    waiting = pairhelp.start(site, app)
    assert pairhelp.approve(browser, waiting, "Waiting PC").status_code == 200
    source = sh.link(site, browser)
    _, challenge = sh.pkce()
    assert sh.approve(browser, challenge).status_code == 200  # a code that is never exchanged
    server = sh.server(site, server_address)
    title = "Class of " + email
    for class_id, number, document in (
        ("kept", 1, sh.document(title)),
        ("removed", 1, sh.document(title)),
        ("removed", 2, None),
    ):
        published = sh.publish(server, source, sh.envelope(class_id, number, document))
        assert published.status_code == 200 and published.json()["status"] == "applied"
    # A class deleted in the class library on the site: its marker and its `class.deleted` event.
    published = sh.publish(server, source, sh.envelope("site-deleted", 1, sh.document(title)))
    assert published.status_code == 200 and published.json()["status"] == "applied"
    row = site.su.execute(
        "SELECT c.id FROM player.classes c JOIN player.accounts a ON a.id = c.account_id "
        "WHERE a.email = %s AND c.source_class_id = 'site-deleted'",
        (email,),
    ).fetchone()
    assert row is not None
    assert browser.delete(f"{LIBRARY}/{row[0]}").status_code == 204
    row = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (email,)).fetchone()
    assert row is not None and isinstance(row[0], UUID)
    account_id = row[0]
    site.su.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, %s, %s, 'Laptop key')",
        (account_id, secrets.token_bytes(32), secrets.token_bytes(65)),
    )
    site.su.execute(
        "INSERT INTO player.passkey_registrations (account_id, session_id, challenge_hash, "
        "expires_at) SELECT %s, id, %s, now() + interval '5 minutes' FROM player.sessions "
        "WHERE account_id = %s LIMIT 1",
        (account_id, secrets.token_bytes(32), account_id),
    )
    return Held(
        email=email,
        account_id=account_id,
        browser=browser,
        other=other,
        app=app,
        device_token=token,
        server=server,
        source_token=source,
        session_tokens=(_cookie(browser), _cookie(other)),
    )


def owned_tables(site: Site) -> list[tuple[str, str]]:
    """(table, owner column) of every table in the schema that has an owner column."""
    found = site.su.execute(
        "SELECT c.table_name, c.column_name FROM information_schema.columns c "
        "JOIN information_schema.tables t "
        "  ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
        "WHERE c.table_schema = 'player' AND t.table_type = 'BASE TABLE' "
        "  AND (c.column_name = 'account_id' "
        "       OR (c.table_name = 'accounts' AND c.column_name = 'id')) "
        "ORDER BY 1"
    ).fetchall()
    return [(str(table), str(column)) for table, column in found]


def secret_values(site: Site) -> list[bytes]:
    """Every hash, key and handle the database holds, of every account."""
    found: list[bytes] = []
    for statement in (
        "SELECT token_hash FROM player.sessions",
        "SELECT token_hash FROM player.devices",
        "SELECT token_hash FROM player.source_links",
        "SELECT credential_id FROM player.passkeys",
        "SELECT public_key FROM player.passkeys",
        "SELECT challenge_hash FROM player.passkey_registrations",
        "SELECT passkey_user_handle FROM player.accounts",
        "SELECT code_hash FROM player.source_link_codes",
        "SELECT device_code_hash FROM player.pairings",
        "SELECT user_code_hash FROM player.pairings",
    ):
        for (value,) in site.su.execute(statement).fetchall():
            assert isinstance(value, bytes)
            found.append(value)
    return found


def spellings(value: bytes) -> list[str]:
    """The ways a value could be written into JSON: hex, base64 and base64url."""
    return [
        value.hex(),
        base64.b64encode(value).decode("ascii").rstrip("="),
        base64.urlsafe_b64encode(value).decode("ascii").rstrip("="),
    ]
