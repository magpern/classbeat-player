// The passkey prompt the website checks stand in for (site-fake.ts). The trap (site-instrument.ts)
// calls it last, with its own `note`. Playwright serialises both functions into the page as source
// text, so this one is self-contained too: it imports nothing and calls nothing from this module.

export type Passkey = "ok" | "cancel" | "hold" | "absent";
export type Note = (kind: string, detail: unknown) => void;

/** Replaces `navigator.credentials.get` with an answer chosen by `mode`, or removes passkeys for "absent". */
export function passkeyStandIn(mode: Passkey, note: Note): void {
  if (mode === "absent") {
    delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    return;
  }
  const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
  const get = (options?: CredentialRequestOptions): Promise<Credential | null> => {
    const pk = options?.publicKey;
    const challenge = pk ? new Uint8Array(pk.challenge as ArrayBuffer) : new Uint8Array();
    let shown = "";
    for (let i = 0; i < challenge.length; i += 1) shown += (i ? "," : "") + challenge[i];
    note("passkey", `get challenge=${shown} allow=${pk?.allowCredentials?.length ?? "none"} uv=${pk?.userVerification ?? ""} rp=${pk?.rpId ?? ""}`);
    if (mode === "hold") return new Promise(() => undefined);
    if (mode === "cancel") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
    return Promise.resolve({
      id: "Y3JlZC0x",
      type: "public-key",
      rawId: bytes("cred-1"),
      authenticatorAttachment: "platform",
      response: { clientDataJSON: bytes('{"type":"webauthn.get"}'), authenticatorData: bytes("auth"), signature: bytes("sig"), userHandle: bytes("user") },
    } as unknown as Credential);
  };
  Object.defineProperty(navigator.credentials, "get", { value: get });
  // Adding a passkey (the Passkeys page): the same modes. The new credential's parts are fixed
  // strings, so a check can look for each of them (site-account-states.ts, NEW_CREDENTIAL).
  const create = (options?: CredentialCreationOptions): Promise<Credential | null> => {
    const pk = options?.publicKey;
    const listed = (b: BufferSource | undefined): string => {
      const v = b ? new Uint8Array(b as ArrayBuffer) : new Uint8Array();
      let out = "";
      for (let i = 0; i < v.length; i += 1) out += (i ? "," : "") + v[i];
      return out;
    };
    const sel = pk?.authenticatorSelection;
    note("passkey", `create challenge=${listed(pk?.challenge)} user=${listed(pk?.user.id)} exclude=${pk?.excludeCredentials?.length ?? "none"} rk=${sel?.residentKey ?? ""} uv=${sel?.userVerification ?? ""} rp=${pk?.rp.id ?? ""}`);
    if (mode === "hold") return new Promise(() => undefined);
    if (mode === "cancel") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
    return Promise.resolve({
      id: "bmV3LWNyZWQtN2Y",
      type: "public-key",
      rawId: bytes("new-cred-7f"),
      authenticatorAttachment: "platform",
      response: { clientDataJSON: bytes('{"type":"webauthn.create","n":"cdj-5e"}'), attestationObject: bytes("attestation-object-3c"), getTransports: () => ["internal", "hybrid"] },
    } as unknown as Credential);
  };
  Object.defineProperty(navigator.credentials, "create", { value: create });
}
