// Guard (issue #871): the shipped phone app draws only the class the instructor opened. No bundle
// takes in the fake room (src/fake-room.ts) or the screens' fixtures, which stay for the harness and
// the tests; no bundle carries a schema checker that compiles at run time; and the class list's bundle
// does not carry the class-format reader. The build is made in memory with the options build.mjs ships with.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, type Metafile } from "esbuild";
import { buildOptions } from "../build-config.mjs";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");

async function inputsByOutput(): Promise<Map<string, string[]>> {
  const r = await build({ ...buildOptions("unused"), absWorkingDir: MOBILE, write: false, metafile: true, logLevel: "silent" });
  const outputs = (r.metafile as Metafile).outputs;
  return new Map(Object.entries(outputs).map(([out, o]) => [out.split("/").at(-1)!, Object.keys(o.inputs)]));
}

const isFixture = (path: string): boolean => path.endsWith("src/fake-room.ts") || path.includes("web/src/fixtures/");

test("no bundle of the phone app holds the fake room or a fixture", async () => {
  const built = await inputsByOutput();
  assert.ok(built.has("main.js") && built.has("instructor.js"), "the room screen and the class list were built");
  // The room screen's bundle does hold the room screen and the shared clock, so the scan sees real inputs.
  assert.ok(built.get("main.js")!.some((p) => p.endsWith("app/src/renderer/room.ts")));
  for (const [out, inputs] of built) assert.deepEqual(inputs.filter(isFixture), [], out);
});

// The pages' CSP has no unsafe-eval (ADR 0011, section 4): a schema checker that compiles at run time
// (Ajv, check.ts, core/class-file.ts) would refuse every class there. The room screen checks with the
// reader compiled at build time (schema/ts/src/reader.ts).
const compilesAtRunTime = (path: string): boolean =>
  path.includes("node_modules/ajv/") || /schema\/ts\/src\/(check|hashing|index)\.ts$/.test(path) || path.endsWith("core/class-file.ts") || path.endsWith("core/player-state.ts");

test("no bundle carries a schema checker that compiles at run time; the room screen has the built one", async () => {
  const built = await inputsByOutput();
  for (const [out, inputs] of built) assert.deepEqual(inputs.filter(compilesAtRunTime), [], out);
  assert.ok(built.get("main.js")!.some((p) => p.endsWith("schema/ts/src/reader-validator.generated.ts")));
});

test("the class list's bundle does not carry the class-format reader", async () => {
  const inputs = (await inputsByOutput()).get("instructor.js")!;
  assert.deepEqual(inputs.filter((p) => p.includes("schema/ts/") || p.includes("classformat")), []);
});

test("the scan knows the fake room and the fixtures when it sees them", () => {
  assert.ok(isFixture("src/fake-room.ts"));
  assert.ok(isFixture("../../web/src/fixtures/index.ts"));
  assert.ok(!isFixture("src/room/clock-room.ts"));
});
