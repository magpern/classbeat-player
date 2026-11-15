// The scene renderer's public surface. The shell mounts `SceneRenderer` over its room window and
// gives it a `Feed` (the class clock's state); `SceneRig` and `RigLoop` are the parts a test can
// run with no WebGL.
import "../guard/render-callbacks.ts"; // first: it captures three's render-callback defaults before any scene is built
export * from "./aim.ts";
export * from "./bursts.ts";
export * from "./light-calc.ts";
export * from "./host.ts";
export * from "./loop.ts";
export * from "./renderer.ts";
export * from "./rig.ts";
export * from "./tokens.ts";
