// "Open a class file" (main/list/open-class-file.ts): a file that reads goes to the presenter, one
// that does not leaves the list as it was and shows the message with the file's name; on the
// presenter page the failure is the presenter's own error. Nothing is cached or pinned.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot } from "../../src/core/snapshot.ts";
import { EMPTY_SNAPSHOT } from "../../src/core/snapshot.ts";
import { openClassFile } from "../../src/main/list/open-class-file.ts";
import type { OpenDeps } from "../../src/main/list/open-class-file.ts";
import type { Picked } from "../../src/main/open-file.ts";

function run(picked: Picked, opened: Snapshot, onList = true) {
  const calls: string[] = [];
  const deps: OpenDeps = {
    pick: async () => picked,
    open: (name) => (calls.push(`open ${name}`), opened),
    refuse: (m) => (calls.push(`refuse ${m}`), EMPTY_SNAPSHOT),
    fileFailed: (e) => void calls.push(`failed ${e.fileName} | ${e.message} | ${e.details.join(",")}`),
    dismiss: () => void calls.push("dismiss"),
    release: () => void calls.push("release"),
    showPresenter: () => void calls.push("showPresenter"),
    onList: () => onList,
  };
  return openClassFile(deps).then(() => calls);
}

const GOOD = { ...EMPTY_SNAPSHOT, loadId: 1 } as Snapshot;
const BAD = { ...EMPTY_SNAPSHOT, error: { message: "This class file is not valid.", details: ["a", "b", "c", "d", "e", "f"] } } as Snapshot;

test("a file that reads opens in the presenter", async () => {
  assert.deepEqual(await run({ name: "a.json", text: "{}" }, GOOD), ["open a.json", "dismiss", "release", "showPresenter"]);
});

test("a file that does not read, on the list, shows the plate with its name and five details, and stays", async () => {
  assert.deepEqual(await run({ name: "x.json", text: "{}" }, BAD), ["open x.json", "failed x.json | This class file is not valid. | a,b,c,d,e"]);
  assert.deepEqual(await run({ name: "big.json", error: "This file is too large to be a class file." }, GOOD), ["failed big.json | This file is too large to be a class file. | "]);
});

test("on the presenter page a failure is the presenter's error, as before", async () => {
  assert.deepEqual(await run({ name: "big.json", error: "This is not a file." }, GOOD, false), ["refuse This is not a file."]);
  assert.deepEqual(await run({ name: "x.json", text: "{}" }, BAD, false), ["open x.json", "dismiss"]);
});

test("only a file that opened ends the pin of the class being played; a failed open never releases it", async () => {
  assert.ok((await run({ name: "a.json", text: "{}" }, GOOD)).includes("release"));
  for (const onList of [true, false]) {
    assert.ok(!(await run({ name: "x.json", text: "{}" }, BAD, onList)).includes("release"));
    assert.ok(!(await run({ name: "big.json", error: "e" }, GOOD, onList)).includes("release"));
  }
});

test("a cancelled dialog does nothing", async () => {
  assert.deepEqual(await run(null, GOOD), []);
});
