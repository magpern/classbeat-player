"""An account's passkeys on the site (ADR 0002, sections 4 and 11), with a software
authenticator: registration and its challenge, the recent sign-in, the algorithms, the
attestation format, the cap, another account's credential, listing, renaming, removing and the
events."""

from __future__ import annotations

import pytest

from tests.passkeyhelp import (
    OPTIONS,
    PASSKEYS,
    Algorithm,
    Authenticator,
    b64,
    options_of,
    register,
    sign_in,
    unb64,
)
from tests.sitehelp import Browser, Site

A = "a@example.test"
B = "b@example.test"
REFUSED = {"error": "passkey_refused"}


def _signed_in(site: Site, email: str = A) -> Browser:
    site.allow(email)
    return site.sign_in(email)


def _rows(site: Site, email: str) -> list[tuple[object, ...]]:
    return [
        tuple(row)
        for row in site.su.execute(
            "SELECT p.id::text, p.credential_id, p.public_key, p.sign_count, p.transports, "
            "p.name, p.created_at, p.last_used_at FROM player.passkeys p "
            "JOIN player.accounts a ON a.id = p.account_id WHERE a.email = %s "
            "ORDER BY p.created_at",
            (email,),
        ).fetchall()
    ]


def _registrations(site: Site) -> int:
    row = site.su.execute("SELECT count(*)::int FROM player.passkey_registrations").fetchone()
    assert row is not None
    return int(str(row[0]))


def _no_longer_recent(site: Site, email: str) -> None:
    site.su.execute(
        "UPDATE player.sessions s SET signed_in_at = now() - interval '11 minutes' "
        "FROM player.accounts a WHERE a.id = s.account_id AND a.email = %s",
        (email,),
    )


@pytest.mark.parametrize("algorithm", ["ES256", "EdDSA", "RS256"])
def test_a_passkey_is_registered_and_signs_in(site: Site, algorithm: Algorithm) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator(algorithm)
    options = options_of(browser.post(OPTIONS))
    assert options["rp"] == {"id": "player.test", "name": "Class player"}
    user = options["user"]
    assert isinstance(user, dict) and user["name"] == A
    selection = options["authenticatorSelection"]
    assert isinstance(selection, dict)
    assert selection["residentKey"] == "required" and selection["userVerification"] == "required"
    assert options["attestation"] == "none"
    algorithms = options["pubKeyCredParams"]
    assert isinstance(algorithms, list)
    assert [p["alg"] for p in algorithms] == [-7, -8, -257]  # pyright: ignore[reportUnknownVariableType]
    assert len(unb64(str(options["challenge"]))) == 32

    credential = authenticator.create(options)
    added = browser.post(PASSKEYS, json={"name": " My‮ laptop ", "credential": credential})
    assert added.status_code == 201, added.text
    body = added.json()
    assert set(body) == {"id", "name", "created_at", "last_used_at"}
    assert body["name"] == "My laptop" and body["last_used_at"] is None
    ((row_id, credential_id, public_key, count, transports, name, _, _),) = _rows(site, A)
    assert (row_id, credential_id, count, name) == (
        body["id"],
        authenticator.credential_id,
        0,
        "My laptop",
    )
    assert public_key == authenticator.cose_key()
    assert transports == ["internal", "hybrid"]  # the unknown one is dropped
    assert site.events(A)[-1] == ("passkey.added", {"passkey_id": body["id"]})
    assert _registrations(site) == 0

    other = site.browser("198.51.100.5")
    assert sign_in(other, authenticator).status_code == 200
    assert other.get(PASSKEYS).json()["passkeys"][0]["last_used_at"] is not None


def test_an_algorithm_the_adr_does_not_allow_is_refused(site: Site) -> None:
    browser = _signed_in(site)
    refused = register(browser, Authenticator("ES384"))
    assert refused.status_code == 400 and refused.json() == REFUSED
    assert _rows(site, A) == [] and _registrations(site) == 0


@pytest.mark.parametrize("fmt", ["packed", "tpm", "android-key", "fido-u2f"])
def test_an_attestation_format_other_than_none_is_refused(site: Site, fmt: str) -> None:
    browser = _signed_in(site)
    credential = Authenticator().create(options_of(browser.post(OPTIONS)), fmt=fmt)
    refused = browser.post(PASSKEYS, json={"name": "Laptop", "credential": credential})
    assert refused.status_code == 400 and refused.json() == REFUSED
    # The challenge is used up, and no passkey is added.
    assert _rows(site, A) == [] and _registrations(site) == 0


@pytest.mark.parametrize(
    "answer",
    [
        {"origin": "https://evil.test"},
        {"origin": "https://player.test:8443"},
        {"rp_id": "evil.test"},
        {"verified": False},
    ],
)
def test_a_wrong_origin_rp_id_or_unverified_user_is_refused(
    site: Site, answer: dict[str, object]
) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    options = options_of(browser.post(OPTIONS))
    credential = authenticator.create(options, **answer)  # pyright: ignore[reportArgumentType]
    refused = browser.post(PASSKEYS, json={"name": "Key", "credential": credential})
    assert refused.status_code == 400 and refused.json() == REFUSED
    assert _rows(site, A) == []
    # The challenge was used up by the refusal: a good answer to it is refused too.
    good = authenticator.create(options)
    assert browser.post(PASSKEYS, json={"name": "Key", "credential": good}).status_code == 400


def test_the_registration_challenge_is_single_use_and_the_sessions_own(site: Site) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    credential = authenticator.create(options_of(browser.post(OPTIONS)))
    body = {"name": "Key", "credential": credential}
    assert browser.post(PASSKEYS, json=body).status_code == 201
    replayed = browser.post(PASSKEYS, json=body)
    assert replayed.status_code == 400 and replayed.json() == REFUSED

    # Another session of the same account cannot use this session's challenge.
    second = site.sign_in(A, site.browser())
    other = Authenticator()
    theirs = other.create(options_of(browser.post(OPTIONS)))
    assert second.post(PASSKEYS, json={"name": "Key", "credential": theirs}).status_code == 400
    assert len(_rows(site, A)) == 1


def test_a_newer_registration_challenge_replaces_the_sessions_older_one(site: Site) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    older = authenticator.create(options_of(browser.post(OPTIONS)))
    newer = authenticator.create(options_of(browser.post(OPTIONS)))
    assert _registrations(site) == 1
    assert browser.post(PASSKEYS, json={"name": "K", "credential": older}).status_code == 400
    assert browser.post(PASSKEYS, json={"name": "K", "credential": newer}).status_code == 201


def test_an_expired_registration_challenge_is_refused(site: Site) -> None:
    browser = _signed_in(site)
    credential = Authenticator().create(options_of(browser.post(OPTIONS)))
    site.su.execute(
        "UPDATE player.passkey_registrations SET expires_at = now() - interval '1 second'"
    )
    answer = browser.post(PASSKEYS, json={"name": "Key", "credential": credential})
    assert answer.status_code == 400 and _rows(site, A) == []


def test_registration_and_removal_need_a_recent_sign_in(site: Site) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    options = options_of(browser.post(OPTIONS))
    added = register(browser, Authenticator())
    passkey_id = added.json()["id"]
    _no_longer_recent(site, A)
    before = (_rows(site, A), site.events(A))
    needed = {"error": "recent_sign_in_required"}
    for answer in (
        browser.post(OPTIONS),
        browser.post(PASSKEYS, json={"name": "K", "credential": authenticator.create(options)}),
        browser.delete(f"{PASSKEYS}/{passkey_id}"),
    ):
        assert answer.status_code == 403 and answer.json() == needed
    assert (_rows(site, A), site.events(A)) == before
    # Listing and renaming need a session only.
    assert browser.get(PASSKEYS).status_code == 200
    renamed = browser.request("PATCH", f"{PASSKEYS}/{passkey_id}", json={"name": "Desk"})
    assert renamed.status_code == 200


def test_a_credential_another_account_holds_is_not_added(site: Site) -> None:
    theirs = Authenticator()
    b = _signed_in(site, B)
    assert register(b, theirs).status_code == 201
    held = _rows(site, B)
    a = _signed_in(site, A)
    # The same authenticator, the same credential id, a key of its own.
    copy = Authenticator()
    copy.credential_id = theirs.credential_id
    refused = register(a, copy)
    assert refused.status_code == 409 and refused.json() == {"error": "passkey_exists"}
    assert _rows(site, A) == [] and _rows(site, B) == held
    assert [e for e, _ in site.events(A) if e.startswith("passkey.")] == []


def test_at_most_ten_passkeys_per_account(site: Site) -> None:
    browser = _signed_in(site)
    for n in range(9):
        assert register(browser, Authenticator(), f"Key {n}").status_code == 201
    pending = Authenticator().create(options_of(browser.post(OPTIONS)))
    # The tenth is added from another session while this one's challenge waits.
    other = site.sign_in(A, site.browser())
    assert register(other, Authenticator(), "Key 9").status_code == 201
    full = browser.post(PASSKEYS, json={"name": "Key 10", "credential": pending})
    assert full.status_code == 409 and full.json() == {"error": "too_many_passkeys"}
    refused = browser.post(OPTIONS)
    assert refused.status_code == 409 and refused.json() == {"error": "too_many_passkeys"}
    assert len(_rows(site, A)) == 10 and _registrations(site) == 0


def test_the_list_shows_names_and_dates_never_a_key(site: Site) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    assert register(browser, authenticator, "First").status_code == 201
    assert register(browser, Authenticator("EdDSA"), "Second").status_code == 201
    answer = browser.get(PASSKEYS)
    listed = answer.json()["passkeys"]
    assert [p["name"] for p in listed] == ["First", "Second"]
    assert all(set(p) == {"id", "name", "created_at", "last_used_at"} for p in listed)
    assert b64(authenticator.credential_id) not in answer.text
    assert b64(authenticator.cose_key()) not in answer.text


def test_a_rename_keeps_everything_but_the_name(site: Site) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    passkey_id = register(browser, authenticator, "Old").json()["id"]
    assert sign_in(site.browser(), authenticator).status_code == 200
    (before,) = _rows(site, A)
    events = site.events(A)
    renamed = browser.request("PATCH", f"{PASSKEYS}/{passkey_id}", json={"name": "New"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "New"
    (after,) = _rows(site, A)
    assert after[5] == "New" and after[:5] + after[6:] == before[:5] + before[6:]
    assert site.events(A) == events
    assert sign_in(site.browser(), authenticator).status_code == 200


@pytest.mark.parametrize(
    ("path", "body", "status"),
    [
        ("not-a-uuid", {"name": "New"}, 422),
        ("00000000-0000-0000-0000-000000000000", {"name": "New"}, 404),
        (None, {"name": "   "}, 422),
        (None, {"name": "x" * 41}, 422),
        (None, {"nom": "New"}, 422),
    ],
)
def test_a_rename_refused(site: Site, path: str | None, body: object, status: int) -> None:
    browser = _signed_in(site)
    passkey_id = register(browser, Authenticator(), "Old").json()["id"]
    answer = browser.request("PATCH", f"{PASSKEYS}/{path or passkey_id}", json=body)
    assert answer.status_code == status
    assert [row[5] for row in _rows(site, A)] == ["Old"]


def test_a_removed_passkey_signs_in_no_more(site: Site) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    passkey_id = register(browser, authenticator).json()["id"]
    assert browser.delete(f"{PASSKEYS}/not-a-uuid").status_code == 422
    assert browser.delete(f"{PASSKEYS}/{passkey_id}").status_code == 204
    assert site.events(A)[-1] == ("passkey.removed", {"passkey_id": passkey_id})
    assert browser.delete(f"{PASSKEYS}/{passkey_id}").status_code == 404
    assert _rows(site, A) == []
    assert sign_in(site.browser(), authenticator).status_code == 401


@pytest.mark.parametrize("name", ["", "   ", "x" * 41, "​​"])
def test_a_registration_without_a_name_is_refused_before_its_challenge_is_used(
    site: Site, name: str
) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    credential = authenticator.create(options_of(browser.post(OPTIONS)))
    answer = browser.post(PASSKEYS, json={"name": name, "credential": credential})
    assert answer.status_code == 422 and answer.json() == {"error": "invalid_name"}
    assert _registrations(site) == 1
    assert browser.post(PASSKEYS, json={"name": "Key", "credential": credential}).status_code == 201


def test_adding_a_passkey_sends_one_notice_with_no_credential_in_it(site: Site) -> None:
    browser = _signed_in(site)
    before = len(site.mailer.sent)
    authenticator = Authenticator()
    options = options_of(browser.post(OPTIONS))
    credential = authenticator.create(options)
    added = browser.post(PASSKEYS, json={"name": "Secret laptop", "credential": credential})
    assert added.status_code == 201
    (mail,) = site.mailer.sent[before:]
    assert mail.to == A and mail.subject == "A new passkey was added"
    assert "https://player.test" in mail.body
    text = mail.subject + " " + mail.body
    response = credential["response"]
    assert isinstance(response, dict)
    secrets = [
        b64(authenticator.credential_id),
        authenticator.credential_id.hex(),
        b64(authenticator.cose_key()),
        str(options["challenge"]),
        str(response["clientDataJSON"]),  # pyright: ignore[reportUnknownArgumentType]
        str(response["attestationObject"]),  # pyright: ignore[reportUnknownArgumentType]
        "Secret laptop",
        str(added.json()["id"]),
    ]
    for value in secrets:
        assert value not in text


def test_a_refused_addition_sends_no_notice(site: Site) -> None:
    theirs = Authenticator()
    assert register(_signed_in(site, B), theirs).status_code == 201
    browser = _signed_in(site)
    before = len(site.mailer.sent)
    copy = Authenticator()
    copy.credential_id = theirs.credential_id
    assert register(browser, Authenticator("ES384")).status_code == 400
    assert register(browser, copy).status_code == 409
    assert register(browser, Authenticator(), "​").status_code == 422
    _no_longer_recent(site, A)
    assert browser.post(OPTIONS).status_code == 403
    assert site.mailer.sent[before:] == []


@pytest.mark.parametrize("size", [15, 1024])
def test_a_credential_id_the_table_cannot_hold_is_refused(site: Site, size: int) -> None:
    browser = _signed_in(site)
    authenticator = Authenticator()
    authenticator.credential_id = b"x" * size
    refused = register(browser, authenticator)
    assert refused.status_code == 400 and refused.json() == REFUSED
    assert _rows(site, A) == [] and _registrations(site) == 0
