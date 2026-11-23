// When the plain screen shows what its snapshots say (docs/design/room-2d.md, "The flash budget on the
// plain screen"; scene.md, "The flash budget", text rule 2). Every text and colour change falls on a frame
// mark; any two marks are at least 500 ms apart, so at most two in any second. The placement is the pure
// scheduler's (flash-marks.ts, merged in #590): the interval change is a fixed frame, the count's next
// switch beat is one, and an action, a switch beat or a tick is placed by P2 against them and against the
// mark last shown. Pure: times are passed in; the screen owns the timer.
import { MARK_GAP_MS, frameAt, placeMarks } from "../../../player/scene/model/src/flash-marks.ts";
import type { FixedFrame, Want } from "../../../player/scene/model/src/flash-marks.ts";
import { awayFromFixed, switchFrame } from "./mark-frames.ts";
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
  /**
   * The frame the change is now planned to be drawn in, on the screen's clock (`RoomClock.now`). It can move after the
   * request (to the draw of the screen's own mark it shares, or 500 ms after a draw that was made first), so read it when
   * it is needed.
   */
  readonly atMs: number;
  /** Gives the mark up (the change is no longer wanted): works until the moment `run` is called. */
  cancel(): void;
}
interface Outside {
  at: number;
  readonly run: () => void;
  /** False once it has been drawn or given up. */
  live: boolean;
  /** It rides a fixed frame (drawn with that frame's own snapshot): it is not a mark of its own, and no mark gives way to it. */
  rides: boolean;
  /** The fixed frame it rides; once that frame is gone (a pause, a seek) it is an ordinary mark that every placement keeps away from. */
  frame: number | null;
}

export interface MarkGate {
  /**
   * The one ledger of the whole room window. An outside change (the band, the join sheet, a plate) asks for a mark at
   * `nowMs`: it is placed by the same `placeMarks` call as the screen's own marks, as an action, against the fixed frames
   * of the last offer (the interval's end, the count's switch beat), the mark last drawn, and every mark already reserved
   * or pending, so no two marks of either kind are closer than 500 ms. It is at most 500 ms late (C10, plus the frames of
   * the clock's own step), or 1 s when it joins a fixed frame: it is then drawn in the same draw as that frame's own snapshot
   * and never moves the fixed frame (P1). Any draw of the screen's own that comes first takes every waiting outside change
   * with it (one change). The frame is returned at once; `dueOutside` hands back `run` when it has come. A request made
   * from inside a draw (`nowMs` equal to the draw's) is part of that draw.
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
  /**
   * Every mark the scheduler must keep away from, on the grid: the last draw, the marks reserved for outside changes, the pending
   * mark. The screen's own marks ignore a change that rides a fixed frame (it is drawn with that frame, which never gives way);
   * another outside change keeps its distance from it.
   */
  const placed = (forOutside: boolean): number[] => [
    ...(Number.isFinite(lastMark) ? [grid(lastMark)] : []),
    ...outside.filter((o) => forOutside || !o.rides).map((o) => grid(o.at)),
    // A pending tick gives way to an outside change (P2: an action is placed first and the ticks not yet shown are placed again).
    ...(pending && Number.isFinite(pending.at) && (!forOutside || pending.kind === "action" || pending.kind === "change") ? [grid(pending.at)] : []),
  ];
  /**
   * A draw at the real time `nowMs`. One made by the screen takes every outside change that is waiting with it: that draw is
   * itself placed 500 ms from every mark, so they are one change with it. One made for an outside change takes those in its
   * frame; those still ahead and under 500 ms away give way to the real gap.
   */
  function settle(nowMs: number, byScreen: boolean): void {
    lastMark = Math.max(lastMark, nowMs);
    for (const o of outside) {
      if (o.at <= nowMs) continue;
      if (o.rides && !byScreen) continue;
      if (byScreen || sameFrame(o.at, nowMs)) o.at = nowMs;
      else if (o.at - nowMs < MARK_GAP_MS) o.at = grid(nowMs + MARK_GAP_MS);
    }
  }
  /** Fixed frames the offers have announced and no draw has taken yet: a change asked for just before one is still due to ride it. */
  let announced: number[] = [];
  const fixedFrames = (ctx: MarkContext, nowMs: number): FixedFrame[] =>
    [ctx.changeAtMs, switchFrame(ctx), ...announced]
      .filter((t): t is number => t !== null && t >= nowMs - NATURAL_MS && t - nowMs < LOOKAHEAD_MS)
      .map((t) => ({ atMs: frameAt(t, frameMs), change: true, changes: [t], drops: [] }));

  /** Draws now. The mark is the time of the draw itself, never a rounded one: the gap to the next is kept from it. */
  const show = (nowMs: number): RoomModel | null => {
    shown = latest;
    pending = null;
    settle(nowMs, true);
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
    // The switch beat's own snapshot is the fixed frame it announced, whichever side of it it falls on: it takes that frame.
    const own = kind === "switch" ? fixed.find((f) => Math.abs(f.atMs - nowMs) <= NATURAL_MS) : undefined;
    const want: Want = { kind, atMs: own?.atMs ?? since, periodMs: kind === "tick" ? (model.count?.beatMs ?? TICK_MS) : undefined };
    // The scheduler sees the grid only: the last draw, rounded up, is a mark at least as late as it really was.
    let [put] = placeMarks(fixed, [want], frameMs, placed(false));
    // A tick or switch beat in the very frame of the mark just drawn joins it, but it cannot show there: it is placed again, 500 ms on, among
    // the fixed frames and the marks, so that nothing is put within 500 ms of a fixed frame by that join.
    if (kind !== "action" && put?.how === "joined" && !fixed.some((f) => f.atMs === put?.atMs) && !own && Number.isFinite(lastMark)) {
      [put] = placeMarks(fixed, [{ ...want, atMs: Math.max(want.atMs, grid(lastMark + MARK_GAP_MS)) }], frameMs, placed(false));
    }
    if (!put || put.atMs === null) return null;
    // A want that joined a fixed frame still ahead shows in that frame, with the snapshot of the frame itself (the change
    // frame, the switch beat): it waits for it, at most NATURAL_MS past that frame, and is placed again by every snapshot.
    if (put.how === "joined" && put.atMs > rawMs && !own && fixed.some((f) => f.atMs === put.atMs)) return Math.max(put.atMs + NATURAL_MS, lastMark + MARK_GAP_MS);
    const raw = Math.max(put.atMs, lastMark + MARK_GAP_MS);
    // An action keeps the spec's earlier rule (500 ms after the last mark); ticks and switch beats keep off the fixed frames.
    if (kind === "action") return raw;
    const away = awayFromFixed(fixed, raw, grid);
    // Too close ahead of a fixed frame it waits for that frame's snapshot, as above; never earlier than the real gap allows.
    return away.rides !== null ? Math.max(away.rides + NATURAL_MS, lastMark + MARK_GAP_MS) : away.at;
  }

  return {
    offer(model, rawMs, ctx) {
      // Every time the scheduler is given is on the frame grid: a clock that is off the grid would round a placement past
      // 500 ms late and send an action to a frame mark far ahead. A draw is never before its placed frame, on the real
      // clock, and is recorded at the real time it was made.
      const nowMs = frameAt(rawMs, frameMs);
      const before = prev;
      prev = { model, atMs: nowMs, ctx };
      // A frame the last offer announced that has now come, and no draw has taken, is still due for NATURAL_MS (its snapshot is on its way).
      announced = announced.filter((a) => a >= rawMs - NATURAL_MS);
      if (before) for (const t of [before.ctx.changeAtMs, switchFrame(before.ctx)]) if (t !== null && t <= rawMs && t >= rawMs - NATURAL_MS && lastMark < t - frameMs && !announced.some((a) => Math.abs(a - t) < 2 * frameMs)) announced.push(t);
      // A change riding a fixed frame the clock no longer has (a pause or a seek took it away) is an ordinary mark from now on:
      // it is drawn as early as the real gap allows (not at the wait bound of a frame that will not come), and every placement
      // keeps 500 ms from it, a tick placed while it rode (ignoring it) included.
      const kept = fixedFrames(ctx, rawMs);
      const orphans = outside.filter((o) => o.rides && o.frame !== null && !kept.some((f) => Math.abs(f.atMs - frameAt(o.frame as number, frameMs)) < 3 * frameMs));
      if (orphans.length > 0) {
        const early = Math.max(grid(rawMs), grid(lastMark + MARK_GAP_MS));
        const free = !outside.some((o) => !orphans.includes(o) && Math.abs(o.at - early) < MARK_GAP_MS - 1e-6);
        for (const o of orphans) {
          o.rides = false;
          if (free && early < o.at) o.at = early;
        }
      }
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
      const fixed = fixedFrames(prev?.ctx ?? { changeAtMs: null, switchAtMs: null }, nowMs);
      let [put] = placeMarks(fixed, [{ kind: "action", atMs: nowMs }], frameMs, placed(true));
      // In the frame of the mark just drawn it joins that mark but cannot show there: placed again 500 ms on, among the fixed frames.
      if (put?.how === "joined" && !fixed.some((f) => f.atMs === put?.atMs) && Number.isFinite(lastMark)) {
        [put] = placeMarks(fixed, [{ kind: "action", atMs: Math.max(nowMs, grid(lastMark + MARK_GAP_MS)) }], frameMs, placed(true));
      }
      // From inside a draw (the time of that draw) it is part of it; else never closer than 500 ms to the real last draw.
      let rides = false;
      let frame: number | null = null;
      let at = rawMs === lastMark ? rawMs : Math.max(put?.atMs ?? nowMs, grid(lastMark + MARK_GAP_MS), rawMs);
      const onFixed = (t: number): boolean => fixed.some((f) => f.atMs === t);
      const putAt = put?.atMs ?? null;
      // A fixed frame whose snapshot is due this very moment and has not been drawn yet: the change rides it, whatever its own place.
      const due = fixed.find((f) => f.atMs <= nowMs && f.atMs >= nowMs - NATURAL_MS && lastMark < f.atMs - frameMs);
      if (due && rawMs !== lastMark) {
        at = Math.max(due.atMs + NATURAL_MS, rawMs, grid(lastMark + MARK_GAP_MS));
        rides = true;
        frame = due.atMs;
      } else if (put?.how === "joined" && putAt !== null && putAt > rawMs && onFixed(putAt)) {
        // On a fixed frame: drawn in the draw of that frame's own snapshot (which takes it), at the latest NATURAL_MS after it.
        at = Math.max(putAt + NATURAL_MS, grid(lastMark + MARK_GAP_MS));
        rides = true;
        frame = putAt;
      } else if (at - rawMs > MARK_GAP_MS + frameMs) {
        // Over 500 ms late (a mark of the screen's own, pending or reserved, stands in the way): it shares the nearest mark
        // already placed ahead of it, a frame that is drawn anyway, as P2 does with a fixed frame.
        const waiting = [...outside.filter((o) => o.live && !o.rides).map((o) => o.at), ...(pending && Number.isFinite(pending.at) ? [pending.at] : [])];
        const ahead = [...fixed.map((f) => f.atMs), ...waiting].filter((t) => t >= rawMs && t - rawMs <= LOOKAHEAD_MS);
        const sooner = ahead.filter((t) => t < at - frameMs);
        if (sooner.length > 0) {
          const t = Math.min(...sooner);
          rides = onFixed(t);
          if (rides) frame = t;
          at = rides ? Math.max(t + NATURAL_MS, grid(lastMark + MARK_GAP_MS)) : t;
        }
      }
      if (!rides && rawMs !== lastMark) {
        const away = awayFromFixed(fixed, at, grid);
        if (away.rides !== null) {
          at = Math.max(away.rides + NATURAL_MS, grid(lastMark + MARK_GAP_MS));
          rides = true;
          frame = away.rides;
        } else at = away.at;
      }
      // Changes riding the same fixed frame are one draw: they keep one time, whatever the frame quantisation of each offer.
      const sibling = rides ? outside.find((o) => o.rides && Math.abs(o.at - at) < 2 * frameMs) : undefined;
      if (sibling) at = sibling.at;
      const entry: Outside = { at, run, live: true, rides, frame };
      outside.push(entry);
      return {
        get atMs() {
          return entry.at;
        },
        cancel: () => {
          entry.live = false;
          outside = outside.filter((o) => o !== entry);
        },
      };
    },
    dueOutside(rawMs) {
      const ready = outside.filter((o) => o.at <= rawMs).sort((a, b) => a.at - b.at);
      if (ready.length === 0) return [];
      outside = outside.filter((o) => !ready.includes(o));
      settle(rawMs, false);
      // Each is drawn only if it is still wanted when its turn comes (an earlier draw of the batch may give it up).
      return ready.map((o) => () => {
        if (!o.live) return;
        o.live = false;
        o.run();
      });
    },
    wakeAtMs() {
      const times = [...outside.map((o) => o.at), ...(pending && Number.isFinite(pending.at) ? [pending.at] : [])];
      return times.length ? Math.min(...times) : null;
    },
  };
}
