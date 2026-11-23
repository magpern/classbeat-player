// The fragment shader's uniforms must fit WebGL2's guaranteed minimum of MAX_FRAGMENT_UNIFORM_VECTORS (224): a
// float, vec2, vec3 or vec4 takes one vector each (the worst case, for a driver that does not pack), so the beams'
// four floats are one vec4 each (#586's review). The count is read from the shader's own source.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAGMENT } from "../src/scene-shader.ts";

const MAX_FRAGMENT_UNIFORM_VECTORS = 224;
/** Left for the varying and the compiler's temporaries. */
const HEADROOM = 16;

function uniformVectors(source: string): { total: number; rows: string[] } {
  const rows: string[] = [];
  let total = 0;
  for (const m of source.matchAll(/^uniform\s+(?:float|int|vec[234])\s+(\w+)(?:\[(\d+)\])?\s*;/gm)) {
    const n = m[2] === undefined ? 1 : Number(m[2]);
    total += n;
    rows.push(`${m[1]} ${n}`);
  }
  return { total, rows };
}

test("the fragment shader's uniform vectors fit WebGL2's guaranteed minimum, with room to spare", () => {
  const { total, rows } = uniformVectors(FRAGMENT);
  assert.ok(rows.length > 20, "the declarations were found");
  assert.ok(total <= MAX_FRAGMENT_UNIFORM_VECTORS - HEADROOM, `${total} uniform vectors (${rows.join(", ")}) of ${MAX_FRAGMENT_UNIFORM_VECTORS}`);
});

test("the counter counts: every element of an array is a vector, whatever its type", () => {
  assert.equal(uniformVectors("uniform float a;\nuniform vec3 b[22];\nuniform vec4 c[3];").total, 26);
  assert.equal(uniformVectors("uniform float a[4];\nuniform int n;").total, 5);
  assert.equal(uniformVectors("uniform float a[4]; // not at the start of a line: uniform float b;").total, 4);
});
