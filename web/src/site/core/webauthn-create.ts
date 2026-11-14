// WebAuthn's JSON form for adding a passkey (ADR 0002, section 4). Pure: no I/O. The backend
// sends the options of `navigator.credentials.create()` with base64url binary fields and takes the
// attestation back in the same form. Nothing here keeps a value.
import { base64urlToBytes, bytesToBase64url } from "./webauthn-json.ts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** The creation options from the backend's JSON, or null when it is not what the route sends. */
export function creationOptionsOf(json: unknown): PublicKeyCredentialCreationOptions | null {
  if (!isRecord(json) || !isStr(json.challenge) || !isRecord(json.rp) || !isStr(json.rp.name) || !isRecord(json.user) || !Array.isArray(json.pubKeyCredParams)) return null;
  const { rp, user } = json;
  const rpName = rp.name;
  if (!isStr(rpName) || !isStr(user.id) || !isStr(user.name) || !isStr(user.displayName)) return null;
  const params = json.pubKeyCredParams as unknown[];
  if (!params.every((p) => isRecord(p) && p.type === "public-key" && typeof p.alg === "number")) return null;
  try {
    const options: PublicKeyCredentialCreationOptions = {
      rp: isStr(rp.id) ? { name: rpName, id: rp.id } : { name: rpName },
      user: { id: base64urlToBytes(user.id), name: user.name, displayName: user.displayName },
      challenge: base64urlToBytes(json.challenge),
      pubKeyCredParams: params.map((p) => ({ type: "public-key", alg: (p as { alg: number }).alg })),
      // The account's own passkeys, so one authenticator is added only once.
      excludeCredentials: (Array.isArray(json.excludeCredentials) ? json.excludeCredentials : []).map((c: unknown) => {
        if (!isRecord(c) || !isStr(c.id)) throw new Error("not a credential");
        return { id: base64urlToBytes(c.id), type: "public-key" as const, ...(Array.isArray(c.transports) ? { transports: c.transports as AuthenticatorTransport[] } : {}) };
      }),
    };
    if (typeof json.timeout === "number") options.timeout = json.timeout;
    if (isRecord(json.authenticatorSelection)) options.authenticatorSelection = json.authenticatorSelection as AuthenticatorSelectionCriteria;
    if (isStr(json.attestation)) options.attestation = json.attestation as AttestationConveyancePreference;
    return options;
  } catch {
    return null;
  }
}

/** The parts of a new credential the backend reads (`PublicKeyCredential` with an attestation). */
export interface AttestationLike {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly type: string;
  readonly authenticatorAttachment?: string | null;
  readonly response: {
    readonly clientDataJSON: ArrayBuffer;
    readonly attestationObject: ArrayBuffer;
    readonly getTransports?: () => string[];
  };
}

/** The `credential` of the body of `POST /api/site/passkeys`. */
export function attestationCredential(c: AttestationLike): Record<string, unknown> {
  const response: Record<string, unknown> = {
    clientDataJSON: bytesToBase64url(c.response.clientDataJSON),
    attestationObject: bytesToBase64url(c.response.attestationObject),
  };
  const transports = typeof c.response.getTransports === "function" ? c.response.getTransports() : null;
  if (Array.isArray(transports) && transports.every(isStr)) response.transports = transports.slice(0, 10);
  const credential: Record<string, unknown> = { id: c.id, rawId: bytesToBase64url(c.rawId), type: c.type, response };
  if (c.authenticatorAttachment) credential.authenticatorAttachment = c.authenticatorAttachment;
  return credential;
}
