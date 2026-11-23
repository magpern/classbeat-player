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
/** Two draws this close in real time are one change (made in one task, painted in one frame). */
const SAME_INSTANT_MS = 1;
/** A mark is placed against fixed frames up to this far ahead (room-2d.md, "Timed and outside changes": up to 1 s). */
export const LOOKAHEAD_MS = 1000;

export interface MarkContext {
  /** When the running interval ends (its change frame), or null when no change is coming. */
  readonly changeAtMs: number | null;
  /** When a counted pattern's side ends: the next switch beat. */
  readonly switchAtMs: number | null;
}

/** A frame mark reserved for an outside change: `run` is called when the frame comes (see `MarkGate.request`). */
export interface MarkTicket {
  /** The frame the change will be drawn in, on the screen's clock (`RoomClock.now`). */
  readonly atMs: number;
  /** Gives the mark up (the change is no longer wanted); no effect once `run` has been called. */
  cancel(): void;
}
interface Outside {
  at: number;
  readonly run: () => void;
}

export interface MarkGate {
  /**
   * The one ledger of the whole room window. An outside change (the band, the join sheet, a plate) asks for a mark at
   * `nowMs`: it is placed by the same `placeMarks` call as the screen's own marks, as an action, against the fixed frames
   * of the last offer (the interval's end, the count's switch beat), the mark last drawn, and every mark already reserved
   * or pending, so no two marks of either kind are closer than 500 ms. The frame is returned at once; `dueOutside` hands
   * back `run` when it has come.
   */
  request(nowMs: number, run: () => void): MarkTicket;
  /** The outside changes whose frame has come, to be drawn now (in one frame together with `due`'s model). */
  dueOutside(nowMs: number): (() => void)[];
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
  let outside: Outside[] = [];

  const grid = (ms: number): number => frameAt(ms, frameMs);
  const sameFrame = (a: number, b: number): boolean => Math.abs(grid(a) - grid(b)) < 1e-6;
  /** Every mark the scheduler must keep away from, on the grid: the last draw, the marks reserved for outside changes, the pending mark. */
  const placed = (): number[] => [
    ...(Number.isFinite(lastMark) ? [grid(lastMark)] : []),
    ...outside.map((o) => grid(o.at)),
    ...(pending && Number.isFinite(pending.at) ? [grid(pending.at)] : []),
  ];
  /** A draw at the real time `nowMs`: a reserved mark in this frame is drawn with it, one still ahead and under 500 ms away gives way to the real gap. */
  function settle(nowMs: number): void {
    lastMark = Math.max(lastMark, nowMs);
    for (const o of outside) {
      if (o.at <= nowMs) continue;
      // In the frame of this draw it is drawn with it (one change); under 500 ms ahead in another, it gives way to the real gap.
      if (sameFrame(o.at, nowMs)) o.at = nowMs;
      else if (o.at - nowMs < MARK_GAP_MS) o.at = grid(nowMs + MARK_GAP_MS);
    }
  }
  const fixedFrames = (ctx: MarkContext, nowMs: number): FixedFrame[] =>
    [ctx.changeAtMs, ctx.switchAtMs]
      .filter((t): t is number => t !== null && t >= nowMs - NATURAL_MS && t - nowMs < LOOKAHEAD_MS)
      .map((t) => ({ atMs: frameAt(t, frameMs), change: true, changes: [t], drops: [] }));

  /** Draws now. The mark is the time of the draw itself, never a rounded one: the gap to the next is kept from it. */
  const show = (nowMs: number): RoomModel | null => {
    shown = latest;
    pending = null;
    settle(nowMs);
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

  function place(kind: ChangeKind, model: RoomModel, nowMs: number, rawMs: number, ctx: MarkContext, since: number): number | null {
    const fixed = fixedFrames(ctx, nowMs);
    const want: Want = { kind, atMs: since, periodMs: kind === "tick" ? (model.count?.beatMs ?? TICK_MS) : undefined };
    // The scheduler sees the grid only: the last draw, rounded up, is a mark at least as late as it really was.
    const [put] = placeMarks(fixed, [want], frameMs, placed());
    if (!put || put.atMs === null) return null;
    // A want that joined a fixed frame still ahead shows in that frame, with the snapshot of the frame itself (the change
    // frame, the switch beat): it waits for it, and is placed again by every snapshot until then.
    // It waits at most NATURAL_MS past that frame: the snapshot of the frame itself is due then.
    if (put.how === "joined" && put.atMs > rawMs && fixed.some((f) => f.atMs === put.atMs)) return put.atMs + NATURAL_MS;
    // At the instant of the mark just drawn (an outside change drew with it) it shares that draw: one change, not two.
    if (put.how === "joined" && rawMs - lastMark <= SAME_INSTANT_MS) return rawMs;
    return Math.max(put.atMs, lastMark + MARK_GAP_MS);
  }

  return {
    offer(model, rawMs, ctx) {
      // Every time the scheduler is given is on the frame grid: a clock that is off the grid would round a placement past
      // 500 ms late and send an action to a frame mark far ahead. A draw is never before its placed frame, on the real
      // clock, and is recorded at the real time it was made.
      const nowMs = frameAt(rawMs, frameMs);
      const before = prev;
      prev = { model, atMs: nowMs, ctx };
      latest = model;
      if (shown === null) return show(rawMs);
      const found = changeKind(shown, model);
      if (found === null) {
        pending = null;
        return null;
      }
      const since = pending?.since ?? nowMs;
      const change = pending?.kind === "change" || natural(before, model, nowMs);
      // The change frame is fixed: it shows at once. Only if the clock did not tell the screen it was coming (and the last
      // mark is under 500 ms away) is it held back, so that no two marks are ever closer than the invariant.
      const at = change ? Math.max(rawMs, lastMark + MARK_GAP_MS) : place(jumped(before, model, nowMs) && found === "tick" ? "action" : found, model, nowMs, rawMs, ctx, since);
      if (at === null) {
        pending = null;
        return null;
      }
      pending = { since, kind: change ? "change" : found, at };
      return at <= rawMs ? show(rawMs) : null;
    },
    due(rawMs) {
      return pending && pending.at <= rawMs ? show(rawMs) : null;
    },
    request(rawMs, run) {
      const nowMs = grid(rawMs);
      const [put] = placeMarks(fixedFrames(prev?.ctx ?? { changeAtMs: null, switchAtMs: null }, nowMs), [{ kind: "action", atMs: nowMs }], frameMs, placed());
      // At the instant of the last draw it shares that draw; else never closer than 500 ms to the real last draw.
      const sharesDrawn = put?.how === "joined" && rawMs - lastMark <= SAME_INSTANT_MS;
      let at = sharesDrawn ? rawMs : Math.max(put?.atMs ?? nowMs, grid(lastMark + MARK_GAP_MS), rawMs);
      // Over 500 ms late (a mark of the screen's own, pending or reserved, stands in the way): it shares the nearest mark already
      // placed ahead of it, a frame that is drawn anyway, as P2 does with a fixed frame.
      if (at - rawMs > MARK_GAP_MS + 1e-6) {
        const ahead = [...fixedFrames(prev?.ctx ?? { changeAtMs: null, switchAtMs: null }, nowMs).map((f) => f.atMs), ...outside.map((o) => o.at), ...(pending && Number.isFinite(pending.at) ? [pending.at] : [])].filter((t) => t >= rawMs && t - rawMs <= 1000);
        if (ahead.length > 0) at = Math.min(...ahead);
      }
      const entry: Outside = { at, run };
      outside.push(entry);
      return {
        get atMs() {
          return entry.at;
        },
        cancel: () => {
          outside = outside.filter((o) => o !== entry);
        },
      };
    },
    dueOutside(rawMs) {
      const ready = outside.filter((o) => o.at <= rawMs).sort((a, b) => a.at - b.at);
      if (ready.length === 0) return [];
      outside = outside.filter((o) => !ready.includes(o));
      settle(rawMs);
      return ready.map((o) => o.run);
    },
    wakeAtMs() {
      const times = [...outside.map((o) => o.at), ...(pending && Number.isFinite(pending.at) ? [pending.at] : [])];
      return times.length ? Math.min(...times) : null;
    },
  };
}
