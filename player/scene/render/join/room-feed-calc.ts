// The join's pure core: what the room window is sent (the open class, the clock view, the music link
// view) becomes what the scene is fed (`Feed`, the class clock's state) and what the text layer is told
// (`TextClass`). Nothing here reads a clock, the DOM or the network: the host passes the time since the
// frame arrived. Nothing about a rider is in the input, so nothing about one can be in the output (rule 1).
import type { Class } from "../../../../schema/generated/ts/class.d.ts";
import type { LinkInput, SceneClass } from "../../model/src/index.ts";
import { mixWordsAllowed } from "../../../../web/src/room/mix-words.ts";
import type { Feed } from "../src/loop.ts";
import type { Cadence, TextClass, TextInterval, TextLink, TextZone } from "../src/text-types.ts";

/** The fields of the shell's room frame the join reads (player/app/src/core/room/frame.ts); nothing else reaches it. */
export interface JoinFrame {
  readonly doc: Class | null;
  /** True exactly while the "Playlist not loaded" plate is due (RoomFrame.playlistNotLoaded). */
  readonly playlistNotLoaded: boolean;
  /** The mix class's link line (RoomFrame.mix), or null. */
  readonly mix?: { readonly text: string; readonly shape: "dot" | "circle" | "square" | "news" } | null;
  readonly view: {
    readonly status: "ready" | "running" | "paused" | "ended";
    readonly classMs: number;
    readonly songIndex: number | null;
  } | null;
  readonly link: {
    readonly mode: "following" | "manual";
    readonly state: LinkInput["state"];
    readonly held: boolean;
    readonly songIndex: number | null;
    /** The hand-over announcement's text while it lasts; only whether there is one is read, never the text. */
    readonly announcement: string | null;
    /** The music could be followed. */
    readonly available: boolean;
  } | null;
}

export interface DerivedClass {
  readonly scene: SceneClass;
  readonly text: TextClass;
}

/** The clock is carried forward at most this long past the last frame the shell sent (it sends one every 100 ms): a stalled shell holds the scene, it does not run it on. */
export const CARRY_MAX_MS = 300;

const rangeText = (r: readonly [number, number]): string => `${r[0]}–${r[1]}`;

function targetsOf(def: Class["zone_scale"][number]): string[] {
  const out: string[] = [];
  if (def.ftp_pct) out.push(`${rangeText(def.ftp_pct)}% FTP`);
  if (def.rpe) out.push(`RPE ${rangeText(def.rpe)}`);
  if (def.hrmax_pct) out.push(`${rangeText(def.hrmax_pct)}% HRmax`);
  return out;
}

function followingWords(doc: Class): string {
  if (doc.music.source === "spotify") return "Following Spotify";
  if (doc.music.source === "swedebeat") return "Following Swedebeat";
  return "Following the music";
}

const cadenceOf = (c: Class["intervals"][number]["cadence"]): Cadence | null => (c === undefined ? null : c === "beat" ? "beat" : { from: c.from, to: c.to });

const derived = new WeakMap<Class, DerivedClass | null>();

/** The class as the scene and its text layer read it, once per class file; null when the scene has nothing to draw (no songs: the plain screen shows it). */
export function deriveClass(doc: Class): DerivedClass | null {
  if (derived.has(doc)) return derived.get(doc) ?? null;
  const made = doc.songs.length === 0 ? null : build(doc);
  derived.set(doc, made);
  return made;
}

function build(doc: Class): DerivedClass {
  const zones: TextZone[] = doc.zone_scale.map((z) => ({ zone: z.zone, name: z.name, targets: targetsOf(z) }));
  const nameOf = (zone: number): string => zones.find((z) => z.zone === zone)?.name ?? "";
  const endMs = doc.class.length_ms;
  const scene: SceneClass = {
    endMs,
    intervals: doc.intervals.map((iv) => ({ startMs: iv.start_ms, zone: iv.zone })),
    songs: doc.songs.map((s) => ({
      lengthMs: s.length_ms,
      ...(s.bpm !== undefined ? { bpm: s.bpm } : {}),
      ...(s.beat_anchors && s.beat_anchors.quality !== "missing" ? { anchors: s.beat_anchors.anchors } : {}),
      ...(s.moments && s.moments.quality !== "missing" ? { moments: s.moments.items } : {}),
    })),
  };
  const intervals: TextInterval[] = doc.intervals.map((iv) => ({
    startMs: iv.start_ms, lengthMs: iv.length_ms, zone: iv.zone, name: nameOf(iv.zone), cue: iv.cue, cadence: cadenceOf(iv.cadence), position: iv.position ?? null,
    pattern: iv.pattern ? { positions: iv.pattern.positions, beats: iv.pattern.beats, startOn: iv.pattern.start_on ?? "interval_start" } : null,
  }));
  const text: TextClass = {
    title: doc.class.title, endMs, zones, intervals, following: followingWords(doc),
    songs: doc.songs.map((s) => ({
      title: s.title, artist: s.artist, startMs: s.start_ms, lengthMs: s.length_ms,
      ...(s.bpm !== undefined ? { bpm: s.bpm } : {}),
      ...(s.beat_anchors && s.beat_anchors.quality !== "missing" ? { anchors: s.beat_anchors.anchors } : {}),
      ...(s.moments && s.moments.quality !== "missing" ? { moments: s.moments.items } : {}),
    })),
    segments: (doc.segments ?? []).map((s) => ({ startMs: s.start_ms, name: s.name })),
  };
  return { scene, text };
}

/** Which song plays at `classMs`: the link's own index, else the clock's, else the last song that has started. */
function songIndexAt(doc: Class, frame: JoinFrame, classMs: number): number {
  const last = doc.songs.length - 1;
  const given = frame.link?.songIndex ?? frame.view?.songIndex ?? null;
  if (given !== null && given >= 0 && given <= last) return given;
  let at = 0;
  doc.songs.forEach((s, i) => { if (classMs >= s.start_ms) at = i; });
  return at;
}

/** The clock carried forward from the frame's arrival, only while it runs and the link is not paused. */
export function carriedMs(frame: JoinFrame, sinceMs: number): number {
  const base = frame.view?.classMs ?? 0;
  const running = frame.view?.status === "running" && frame.link?.state !== "Paused";
  return running ? base + Math.max(0, Math.min(sinceMs, CARRY_MAX_MS)) : base;
}

/** The link as the plate's words read it (web/src/room/link-text.ts): the mode matters, because "Manual" in following mode is the wait for the first lock, not the manual clock. */
function linkOf(link: JoinFrame["link"], started: boolean, mix: TextLink["mix"]): TextLink {
  if (link === null) return { state: "Manual", mode: "manual", started, ...(mix ? { mix } : {}) };
  const base = { mode: link.mode, started, ...(mix ? { mix } : {}) } as const;
  if (link.mode === "manual") return { ...base, state: "Manual", announcement: link.announcement !== null, available: link.available };
  return { ...base, state: link.state, held: link.held };
}

/** The feed for one scene frame, or null where the plain screen is the right one (no class, no songs). */
export function feedOf(frame: JoinFrame, sinceMs: number, reducedMotion: boolean): { feed: Feed; text: TextClass } | null {
  if (frame.doc === null || frame.view === null) return null;
  const made = deriveClass(frame.doc);
  if (made === null) return null;
  const classMs = Math.min(carriedMs(frame, sinceMs), frame.doc.class.length_ms);
  const songIndex = songIndexAt(frame.doc, frame, classMs);
  const song = frame.doc.songs.at(songIndex);
  const before = frame.view.status === "ready" && classMs <= 0;
  const finished = frame.view.status === "ended" || classMs >= frame.doc.class.length_ms;
  // The mix line only in the words the plain screen draws, and not once the class is over (web/src/room/adapter.ts).
  const given = frame.mix ?? null;
  const mix = given !== null && !finished && mixWordsAllowed(given) ? { text: given.text, shape: given.shape } : undefined;
  const link: TextLink = linkOf(frame.link, !before, mix);
  const feed: Feed = {
    cls: made.scene, classMs, songIndex, songPosMs: Math.max(0, classMs - (song?.start_ms ?? 0)), link, reducedMotion, playlistNotLoaded: frame.playlistNotLoaded && !finished,
    ...(before ? { stage: "before" as const } : {}),
  };
  return { feed, text: made.text };
}
