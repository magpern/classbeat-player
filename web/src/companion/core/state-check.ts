// `companion_state` checked against schema/live/v1/companion-state.schema.json, field by field and
// with its conditional rules, before the page uses it (schema/live/README.md: validate with the
// schema, not with the generated types). Anything else is dropped. Pure: no DOM, no I/O.
//
// The page runs under a content security policy with no `unsafe-eval`, so a schema compiler that
// builds code at run time cannot be used here; the conformance test runs every recorded example
// of the contract through this check (test/unit/companion-wire.test.ts).
import type { CompanionState } from "../../../../schema/generated/ts/live-companion-state.d.ts";
import { DAY_MS, MAX_SAFE, closed, head, intIn, isId, isObj, oneOf, strMax } from "./shape.ts";
import type { Obj } from "./shape.ts";

export type { CompanionState };
export type Action = CompanionState["allowed"][number];
export const ACTIONS: readonly Action[] = ["start", "pause", "resume", "skip", "nudge", "undo_resync"];
/** Whether `action` is in the state's `allowed` list. */
export const allows = (s: CompanionState, action: Action): boolean => (s.allowed as readonly Action[]).includes(action);

const STATUSES: readonly CompanionState["status"][] = ["not_started", "running", "paused", "holding", "ended"];
const MODES = ["following", "manual"] as const;
const LINK_STATES = ["locked", "paused", "coasting", "off_the_list", "ambiguous", "manual"] as const;
const KINDS = ["resynced_back", "resynced_forward", "following_stopped"] as const;

function zone(v: unknown): boolean {
  return isObj(v) && closed(v, ["number", "name"]) && intIn(v.number, 1, 7) && strMax(v.name, 80, 1);
}

function now(v: unknown): boolean {
  return isObj(v) && closed(v, ["index", "zone", "cue", "remainingMs"]) && intIn(v.index, 0, DAY_MS - 1) && zone(v.zone) && strMax(v.cue, 120) && intIn(v.remainingMs, 0, DAY_MS);
}

function coming(v: unknown): boolean {
  return isObj(v) && closed(v, ["startMs", "lengthMs", "zone", "cue"]) && intIn(v.startMs, 0, DAY_MS) && intIn(v.lengthMs, 1, DAY_MS) && zone(v.zone) && strMax(v.cue, 120);
}

function nextSong(v: unknown): boolean {
  if (v === null) return true;
  return isObj(v) && closed(v, ["atMs", "title", "artist"]) && intIn(v.atMs, 0, DAY_MS) && strMax(v.title, 200, 1) && strMax(v.artist, 200, 1);
}

function announcement(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v) || !closed(v, ["kind", "seconds"]) || !oneOf(v.kind, KINDS)) return false;
  // Whole seconds with a resync; null with following_stopped.
  return v.kind === "following_stopped" ? v.seconds === null : intIn(v.seconds, 1, 86_400);
}

function link(v: unknown): v is Obj {
  return isObj(v) && closed(v, ["mode", "state", "canUndo", "announcement"]) && oneOf(v.mode, MODES) && oneOf(v.state, LINK_STATES) && typeof v.canUndo === "boolean" && announcement(v.announcement);
}

function allowed(v: unknown, l: Obj): boolean {
  if (!Array.isArray(v) || v.length > 6 || !v.every((a) => oneOf(a, ACTIONS)) || new Set(v).size !== v.length) return false;
  // The schema's two rules of ADR 0005 section 5: no nudge while following, no undo with nothing to undo.
  if (l.mode === "following" && v.includes("nudge")) return false;
  if (l.canUndo === false && v.includes("undo_resync")) return false;
  return true;
}

const KEYS = ["v", "type", "run", "seq", "status", "classMs", "lengthMs", "classRemainingMs", "now", "next", "nextSong", "link", "allowed"];

/** The value as a `CompanionState` when it holds to the schema, else null. */
export function checkState(v: unknown): CompanionState | null {
  if (!isObj(v) || !closed(v, KEYS) || !head(v, "companion_state")) return null;
  if (!isId(v.run) || !intIn(v.seq, 0, MAX_SAFE) || !oneOf(v.status, STATUSES)) return null;
  if (!intIn(v.classMs, 0, DAY_MS) || !intIn(v.lengthMs, 1, DAY_MS) || !intIn(v.classRemainingMs, 0, DAY_MS)) return null;
  if (!now(v.now) || !Array.isArray(v.next) || v.next.length > 3 || !v.next.every(coming) || !nextSong(v.nextSong)) return null;
  if (!link(v.link) || !allowed(v.allowed, v.link)) return null;
  return v as unknown as CompanionState;
}
