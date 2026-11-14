# 0009. The room's 3D scene is web 3D

Status: Accepted (2026-11-14, owner: "ok, go web 3d")

## Context

Plan section 9 left the technology for the room's 3D scene open until spike 2. Godot 4 was the
leading candidate, and web 3D was the alternative. Spike 2 (`player/scene/spike/`) built the same rough
light-show scene three ways and ran them on the owner's Mac (Apple Silicon, one screen, as in the
studio) on 2026-11-14:

| Variant | What the owner saw |
|---|---|
| `web` (three.js in the shell's own window, HTML text over it) | Runs; the controls overlay and keyboard work; the scene itself looked plain ("just a pulsing star") |
| `godot-native` (Godot 4.7.2 as its own program, started by the shell) | Slightly smoother than `web`. **The keyboard and the controls overlay did not reach it**: the shell's transparent overlay window ended up behind Godot's full-screen window, so it could only be reached by switching windows. Pressing `K` there ended Godot, and the recovery to the plain 2D screen worked |
| `godot-web` (Godot's web export in the shell's window) | Runs; no advantage seen over `web` |

The Mac builds of Godot were exported on Linux from the pinned editor and templates. The plain look
of the test scene says nothing about either technology: it is a test scene. The direction for the
real scene is set separately (`docs/design/scene.md`, #471).

## Decision

The room's 3D scene is drawn with **web 3D (three.js) inside the shell's own room window**. Its
text is ordinary HTML over the canvas, as in the `web` variant. There is one window, one runtime and
one build. The scene is a replaceable part behind the same seam as before: the shell gives it the
class clock state and it draws. The plain 2D screen remains the fallback.

**Re-check (measurable):** on a studio-class computer, the PL6 scene at its default quality level
keeps a median of at least 58 frames per second over a full class, and no second has fewer than 30.
The frame-rate log the scene writes is the evidence. If it misses this target at the lowest quality
level, the Orchestrator reopens this decision with Godot native as the alternative. Its window and
focus problem on macOS must then be solved first.

## Alternatives

- **Godot native, started by the shell.** Slightly smoother on the Mac and a real engine. But it is a second program
  to bundle, sign, update and keep in step with the class clock on three systems. On macOS its
  full-screen window took the keyboard and the overlay away from the shell. That breaks the
  one-screen studio layout, in which the controls are an overlay on that same screen.
- **Godot's web export.** It runs in the shell's window like `web`, but with Godot's simpler web renderer, a
  larger download and two toolchains, and with no gain seen.
- **Babylon.js instead of three.js.** It would be just as possible. three.js is what the spike proved, and
  switching later stays possible behind the seam.

## Consequences

- PL6 builds the scene in `player/scene/` with three.js, against `docs/design/scene.md`.
- The spike harness (`player/scene/spike/`) and its Godot project are throwaway, as planned
  (plan section 9). They are deleted once PL6's first scene pull request merges.
- No Godot toolchain is needed in CI or on the owner's machines.
- The phone and tablet player (ADR 0008) can reuse the same scene code where the device allows it.
