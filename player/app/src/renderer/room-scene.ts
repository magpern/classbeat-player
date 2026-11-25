// The room window's 3D scene (docs/design/scene.md; the join is player/scene/render/join/): the plain screen's script (room.ts)
// draws first and announces every frame it draws; this script feeds the same frames to the scene, which shows under the text and
// the controls while it can (S10, S11). None with reduced motion, no WebGL or a failure: the plain screen, which stays mounted, shows.
import "../../../scene/render/layer/text.css";
import "../../../scene/render/join/scene-join.css";
import { mountScene } from "../../../scene/render/join/mount.ts";
import type { RoomFrame } from "../core/room/frame.ts";
import { onFrame } from "./room-frame-event.ts";

// The scene draws what the shell feeds the room window through its preload (`window.room`); a page without that bridge has no class to draw,
// so it builds no WebGL context at all. Nor does a page opened with `?scene=off` (a window that only looks at the plain screen or asks for audio,
// as the mix e2e test's stray window does: a WebGL context costs seconds there), nor a window nobody can see (hidden, minimised): it is built
// when the window first shows.
if ((window as unknown as { room?: unknown }).room !== undefined && !location.search.slice(1).split("&").includes("scene=off")) {
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let scene: ReturnType<typeof mountScene> | null = null;
  let latest: RoomFrame | null = null;
  const start = (): void => {
    if (scene !== null || document.hidden) return;
    // After the plain screen in the document, so a query for its parts (`.gel`, `.intro`) finds the plain screen's first.
    const root = document.getElementById("scene-join");
    if (root) document.body.append(root);
    scene = mountScene({ reducedMotion, visible: () => !document.hidden });
    if (latest !== null) scene.push(latest);
  };
  onFrame(window, (frame) => {
    latest = frame;
    scene?.push(frame);
  });
  document.addEventListener("visibilitychange", start);
  start();
}
