// Shared set-up for the live-session tests (issue #172): an open class in a chosen link and clock
// state, the live schemas, and helpers to publish a state and forward a phone's command. Fakes only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ClockState, Status } from "../../src/core/clock/clock.ts";
import { initialLink } from "../../src/core/link/types.ts";
import type { LinkModel, LinkStateName } from "../../src/core/link/types.ts";
import { INITIAL, openText } from "../../src/core/player-state.ts";
import type { PlayerState } from "../../src/core/player-state.ts";
import type { CompanionAction } from "../../src/core/live/actions.ts";
import { companionStateOf } from "../../src/core/live/companion-state.ts";
import { newIntake, recordPublished } from "../../src/core/live/intake.ts";
import type { IntakeMemory } from "../../src/core/live/intake.ts";
import { classSchema, converterExamples, readJson, SCHEMA_DIR } from "./fixtures.ts";

export const LIVE_V1 = join(SCHEMA_DIR, "live", "v1");
export const liveSchema = (name: string): Record<string, unknown> => readJson(join(LIVE_V1, `${name}.schema.json`)) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
export const validCompanionState = ajv.compile(liveSchema("companion-state"));
export const validCommandResult = ajv.compile(liveSchema("command-result"));

export const RUN = "AAAAAAAAAAAAAAAAAAAAAA";
export const OTHER_RUN = "BBBBBBBBBBBBBBBBBBBBBB";
export const id = (n: number): string => `id${String(n).padStart(20, "0")}`;

export const text = readFileSync(converterExamples()[0], "utf8");
export const NOW = 100_000;

export const LINK_STATES: readonly LinkStateName[] = ["Locked", "Paused", "Coasting", "Off the list", "Ambiguous", "Manual"];
export const CLOCK_STATUSES: readonly Status[] = ["ready", "running", "paused", "ended"];

const OPENED = new Map<boolean, PlayerState>();
/** The example class, opened once (with or without a reader): opening checks it against the schema. */
function opened(following: boolean): PlayerState {
  const hit = OPENED.get(following);
  if (hit) return hit;
  const s = openText(INITIAL, "a.json", text, classSchema, 0, following);
  OPENED.set(following, s);
  return s;
}

/** An open class with a reader (`following`), its link and clock set as asked. */
export function loaded(link: Partial<LinkModel> = {}, status: Status = "running", classMs = 60_000, following = true): PlayerState {
  const s = opened(following);
  const l = s.loaded;
  if (l === null) throw new Error("the example class did not open");
  const clock: ClockState = { status, lengthMs: l.plan.lengthMs, anchorMs: status === "ended" ? l.plan.lengthMs : status === "ready" ? 0 : classMs, anchorAt: NOW, seenAt: NOW };
  return { ...s, loaded: { ...l, clock, link: { ...initialLink(following), ...link } } };
}

/** A link that follows the music in `state`, after its first lock. */
export const following = (state: LinkStateName, over: Partial<LinkModel> = {}): Partial<LinkModel> => ({ mode: "following", state, everLocked: true, playing: state === "Locked", ...over });

/** A resync was announced just now and can be undone. */
export const undoable = (over: Partial<LinkModel> = {}): Partial<LinkModel> => ({
  ...following("Locked"),
  announce: { text: "resynced, 30 s back", deltaMs: -30_000, until: NOW + 30_000 },
  undo: { clockMs: 90_000, at: NOW, until: NOW + 30_000 },
  ...over,
});

/** The intake after the host published state `seq` (with the state's own `allowed`) at `at`. */
export function published(s: PlayerState, canSend: boolean, seq = 0, at = NOW, allowed?: readonly CompanionAction[]): IntakeMemory {
  const state = companionStateOf(s, at, canSend, RUN, seq);
  if (state === null) throw new Error("no state");
  const m = recordPublished(newIntake(RUN), state, at);
  return allowed === undefined ? m : { ...m, published: m.published.map((p) => ({ ...p, allowed })) };
}

export function forwarded(action: CompanionAction, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, type: "command", slot: 1, id: id(1), run: RUN, basis: 0, action, ...(action === "nudge" ? { deltaMs: 5000 } : {}), ...over };
}
