// What a phone's place holds, from what the live process tells the host (ADR 0005 section 10,
// amended 2026-11-14). Pure. Each `controller_joined` and `controller_left` sets its place outright,
// whatever the presenter showed before, so the replay after each host `welcome` rebuilds both
// places from the server's word alone.
//
// - `controller_joined`: a phone holds the place and is connected ("steering").
// - `controller_left` `disconnected`: the token is still valid and the phone may come back ("not
//   connected", with Drop).
// - `controller_left` `session_ended`, `dropped` or `free`: no token holds the place ("free"). A
//   phone whose site session ended comes back only by taking a place again.
import type { HostInbound } from "./host-wire.ts";
import type { Place } from "./session-types.ts";

export type PlaceMessage = Extract<HostInbound, { readonly type: "controller_joined" | "controller_left" }>;

export function placeOf(msg: PlaceMessage): Place {
  if (msg.type === "controller_joined") return "connected";
  return msg.reason === "disconnected" ? "away" : "none";
}
