// Passkey sign-in in the browser (ADR 0002, section 4): a challenge from the backend, the
// browser's own prompt, the answer back. The options list no credentials and the request takes
// no email. The challenge and the credential live only in this call: never kept, never logged.
import type { Answer } from "../core/answer.ts";
import { assertionBody, requestOptionsOf } from "../core/webauthn-json.ts";
import type { AssertionLike } from "../core/webauthn-json.ts";
import { call } from "./api.ts";

/** A browser without passkeys shows no passkey button and no explanation (site.md). */
export function passkeySupported(): boolean {
  return typeof window.PublicKeyCredential === "function" && typeof navigator.credentials?.get === "function";
}

export async function passkeySignIn(): Promise<Answer | "cancelled"> {
  const options = await call("POST", "sign-in/passkey/options");
  if (options.kind !== "ok") return options;
  const publicKey = requestOptionsOf(options.body);
  if (!publicKey) return { kind: "server" };
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({ publicKey });
  } catch {
    // Cancelled, timed out or refused by the browser: the reason is not shown.
    return "cancelled";
  }
  if (!credential || credential.type !== "public-key") return "cancelled";
  return call("POST", "sign-in/passkey", assertionBody(credential as unknown as AssertionLike));
}
