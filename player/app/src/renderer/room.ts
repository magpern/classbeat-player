// The room screen's window: the plain 2D room screen (web/, docs/design/room-2d.md) drawn from what
// the shell sends, and the room screen's own controls over the score (room-band.ts). The screen is
// the web lane's; this page mounts it, passes it frames, and sends only the room's fixed commands
// through its preload (room-preload.ts). The page's one <audio> plays a Swedebeat mix as the shell
// cues it (room-mix.ts), and its reports go back through the preload.
import "../../../../web/src/main.ts";
import "./room-band.css";
import "./room-join.css";
import type { RoomCommand } from "../core/room/commands.ts";
import type { RoomFrame } from "../core/room/frame.ts";
import { REMOTE_ABSENT } from "../core/room/remote.ts";
import type { RemoteView } from "../core/room/remote.ts";
import type { ClockStatus } from "../core/room/band-view.ts";
import { mountBand } from "./room-band.ts";
import { mountMix } from "./room-mix.ts";
import { createMarks } from "./room-marks.ts";
import { mountSheet } from "./room-join.ts";

type Answer<T> = Promise<T | null>;

interface RoomApi {
  state(): Answer<RoomFrame>;
  onUpdate(cb: (frame: RoomFrame) => void): void;
  start(): Answer<RoomFrame>;
  pause(): Answer<RoomFrame>;
  resume(): Answer<RoomFrame>;
  previous(): Answer<RoomFrame>;
  next(): Answer<RoomFrame>;
  forward(): Answer<RoomFrame>;
  back(): Answer<RoomFrame>;
  undo(): Answer<RoomFrame>;
  follow(): Answer<RoomFrame>;
  endClass(): Answer<boolean>;
  remoteState(): Answer<RemoteView>;
  startRemote(): Answer<RemoteView>;
  onRemote(cb: (slot: RemoteView) => void): void;
  onMix(cb: (cue: unknown) => void): void;
  mixReport(seq: number, positionMs: number, playing: boolean, failed: boolean, durationMs: number | null): Answer<true>;
}

const api = (window as unknown as { room: RoomApi }).room;
const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const screen = window.classbeatRoom.mount(document.body, { reducedMotion });

// One display unless the system says the desktop spans more than one (the Window Management
// API's `isExtended`); where it cannot tell, the band behaves as on one display, which keeps Start
// in sight before the class.
const alone = (): boolean => (window.screen as Screen & { isExtended?: boolean }).isExtended !== true;

let pushed = false;
// The join sheet (room-join.ts) reads the clock's state and the slot; the band, whether it is open.
let status: ClockStatus | null = null;
let slot: RemoteView = REMOTE_ABSENT;
// The room screen's one mark ledger decides the frame of every visible change of the band, the sheet and the plate (room-marks.ts).
const marks = createMarks((draw) => screen.requestMark(draw));
const sheet = mountSheet(document.body, () => band.redraw(), marks);
const draw = (frame: RoomFrame | null): void => {
  if (!frame) return;
  screen.update(frame);
  status = (frame.view?.status as ClockStatus | undefined) ?? null;
  sheet.facts(status, slot);
  band.frame(frame);
};
/** A new slot (a new code too) redraws the sheet and the band in the same frame. */
const remote = (v: RemoteView | null): void => {
  if (!v) return;
  slot = v;
  sheet.facts(status, slot);
  band.remote(v);
};

/** Each command goes to its one fixed call; the answer is the frame as it is now. */
function send(c: RoomCommand): void {
  const calls: Record<Exclude<RoomCommand["type"], "jump">, () => Answer<RoomFrame>> = {
    start: api.start,
    pause: api.pause,
    resume: api.resume,
    previous: api.previous,
    next: api.next,
    undo: api.undo,
    follow: api.follow,
  };
  const call = c.type === "jump" ? (c.deltaMs > 0 ? api.forward : api.back) : calls[c.type];
  void call().then(draw);
}

const band = mountBand(document.body, {
  command: send,
  endClass: () => void api.endClass(),
  startRemote: () => void api.startRemote().then(remote),
}, { alone, marks, sheet });

// A push can arrive before the first answer; the older answer then does not draw over it.
api.onUpdate((frame) => {
  pushed = true;
  draw(frame);
});
void api.state().then((frame) => {
  if (!pushed) draw(frame);
});
api.onRemote(remote);
void api.remoteState().then(remote);
// The mix's <audio>: cued by the shell only, and its reports go back through the one fixed call.
const mix = mountMix(document.getElementById("mix") as HTMLAudioElement, (seq, positionMs, playing, failed, durationMs) => void api.mixReport(seq, positionMs, playing, failed, durationMs));
api.onMix((cue) => mix.cue(cue));
