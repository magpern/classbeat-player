// The room window's 3D scene (docs/design/scene.md; the join is player/scene/render/join/): the plain screen's script (room.ts)
// draws first and announces every frame it draws; this script feeds the same frames to the scene, which shows under the text and
// the controls while it can (S10, S11). None with reduced motion, no WebGL or a failure: the plain screen, which stays mounted, shows.
import "../../../scene/render/layer/text.css";
import "../../../scene/render/join/scene-join.css";
import { mountScene } from "../../../scene/render/join/mount.ts";
import { onFrame } from "./room-frame-event.ts";

const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// After the plain screen in the document, so a query for its parts (`.gel`, `.intro`) finds the plain screen's first.
const root = document.getElementById("scene-join");
if (root) document.body.append(root);
const scene = mountScene({ reducedMotion, visible: () => !document.hidden });
onFrame(window, (frame) => scene.push(frame));
