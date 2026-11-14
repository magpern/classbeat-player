// The riders' part of the host's live session (ADR 0007 sections 2 and 3): what the server's rider
// messages change, and what Remove, Lock joining and New code send. Pure; session-model.ts calls
// it. Each press goes out only while the host is in and the list is the server's (no replay
// pending), and sends exactly the contract's message:
// - Remove: `drop_rider` with a rider in the list; the row goes when `rider_left` `dropped` comes.
// - Lock joining: `lock` with the value asked; the panel changes when `lock_state` comes back.
// - New code: `new_join_code`, at most 10 an hour; the shown control code ends with the old join
//   code at once, as the server sends nothing for it.
import type { HostInbound } from "./host-wire.ts";
import { canAskNewCode, codeMade, hasRider, lockState, newCodeAsked, riderJoined, riderLeft, settled } from "./riders-model.ts";
import type { LiveEvent, LiveModel, Step } from "./session-types.ts";

export type RiderMessage = Extract<HostInbound, { type: "rider_joined" | "rider_left" | "lock_state" | "join_code" }>;
export type RiderEvent = Extract<LiveEvent, { type: "drop_rider" | "lock" | "new_join_code" }>;

export function onRiderMessage(m: LiveModel, msg: RiderMessage, now: number): LiveModel {
  switch (msg.type) {
    case "rider_joined":
      return { ...m, riders: riderJoined(m.riders, { id: msg.rider, nickname: msg.nickname }) };
    case "rider_left":
      return { ...m, riders: riderLeft(m.riders, msg.rider) };
    case "lock_state":
      return { ...m, riders: lockState(m.riders, msg.locked) };
    case "join_code":
      // The room screen and the presenter take the new code from the session at once.
      if (m.session === null) return m;
      return { ...m, session: { ...m.session, joinCode: msg.code }, riders: codeMade(m.riders, msg.code, now) };
  }
}

/** Whether the riders' buttons act now. */
export const ridersActive = (m: LiveModel): boolean => m.phase === "live" && settled(m.riders);

export function onRiderEvent(m: LiveModel, e: RiderEvent, now: number): Step {
  if (!ridersActive(m)) return { model: m, effects: [] };
  switch (e.type) {
    case "drop_rider":
      if (!hasRider(m.riders, e.rider)) return { model: m, effects: [] };
      return { model: m, effects: [{ kind: "send", message: { v: 1, type: "drop_rider", rider: e.rider } }] };
    case "lock":
      return { model: m, effects: [{ kind: "send", message: { v: 1, type: "lock", locked: e.locked } }] };
    case "new_join_code":
      if (!canAskNewCode(m.riders, now)) return { model: m, effects: [] };
      return { model: { ...m, code: null, codeNote: null, riders: newCodeAsked(m.riders, now) }, effects: [{ kind: "send", message: { v: 1, type: "new_join_code" } }] };
  }
}
