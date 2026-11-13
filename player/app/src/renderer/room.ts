// The room screen's window: the plain 2D room screen (web/, docs/design/room-2d.md) drawn from what
// the shell sends, and the room screen's own controls over the score (room-band.ts). The screen is
// the web lane's; this page mounts it, passes it frames, and sends only the room's fixed commands
// through its preload (room-preload.ts).
import "../../../../web/src/main.ts";
import "./room-band.css";
import type { RoomCommand } from "../core/room/commands.ts";
import type { RoomFrame } from "../core/room/frame.ts";
import type { RemoteView } from "../core/room/remote.ts";
import { mountBand } from "./room-band.ts";

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
}

const api = (window as unknown as { room: RoomApi }).room;
const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const screen = window.classbeatRoom.mount(document.body, { reducedMotion });

// One display unless the system says the desktop spans more than one (the Window Management
// API's `isExtended`); where it cannot tell, the band behaves as on one display, which keeps Start
// in sight before the class.
const alone = (): boolean => (window.screen as Screen & { isExtended?: boolean }).isExtended !== true;

let pushed = false;
const draw = (frame: RoomFrame | null): void => {
  if (!frame) return;
  screen.update(frame);
  band.frame(frame);
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
  startRemote: () => void api.startRemote().then((v) => v && band.remote(v)),
}, { alone, reducedMotion });

// A push can arrive before the first answer; the older answer then does not draw over it.
api.onUpdate((frame) => {
  pushed = true;
  draw(frame);
});
void api.state().then((frame) => {
  if (!pushed) draw(frame);
});
api.onRemote((v) => band.remote(v));
void api.remoteState().then((v) => v && band.remote(v));
