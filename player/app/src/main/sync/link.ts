// How class sync and the pairing meet: sync reads the token from the pairing for each request and
// tells it what the server said about it; the pairing tells sync when it is saved or deleted.
import { createHash } from "node:crypto";
import type { PairingService } from "../pairing/service.ts";
import type { SyncCredential, SyncService } from "./service.ts";

/**
 * Whose classes a token reads: the server and the account's email, as a key that names neither.
 * An account with no email has nothing that tells it from another such account, so its key is
 * the pairing's own: each pairing of it starts a cache of its own, and no two accounts ever share
 * one. A shown email never holds a control character, so the NUL keeps the two kinds apart.
 */
export const accountKey = (origin: string, email: string | null, token: string): string =>
  createHash("sha256").update(email === null ? `${origin}\n\u0000${token}` : `${origin}\n${email}`, "utf8").digest("hex");

export function credentialOf(pairing: PairingService): SyncCredential | null {
  const c = pairing.credential();
  if (c === null) return null;
  return { origin: c.record.origin, token: c.record.token, account: accountKey(c.record.origin, c.record.email, c.record.token), expired: c.expired };
}

/** Wires the two together, then starts sync. Call once, after the pairing has loaded. */
export function linkAndStart(pairing: PairingService, sync: SyncService): void {
  pairing.watch((change) => (change === "forgotten" ? sync.forgotten() : sync.syncNow()));
  // A cache with no pairing behind it is left over from a pairing that ended while a class played
  // and the app quit before the wipe: it is wiped now. Not when the keychain cannot be read at all,
  // where the pairing may still be there.
  if (pairing.credential() === null && pairing.keychainAvailable()) sync.forgotten();
  sync.start();
}
