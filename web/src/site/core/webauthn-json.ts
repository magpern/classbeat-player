// WebAuthn's JSON form for passkey sign-in (ADR 0002, section 4). Pure: no I/O.
// The backend sends the options of `navigator.credentials.get()` with base64url binary fields
// and takes the assertion back in the same form. Nothing here keeps a value.

export function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let bin = "";
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface OptionsJson {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The request options from the backend's JSON, or null when it is not what the route sends. */
export function requestOptionsOf(json: unknown): PublicKeyCredentialRequestOptions | null {
  if (!isRecord(json) || typeof json.challenge !== "string") return null;
  const o = json as unknown as OptionsJson;
  try {
    const options: PublicKeyCredentialRequestOptions = {
      challenge: base64urlToBytes(o.challenge),
      // Sign-in lists no credentials (the browser offers its own passkeys); any it did list are kept as sent.
      allowCredentials: (Array.isArray(o.allowCredentials) ? o.allowCredentials : []).map((c) => ({
        id: base64urlToBytes(c.id),
        type: "public-key",
        ...(Array.isArray(c.transports) ? { transports: c.transports as AuthenticatorTransport[] } : {}),
      })),
    };
    if (typeof o.timeout === "number") options.timeout = o.timeout;
    if (typeof o.rpId === "string") options.rpId = o.rpId;
    if (typeof o.userVerification === "string") options.userVerification = o.userVerification;
    return options;
  } catch {
    return null;
  }
}

/** The parts of a sign-in credential the backend reads (`PublicKeyCredential` with an assertion). */
export interface AssertionLike {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly type: string;
  readonly authenticatorAttachment?: string | null;
  readonly response: {
    readonly clientDataJSON: ArrayBuffer;
    readonly authenticatorData: ArrayBuffer;
    readonly signature: ArrayBuffer;
    readonly userHandle?: ArrayBuffer | null;
  };
}

/** The body of `POST /api/site/sign-in/passkey`. */
export function assertionBody(c: AssertionLike): { credential: Record<string, unknown> } {
  const response: Record<string, string> = {
    clientDataJSON: bytesToBase64url(c.response.clientDataJSON),
    authenticatorData: bytesToBase64url(c.response.authenticatorData),
    signature: bytesToBase64url(c.response.signature),
  };
  if (c.response.userHandle) response.userHandle = bytesToBase64url(c.response.userHandle);
  const credential: Record<string, unknown> = { id: c.id, rawId: bytesToBase64url(c.rawId), type: c.type, response };
  if (c.authenticatorAttachment) credential.authenticatorAttachment = c.authenticatorAttachment;
  return { credential };
}
