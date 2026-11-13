// The host's intake of a phone's command (ADR 0005 section 5). Pure: it decides, the caller applies.
// Checks, in this order, after the server's own schema check and the player's (`forwarded.ts`):
//   1. (slot, id) among the run's last 64 commands: `duplicate`, nothing applied;
//   2. another run: `stale_run`;
//   3. a basis above the current seq: `invalid`;
//   4. a basis published more than `staleMs` ago (3 s): `stale`;
//   5. an action not in the last published `allowed`: `not_allowed`;
//   6. the route now would hand the clock over to manual: `would_stop_following`;
//   7. the action does nothing now, or is not offered now, though the phone's picture offered it
//      (a nudge once the clock follows the music again, in any link state; an undo whose window
//      has closed; a start after the presenter started): `not_allowed`, nothing applied;
//   8. otherwise `applied`, with the ClockCommand the caller sends down the presenter's path.
// The one exception to 6 is `undo_resync`: ADR 0001's undo returns to the manual clock. Check 7
// asks the same `allowedActions` the next state will carry, so `applied` always means done.
import type { CommandResult } from "../../../../../schema/generated/ts/live-command-result.d.ts";
import type { CompanionState } from "../../../../../schema/generated/ts/live-companion-state.d.ts";
import type { ForwardedCommand } from "../../../../../schema/generated/ts/live-command-forwarded.d.ts";
import type { ClockCommand } from "../commands.ts";
import type { PlayerState } from "../player-state.ts";
import { command, routeFor } from "../player-state.ts";
import { toClockCommand, UNDO_ACTION } from "./actions.ts";
import { allowedActions } from "./allowed.ts";
import type { CompanionAction } from "./actions.ts";
import { parseForwardedCommand } from "./forwarded.ts";

export interface IntakeConfig {
  /** A command made on a state older than this is refused as `stale` (a player setting). */
  readonly staleMs: number;
}

export const DEFAULT_INTAKE_CONFIG: IntakeConfig = { staleMs: 3000 };
/** How many of the run's commands are remembered for the duplicate check. */
export const REMEMBERED_COMMANDS = 64;
/** At most this many published states are kept (4 a second for 3 s is 12); an older basis is stale. */
export const REMEMBERED_STATES = 64;

export interface Published {
  readonly seq: number;
  readonly at: number;
  readonly allowed: readonly CompanionAction[];
}

export interface IntakeMemory {
  readonly run: string;
  /** `slot:id` of the run's last commands, oldest first. */
  readonly recent: readonly string[];
  /** The states published in the run, oldest first; the last is the current one. */
  readonly published: readonly Published[];
}

export type Reason = NonNullable<CommandResult["reason"]>;

export interface IntakeOutcome {
  readonly memory: IntakeMemory;
  /** The answer for the server to pass on as `ack`; null when the message was dropped as malformed. */
  readonly result: CommandResult | null;
  /** What to apply through the presenter's path, only when applied. */
  readonly command: ClockCommand | null;
}

export function newIntake(run: string): IntakeMemory {
  return { run, recent: [], published: [] };
}

/** Records a state message as sent at monotonic time `at`. A state of another run is ignored. */
export function recordPublished(m: IntakeMemory, state: CompanionState, at: number): IntakeMemory {
  if (state.run !== m.run) return m;
  const last = m.published.at(-1);
  if (last !== undefined && state.seq <= last.seq) return m;
  const published = [...m.published, { seq: state.seq, at, allowed: [...state.allowed] }].slice(-REMEMBERED_STATES);
  return { ...m, published };
}

const answer = (c: ForwardedCommand, result: CommandResult["result"], reason: Reason | null): CommandResult => ({ v: 1, type: "command_result", slot: c.slot, id: c.id, result, reason });

/** Why the command is refused, or null when it is to be applied (checks 2 to 7). */
function refusal(m: IntakeMemory, s: PlayerState, c: ForwardedCommand, cmd: ClockCommand | null, now: number, canSend: boolean, cfg: IntakeConfig): Reason | null {
  if (c.run !== m.run) return "stale_run";
  const current = m.published.at(-1);
  if (current === undefined || c.basis > current.seq) return "invalid";
  const basis = m.published.find((p) => p.seq === c.basis);
  if (basis === undefined || now - basis.at > cfg.staleMs) return "stale";
  if (!current.allowed.includes(c.action)) return "not_allowed";
  if (cmd === null) return "invalid";
  if (c.action !== UNDO_ACTION && stopsFollowing(s, cmd, now, canSend)) return "would_stop_following";
  if (!allowedActions(s, now, canSend).includes(c.action)) return "not_allowed";
  return null;
}

/** The route is a handover, or applying the command would leave the following of the music. */
export function stopsFollowing(s: PlayerState, cmd: ClockCommand, now: number, canSend: boolean): boolean {
  if (routeFor(s, cmd, canSend)?.kind === "manual") return true;
  const before = s.loaded?.link.mode;
  const after = command(s, cmd, now, canSend).loaded?.link.mode;
  return before === "following" && after !== "following";
}

/** Takes one forwarded message (untrusted, checked here again) at monotonic time `now`. */
export function intake(m: IntakeMemory, s: PlayerState, message: unknown, now: number, canSend: boolean, cfg: IntakeConfig = DEFAULT_INTAKE_CONFIG): IntakeOutcome {
  const c = parseForwardedCommand(message);
  if (c === null) return { memory: m, result: null, command: null };
  const key = `${c.slot}:${c.id}`;
  if (m.recent.includes(key)) return { memory: m, result: answer(c, "duplicate", null), command: null };
  const memory = { ...m, recent: [...m.recent, key].slice(-REMEMBERED_COMMANDS) };
  const cmd = toClockCommand(c.action, c.deltaMs);
  const reason = refusal(m, s, c, cmd, now, canSend, cfg);
  if (reason !== null || cmd === null) return { memory, result: answer(c, "refused", reason ?? "invalid"), command: null };
  return { memory, result: answer(c, "applied", null), command: cmd };
}
