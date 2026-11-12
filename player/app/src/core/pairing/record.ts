// What the keychain entry holds, as text before encryption: the device token, the account's
// email and the server that issued the token. Pure. The token is used with that server only.
import { parseBackendOrigin } from "./origin.ts";
import { isDeviceToken, MAX_EMAIL, shownText } from "./protocol.ts";

export interface PairingRecord {
  readonly origin: string;
  readonly token: string;
  readonly email: string;
}

export const MAX_RECORD_BYTES = 16 * 1024;

export const recordText = (r: PairingRecord): string => JSON.stringify({ v: 1, origin: r.origin, token: r.token, email: r.email });

export function parseRecord(text: string, allowLoopbackHttp: boolean): PairingRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { v, origin, token, email } = raw as Record<string, unknown>;
  const parsed = parseBackendOrigin(origin, allowLoopbackHttp);
  const shown = shownText(email, MAX_EMAIL);
  if (v !== 1 || !parsed.ok || parsed.origin !== origin || !isDeviceToken(token) || shown === null) return null;
  return { origin: parsed.origin, token, email: shown };
}
