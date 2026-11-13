"""WebAuthn, through the maintained library `webauthn` (py_webauthn, pinned in pyproject.toml).

ADR 0002, section 4: the relying party's id is the site's host name and the origin must match
the site's origin exactly, both from `PLAYER_SITE_ORIGIN`. Discoverable credentials, user
verification required, attestation `none`, the algorithms ES256, EdDSA and RS256.

No I/O. A credential that fails any check gives `None`: the library's reasons are never kept,
returned or logged, because they can quote what the client sent.
"""

from __future__ import annotations

from typing import Final

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.cose import COSEAlgorithmIdentifier
from webauthn.helpers.options_to_json_dict import options_to_json_dict
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from player_backend.passkey_policy import CHALLENGE_SECONDS, RP_NAME, NewPasskey, rp_id_of

ALGORITHMS: Final = [
    COSEAlgorithmIdentifier.ECDSA_SHA_256,
    COSEAlgorithmIdentifier.EDDSA,
    COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
]
TIMEOUT_MS: Final = CHALLENGE_SECONDS * 1000


def registration_options(
    site_origin: str,
    *,
    challenge: bytes,
    user_handle: bytes,
    email: str,
    existing: list[bytes],
) -> dict[str, object]:
    """What `navigator.credentials.create()` is given, as JSON. The account's own passkeys are
    excluded, so one authenticator is not registered twice."""
    options = generate_registration_options(
        rp_id=rp_id_of(site_origin),
        rp_name=RP_NAME,
        user_name=email,
        user_id=user_handle,
        user_display_name=email,
        challenge=challenge,
        timeout=TIMEOUT_MS,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            require_resident_key=True,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=found) for found in existing],
        supported_pub_key_algs=ALGORITHMS,
    )
    return options_to_json_dict(options)


def sign_in_options(site_origin: str, *, challenge: bytes) -> dict[str, object]:
    """What `navigator.credentials.get()` is given: no list of credentials (section 4)."""
    options = generate_authentication_options(
        rp_id=rp_id_of(site_origin),
        challenge=challenge,
        timeout=TIMEOUT_MS,
        allow_credentials=[],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    return options_to_json_dict(options)


def verified_registration(
    site_origin: str, credential: dict[str, object], challenge: bytes
) -> NewPasskey | None:
    """The new passkey, or None when the credential fails any check."""
    try:
        found = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id_of(site_origin),
            expected_origin=site_origin,
            require_user_presence=True,
            require_user_verification=True,
            supported_pub_key_algs=ALGORITHMS,
        )
        transports = _transports(credential)
    except Exception:  # Any failure is a refusal; the reason is never kept.
        return None
    return NewPasskey(
        credential_id=found.credential_id,
        public_key=found.credential_public_key,
        sign_count=found.sign_count,
        transports=transports,
    )


def verified_sign_in(
    site_origin: str, credential: dict[str, object], challenge: bytes, public_key: bytes
) -> int | None:
    """The authenticator's counter when the signature and everything it covers check out.

    The counter rule is the database's (`auth_complete_passkey`, with its event), so the
    library is given a stored count of 0, which makes its own check pass any counter.
    """
    try:
        found = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id_of(site_origin),
            expected_origin=site_origin,
            credential_public_key=public_key,
            credential_current_sign_count=0,
            require_user_verification=True,
        )
    except Exception:  # Any failure is a refusal; the reason is never kept.
        return None
    return found.new_sign_count if found.user_verified else None


_TRANSPORTS: Final = frozenset({"usb", "nfc", "ble", "smart-card", "hybrid", "internal", "cable"})


def _transports(credential: dict[str, object]) -> tuple[str, ...]:
    """The transports the browser reported, the known ones only, each once."""
    response = credential.get("response")
    if not isinstance(response, dict):
        return ()
    fields: dict[str, object] = response  # pyright: ignore[reportUnknownVariableType]
    listed = fields.get("transports")
    if not isinstance(listed, list):
        return ()
    found: list[str] = []
    for value in listed:  # pyright: ignore[reportUnknownVariableType]
        if isinstance(value, str) and value in _TRANSPORTS and value not in found:
            found.append(value)
    return tuple(found)
