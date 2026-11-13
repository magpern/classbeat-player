// The room screen's window (docs/design/class-list.md, "Where it sits"): opened when a class opens,
// on the display `placeRoom` picks (with one display full screen above the presenter), sent a
// RoomFrame with every snapshot, and closed with the class (`roomCloses`, core/room/lifecycle.ts) or with
// the presenter. "Show the room screen" (menu.ts) opens it again through the same `open`.
// It has the presenter's hardening (web-preferences.ts, hardening.ts), its own page and policy
// (room.html, ROOM_CSP) and its own preload, which reads frames and the phone remote's slot and
// sends only the room's fixed controls.
import { BrowserWindow, screen } from "electron";
import { CH_ROOM_REMOTE_UPDATE, CH_ROOM_UPDATE } from "../../core/channels.ts";
import type { RoomTrusted } from "../../core/ipc-policy.ts";
import { roomFrameOf } from "../../core/room/frame.ts";
import { placeRoom } from "../../core/room/placement.ts";
import { remoteViewOf } from "../../core/room/remote.ts";
import type { RemoteView } from "../../core/room/remote.ts";
import type { Snapshot } from "../../core/snapshot.ts";
import { secureWebPreferences } from "../web-preferences.ts";

export interface RoomWindow {
  /** Opens the window, or leaves the open one where it is (it then draws the new class). */
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Sends the window what to draw; nothing when it is not open. */
  send(s: Snapshot): void;
  /** Sends the window the phone remote's slot, as remoteViewOf leaves it; nothing when it is not open. */
  sendRemote(v: RemoteView): void;
  trusted(): RoomTrusted;
}

export interface RoomWindowDeps {
  readonly file: string;
  readonly url: string;
  readonly preload: string;
  /** The presenter's window, beside which the room goes. */
  readonly presenter: () => BrowserWindow | null;
}

// With one display the room window covers the presenter: it takes the keyboard only when the
// application already has it, so a class opened while another application has the focus (a file
// dropped from it) leaves that focus where it is.
function showAlone(w: BrowserWindow): void {
  if (BrowserWindow.getFocusedWindow() !== null) w.show();
  else w.showInactive();
  w.moveTop();
}

export function createRoomWindow(d: RoomWindowDeps): RoomWindow {
  let win: BrowserWindow | null = null;
  // The display the room window was last on: the next class opens there while it is connected.
  let lastDisplay: number | null = null;
  const live = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null);
  const push = (channel: string, message: unknown): void => {
    const wc = live()?.webContents;
    if (wc && !wc.isDestroyed() && !wc.isCrashed()) wc.send(channel, message);
  };

  const placement = () => {
    const p = d.presenter();
    const presenterDisplay = p && !p.isDestroyed() ? screen.getDisplayMatching(p.getBounds()).id : null;
    const displays = screen.getAllDisplays().map((x) => ({ id: x.id, bounds: x.bounds, workArea: x.workArea }));
    return placeRoom(displays, presenterDisplay, lastDisplay);
  };

  return {
    open() {
      if (live()) return;
      const place = placement();
      const w = new BrowserWindow({
        ...(place ? place.bounds : {}),
        title: "Room screen",
        show: false,
        backgroundColor: "#000000",
        // The room screen keeps time on its own between snapshots (the score's motion): never
        // throttled while the presenter has the focus or covers part of it.
        webPreferences: { ...secureWebPreferences(d.preload), backgroundThrottling: false },
      });
      win = w;
      w.removeMenu();
      w.on("close", () => {
        if (!w.isDestroyed()) lastDisplay = screen.getDisplayMatching(w.getBounds()).id;
      });
      w.on("closed", () => {
        if (win === w) win = null;
      });
      w.once("ready-to-show", () => {
        // With a second display the presenter keeps the keyboard and its controls (plan, section 9);
        // with one, the room window and its own controls are the class (room-2d.md).
        if (place?.alone) showAlone(w);
        else w.showInactive();
        if (place?.fullScreen) w.setFullScreen(true);
      });
      void w.loadFile(d.file);
    },
    close() {
      live()?.close();
    },
    isOpen: () => live() !== null,
    send: (s) => push(CH_ROOM_UPDATE, roomFrameOf(s)),
    sendRemote: (v) => push(CH_ROOM_REMOTE_UPDATE, remoteViewOf(v)),
    trusted: () => ({ roomId: live()?.webContents.id ?? null, roomUrl: d.url }),
  };
}
