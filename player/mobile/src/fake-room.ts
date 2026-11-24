// The phone shell's stand-in for the desktop room preload (issue #627): a fixed frame from the web
// lane's fixtures, served to the room screen through the same `window.room` calls. No native code
// answers these calls and nothing leaves the page: every command answers with the same frame.
// Real data and the music link come in later issues (ADR 0011 sections 4 and 8).
import { FIXTURES } from "../../../web/src/fixtures/index.ts";
import type { BandRoutes } from "../../app/src/core/room/band-routes.ts";
import type { RoomFrame } from "../../app/src/core/room/frame.ts";
import { REMOTE_ABSENT } from "../../app/src/core/room/remote.ts";

/** The fixture the shell shows: the class standing before Start. */
export const FIXTURE = "before-start";

const CLOCK: BandRoutes = { start: "clock", pause: "clock", resume: "clock", next: "clock", previous: "clock" };

/** A web fixture as the shell would send it: every band route on the class clock, no music app to command. */
export function fakeFrame(name: string = FIXTURE): RoomFrame {
  const f = FIXTURES[name];
  if (!f) throw new Error(`no fixture ${name}`);
  return { ...f, link: f.link ? { ...f.link, available: false } : null, band: CLOCK } as unknown as RoomFrame;
}

/** The `window.room` calls the room screen makes (player/app/src/renderer/room.ts). */
export function fakeRoom(frame: RoomFrame = fakeFrame()) {
  const answer = (): Promise<RoomFrame> => Promise.resolve(frame);
  return {
    state: answer,
    onUpdate: (): void => {},
    start: answer,
    pause: answer,
    resume: answer,
    previous: answer,
    next: answer,
    forward: answer,
    back: answer,
    undo: answer,
    follow: answer,
    endClass: (): Promise<boolean> => Promise.resolve(false),
    remoteState: () => Promise.resolve(REMOTE_ABSENT),
    startRemote: () => Promise.resolve(REMOTE_ABSENT),
    onRemote: (): void => {},
  };
}

/** Installs the stand-in; the room screen reads `window.room` when its module first runs. */
export function installFakeRoom(): void {
  (window as unknown as { room: ReturnType<typeof fakeRoom> }).room = fakeRoom();
}
