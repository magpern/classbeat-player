// Adding a passkey in the browser (ADR 0002, sections 4 and 10): a registration challenge for this
// session, the browser's own prompt, the attestation back with the name. The challenge, the user
// handle and the attestation live only in this call, the one resend after a `busy` answer
// included: never kept, never logged.
import type { AddOutcome } from "../core/passkeys-model.ts";
import { busyResendAfter } from "../core/sign-in-model.ts";
import { attestationCredential, creationOptionsOf } from "../core/webauthn-create.ts";
import type { AttestationLike } from "../core/webauthn-create.ts";
import { call } from "./api.ts";

/** Whether this browser can make a passkey. Without it the page offers no "Add a passkey". */
export function passkeyCreateSupported(): boolean {
  return typeof window.PublicKeyCredential === "function" && typeof navigator.credentials?.create === "function";
}

/** The outcome names the step that ended it. `name` is the checked name (1 to 40 characters). */
export async function addPasskey(name: string): Promise<AddOutcome> {
  const options = await call("POST", "passkeys/options");
  if (options.kind !== "ok") return { step: "options", answer: options };
  const publicKey = creationOptionsOf(options.body);
  if (!publicKey) return { step: "options", answer: { kind: "server" } };
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({ publicKey });
  } catch {
    // Cancelled, timed out, already registered or refused by the browser: the reason is not shown.
    return "cancelled";
  }
  if (!credential || credential.type !== "public-key") return "cancelled";
  const body = { name, credential: attestationCredential(credential as unknown as AttestationLike) };
  const first = await call("POST", "passkeys", body);
  const wait = busyResendAfter(first);
  if (wait === null) return { step: "register", answer: first };
  // Busy: the backend rolled the challenge's use back, so the same answer goes once more after the wait.
  await new Promise<void>((done) => setTimeout(done, wait * 1000));
  return { step: "register", answer: await call("POST", "passkeys", body) };
}
