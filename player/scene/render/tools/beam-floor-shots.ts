// S5b in headless Chrome (tools/beam-floor.ts says how a beam is measured): the house look before the start, read from
// the canvas as shown, at every room size and every quality level (render scale 0.75, 0.5, 0.35). Each of the two lit
// beams must keep its core at the floor along its whole visible axis. The self-test renders the look without the floor
// (`floor=off`, the old 6 % beams) and the check must fail it, so a check that passes everything is caught.
import assert from "node:assert/strict";
import { BEAM_BASE_RADIUS } from "../src/scene-shader.ts";
import { FLOOR_SOURCE, MIN_ABOVE_HAZE, MIN_CORE, floorFaults } from "./beam-floor.ts";
import type { Measured } from "./beam-floor.ts";
import type { Open } from "./text-shots.ts";

// 16:9, 16:10, 4:3 and 5:4. A beam whose whole axis is outside the frame is skipped (and listed), any other must pass.
const SIZES = [[1920, 1080], [1366, 768], [1280, 800], [854, 480], [1024, 768], [800, 600], [1280, 1024]] as const;
const QUALITIES = ["High", "Medium", "Low"] as const;

/** The two beams of the page's before-the-start state, measured on the canvas at its drawing-buffer size. */
async function measureHouse(open: Open, w: number, h: number, query: string): Promise<{ beams: Measured[]; width: number; height: number }> {
  const { page, problems } = await open(w, h, `&stage=before${query}`);
  await page.evaluate("window.__scene.advance(0, 4000, 60)");
  const out = await page.evaluate(`(() => {
    const scene = window.__scene;
    const state = scene.rigState();
    const src = document.getElementById("scene");
    const c = document.createElement("canvas");
    c.width = state.width; c.height = state.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const hex = scene.tokens.current;
    const rgb = [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
    const channel = rgb.indexOf(Math.max(...rgb));
    return { beams: ${FLOOR_SOURCE}.measure(px, c.width, c.height, state.beams, state.tanH, channel, ${BEAM_BASE_RADIUS}), width: c.width, height: c.height, lit: state.beams.length };
  })()`) as { beams: Measured[]; width: number; height: number; lit: number };
  assert.deepEqual(problems, [], `before the start at ${w}x${h}: ${problems.join("; ")}`);
  assert.equal(out.lit, 2, "the house look has two lit beams");
  await page.close();
  return out;
}

export async function beamFloor(open: Open): Promise<void> {
  const rows: string[] = [];
  for (const [w, h] of SIZES) for (const q of QUALITIES) {
    const m = await measureHouse(open, w, h, `&q=${q}`);
    assert.ok(m.beams.some((b) => b.visible), `S5b: no house-look beam is on screen at ${w}x${h}`);
    for (const [i, beam] of m.beams.entries()) {
      if (!beam.visible) { rows.push(`${w}x${h} ${q} beam ${i}: whole axis outside the frame, skipped`); continue; }
      assert.deepEqual(floorFaults(beam), [], `S5b: beam ${i} of the house look at ${w}x${h}, ${q} (canvas ${m.width}x${m.height}) is under the floor (${JSON.stringify(beam)})`);
      rows.push(`${w}x${h} ${q} beam ${i}: ${beam.n} samples, core >= ${beam.minY.toFixed(5)}, >= ${beam.minAbove} codes over the haze`);
    }
  }
  // The check must fail a render under the floor: the same look with the floor off.
  const under = await measureHouse(open, 1366, 768, "&floor=off");
  for (const [i, beam] of under.beams.entries()) {
    assert.ok(floorFaults(beam).length > 0, `S5b self-test: beam ${i} without the floor passed (${JSON.stringify(beam)}): the check cannot see a beam under ${MIN_CORE} / ${MIN_ABOVE_HAZE} codes`);
  }
  console.log(`S5b: ${rows.length} beams measured (floor ${MIN_CORE}, ${MIN_ABOVE_HAZE} codes); the unfloored look fails: ${JSON.stringify(under.beams)}`);
  console.log(rows.join("\n"));
}
