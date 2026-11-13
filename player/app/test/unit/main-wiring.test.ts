// main.ts needs Electron, so its wiring is asserted on the source (comments removed): the class
// clock's end and a dropped class file both end the pin through the list controller's release.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const main = readFileSync(new URL("../../src/main/main.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the class ending releases the list's pin and snapshot", () => {
  assert.match(main, /controller\.onEnded\(\s*\(\)\s*=>\s*list\?\.release\(\)\s*\)/);
});

test("a class file dropped on the presenter releases the pin", () => {
  assert.match(main, /registerIpc\(controller, trusted, paired, \(\)\s*=>\s*list\?\.release\(\)\)/);
});

test("Open a class file releases the pin", () => {
  assert.match(main, /release:\s*\(\)\s*=>\s*l\.release\(\)/);
});

test("the list's account key is the credential's, not the pairing email", () => {
  assert.match(main, /createListController\(\{[^}]*account:\s*\(\)\s*=>\s*credentialOf\(paired\)\?\.account/);
});

test("the room window opens with every class that opens, and is sent every snapshot", () => {
  assert.match(main, /controller\.onOpened\(\(\)\s*=>\s*room\.open\(\)\)/);
  assert.match(main, /controller\.watch\(\(s\)\s*=>\s*room\.send\(s\)\)/);
  assert.match(main, /registerRoomHandlers\(ipcMain,\s*\(\)\s*=>\s*room\.trusted\(\),\s*controller\)/);
});

test("the room window closes with the class: on the class list unpinned, at the end on the list, with the presenter", () => {
  assert.match(main, /function showList\(\): void \{\s*showPage\(LIST_FILE\);\s*if \(roomCloses\(true, pinned\(\)\)\) room\.close\(\);/);
  assert.match(main, /controller\.onEnded\(\(\) => \{\s*if \(roomCloses\(onListPage\(\), pinned\(\)\)\) room\.close\(\);/);
  assert.match(main, /presenter\.on\("closed", \(\) => \{\s*presenter = null;\s*room\.close\(\);/);
});
