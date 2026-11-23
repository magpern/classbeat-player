// When the plain screen shows what its snapshots say (docs/design/room-2d.md, "The flash budget on the
// plain screen"; scene.md, "The flash budget", text rule 2). Every text and colour change falls on a frame
// mark; any two marks are at least 500 ms apart, so at most two in any second. The placement is the pure
// scheduler's (flash-marks.ts, merged in #590): the interval change is a fixed frame, the count's next
// switch beat is one, and an action, a switch beat or a tick is placed by P2 against them and against the
// mark last shown. Pure: times are passed in; the screen owns the timer.
import { MARK_GAP_MS, frameAt, placeMarks } from "../../../player/scene/model/src/flash-marks.ts";
import type { FixedFrame, Want } from "../../../player/scene/model/src/flash-marks.ts";
import { changeKind } from "./change-kind.ts";
import type { ChangeKind } from "./change-kind.ts";
import type { RoomModel } from "./model.ts";

/** 60 Hz; the scheduler's frames are multiples of it. */
export const FRAME_MS = 1000 / 60;
/** The countdown's tick: how late it may be before it joins a fixed frame or is dropped. */
const TICK_MS = 1000;
/** A clock that reports an interval's end this early (or this late) still counts as that change, not a jump. */
const NATURAL_MS = 100;
/** A move of the class clock that differs from the wall time by more than this is a seek or a jump. */
const JUMP_MS = 1500;
/** Fixed frames further ahead than this cannot affect where a mark is placed. */
const LOOKAHEAD_MS = 2000;
/** A mark that joined a fixed frame waits this long for the snapshot of that frame before it shows itself. */
const JOIN_GRACE_MS = 250;

export interface MarkContext {
  /** When the running interval ends (its change frame), or null when no change is coming. */
  readonly changeAtMs: number | null;
  /** When a counted pattern's side ends: the next switch beat. */
  readonly switchAtMs: number | null;
}

export interface MarkGate {
  /** The newest model at `nowMs`: the model to draw now, or null (it waits for its mark, see `wakeAtMs`). */
  offer(model: RoomModel, nowMs: number, ctx: MarkContext): RoomModel | null;
  /** The model to draw now if a placed mark has come, else null. */
  due(nowMs: number): RoomModel | null;
  /** When to call `due` next, or null when nothing waits. */
  wakeAtMs(): number | null;
}

interface Pending {
  readonly since: number;
  readonly kind: ChangeKind | "change";
  readonly at: number;
}
interface Seen {
  readonly model: RoomModel;
  readonly atMs: number;
  readonly ctx: MarkContext;
}

export function createMarkGate(frameMs: number = FRAME_MS): MarkGate {
  let shown: RoomModel | null = null;
  let latest: RoomModel | null = null;
  let lastMark = Number.NEGATIVE_INFINITY;
  let pending: Pending | null = null;
  let prev: Seen | null = null;

  const show = (nowMs: number): RoomModel | null => {
    shown = latest;
    lastMark = nowMs;
    pending = null;
    return shown;
  };

  /** The interval's end that the last offer expected has come, and the clock did not jump to get there. */
  function jumped(before: Seen | null, model: RoomModel, nowMs: number): boolean {
    if (!before) return false;
    const expected = before.model.moving ? nowMs - before.atMs : 0;
    return Math.abs(model.classMs - before.model.classMs - expected) > JUMP_MS;
  }
  function natural(before: Seen | null, model: RoomModel, nowMs: number): boolean {
    if (!before || before.ctx.changeAtMs === null || before.model.intervalKey === model.intervalKey) return false;
    return nowMs >= before.ctx.changeAtMs - NATURAL_MS && !jumped(before, model, nowMs);
  }

  function place(kind: ChangeKind, model: RoomModel, nowMs: number, ctx: MarkContext, since: number): number | null {
    const fixed: FixedFrame[] = [ctx.changeAtMs, ctx.switchAtMs]
      .filter((t): t is number => t !== null && t >= nowMs - NATURAL_MS && t - nowMs < LOOKAHEAD_MS)
      .map((t) => ({ atMs: frameAt(t, frameMs), change: true, changes: [t], drops: [] }));
    const want: Want = { kind, atMs: since, periodMs: kind === "tick" ? (model.count?.beatMs ?? TICK_MS) : undefined };
    const [placed] = placeMarks(fixed, [want], frameMs, Number.isFinite(lastMark) ? [lastMark] : []);
    if (!placed || placed.atMs === null) return null;
    // A want that joined a fixed frame waits for that frame's own snapshot; it shows itself only if that never comes.
    const onFixed = placed.how === "joined" && fixed.some((f) => f.atMs === placed.atMs);
    return Math.max(placed.atMs + (onFixed ? JOIN_GRACE_MS : 0), lastMark + MARK_GAP_MS);
  }

  return {
    offer(model, nowMs, ctx) {
      const before = prev;
      prev = { model, atMs: nowMs, ctx };
      latest = model;
      if (shown === null) return show(nowMs);
      const found = changeKind(shown, model);
      if (found === null) {
        pending = null;
        return null;
      }
      const since = pending?.since ?? nowMs;
      const change = pending?.kind === "change" || natural(before, model, nowMs);
      // The change frame is fixed: it shows at once. Only if the clock did not tell the screen it was coming (and the last
      // mark is under 500 ms away) is it held back, so that no two marks are ever closer than the invariant.
      const at = change ? Math.max(nowMs, lastMark + MARK_GAP_MS) : place(jumped(before, model, nowMs) && found === "tick" ? "action" : found, model, nowMs, ctx, since);
      if (at === null) {
        pending = null;
        return null;
      }
      pending = { since, kind: change ? "change" : found, at };
      return at <= nowMs ? show(nowMs) : null;
    },
    due(nowMs) {
      return pending && pending.at <= nowMs ? show(nowMs) : null;
    },
    wakeAtMs: () => pending?.at ?? null,
  };
}
