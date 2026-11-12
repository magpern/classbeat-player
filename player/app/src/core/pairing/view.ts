// What the presenter may know about pairing. Pure. Built field by field from the state, so the
// device code and the device token can never ride along: the renderer never sees either.
import type { Notice, PairingState } from "./machine.ts";

export type PairingView =
  | { readonly state: "unpaired"; readonly message: string | null }
  | { readonly state: "starting" }
  | { readonly state: "waiting"; readonly userCode: string; readonly page: string; readonly secondsLeft: number }
  | { readonly state: "paired"; readonly email: string; readonly deviceName: string | null; readonly pairAgain: boolean };

export const NOTICE_TEXT: Readonly<Record<Notice, string>> = {
  no_server: "Pairing is not set up on this computer: no server address is set.",
  no_keychain: "This computer has no secure place to keep the pairing (no system keychain), so it cannot be paired.",
  too_many: "Too many pairings were started from this network. Try again in an hour.",
  unreachable: "The server could not be reached. Check the connection and try again.",
  unexpected: "The server gave an answer the player does not understand. Try again later.",
  denied: "The pairing was refused on the website.",
  code_expired: "The code ran out before it was confirmed. Start again for a new code.",
  save_failed: "The pairing could not be kept in the system keychain. Try again.",
  revoked_on_site: "This computer was unpaired on the website.",
  unpaired: "This computer is no longer paired.",
};

export function pairingView(s: PairingState, now: number): PairingView {
  switch (s.kind) {
    case "unpaired":
      return { state: "unpaired", message: s.notice === null ? null : NOTICE_TEXT[s.notice] };
    case "starting":
      return { state: "starting" };
    case "waiting":
      return { state: "waiting", userCode: s.userCode, page: s.page, secondsLeft: Math.max(0, Math.ceil((s.expiresAt - now) / 1000)) };
    case "paired":
      return { state: "paired", email: s.record.email, deviceName: s.deviceName, pairAgain: s.expired };
  }
}
