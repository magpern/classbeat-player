// companion_state from the presenter's snapshot (ADR 0005 section 4): only what the teleprompter
// shows. Pure. No rider field of any kind, no token or code, no account or device name, and no
// free text but the class's own cue, zone names and song titles; announcements cross as a kind.
import type { Class } from "../../../../../schema/generated/ts/class.d.ts";
import type { Announcement, CompanionState, ComingInterval, LinkState, NextSong, Zone } from "../../../../../schema/generated/ts/live-companion-state.d.ts";
import type { LinkStateName, Announcement as LinkAnnouncement } from "../link/types.ts";
import { HANDOVER_TEXT } from "../link/while-following.ts";
import type { PlayerState } from "../player-state.ts";
import { snapshotOf } from "../player-state.ts";
import { allowedActions } from "./allowed.ts";

const DAY_MS = 86_400_000;
const MAX_CUE = 120;
const MAX_ZONE_NAME = 80;
const MAX_SONG_TEXT = 200;
export const MAX_NEXT_INTERVALS = 3;

const STATE_NAMES: Readonly<Record<LinkStateName, LinkState["state"]>> = {
  Locked: "locked",
  Paused: "paused",
  Coasting: "coasting",
  "Off the list": "off_the_list",
  Ambiguous: "ambiguous",
  Manual: "manual",
};

/** At most `n` characters (code points, as the schema counts them). */
const clip = (s: string, n: number): string => Array.from(s).slice(0, n).join("");
const ms = (v: number): number => Math.min(DAY_MS, Math.max(0, Math.round(v)));

function zoneOf(doc: Class, zone: number): Zone {
  const def = doc.zone_scale.find((z) => z.zone === zone);
  const name = def ? clip(def.name, MAX_ZONE_NAME) : "";
  return { number: zone, name: name.length > 0 ? name : `Zone ${zone}` };
}

function nextSongOf(doc: Class, manualOnly: boolean, classMs: number): NextSong | null {
  if (manualOnly) return null;
  const song = doc.songs.find((s) => s.start_ms > classMs);
  if (song === undefined) return null;
  const title = clip(song.title, MAX_SONG_TEXT);
  const artist = clip(song.artist, MAX_SONG_TEXT);
  return title.length > 0 && artist.length > 0 ? { atMs: ms(song.start_ms), title, artist } : null;
}

/** The player's fixed announcement as a kind and a number; the phone writes the words. */
export function announcementOf(a: LinkAnnouncement | null, now: number): Announcement | null {
  if (a === null || now > a.until) return null;
  if (a.text === HANDOVER_TEXT) return { kind: "following_stopped", seconds: null };
  const seconds = Math.min(86_400, Math.max(1, Math.round(Math.abs(a.deltaMs) / 1000)));
  return { kind: a.deltaMs < 0 ? "resynced_back" : "resynced_forward", seconds };
}

/**
 * The state message for run `run` and number `seq`, or null while no class is open (there is
 * nothing to show). `canSend` is the presenter's: the same routing decides `allowed`.
 */
export function companionStateOf(s: PlayerState, now: number, canSend: boolean, run: string, seq: number): CompanionState | null {
  const l = s.loaded;
  const snap = snapshotOf(s, now, canSend);
  const { doc, view, link } = snap;
  if (l === null || doc === null || view === null || link === null) return null;
  const iv = doc.intervals[view.intervalIndex];
  const next: ComingInterval[] = doc.intervals.slice(view.intervalIndex + 1, view.intervalIndex + 1 + MAX_NEXT_INTERVALS).map((c) => ({
    startMs: ms(c.start_ms),
    lengthMs: Math.max(1, ms(c.length_ms)),
    zone: zoneOf(doc, c.zone),
    cue: clip(c.cue, MAX_CUE),
  }));
  const holding = link.held && view.status !== "ended";
  const status: CompanionState["status"] = view.status === "ended" ? "ended" : holding ? "holding" : view.status === "ready" ? "not_started" : view.status;
  return {
    v: 1,
    type: "companion_state",
    run,
    seq,
    status,
    classMs: ms(view.classMs),
    lengthMs: Math.max(1, ms(view.lengthMs)),
    classRemainingMs: ms(link.classRemainingMs),
    now: {
      index: view.intervalIndex,
      zone: zoneOf(doc, iv.zone),
      cue: clip(iv.cue, MAX_CUE),
      remainingMs: ms(holding && link.holdRemainingMs !== null ? link.holdRemainingMs : view.intervalRemainingMs),
    },
    next: next as CompanionState["next"],
    nextSong: nextSongOf(doc, l.plan.manualOnly, view.classMs),
    link: {
      mode: link.mode,
      state: STATE_NAMES[link.state],
      canUndo: link.canUndo,
      announcement: announcementOf(l.link.announce, now),
    },
    allowed: allowedActions(s, now, canSend) as CompanionState["allowed"],
  };
}
