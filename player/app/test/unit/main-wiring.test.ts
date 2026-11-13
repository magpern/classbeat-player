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
  assert.match(main, /registerRoomHandlers\(ipcMain,\s*\(\)\s*=>\s*room\.trusted\(\),\s*controller,\s*\{ endClass, remote \}\)/);
});

test("the room window closes with the class: on the class list unpinned, at the end on the list, with the presenter", () => {
  assert.match(main, /function showList\(\): void \{\s*showPage\(LIST_FILE\);\s*if \(roomCloses\(true, pinned\(\)\)\) room\.close\(\);/);
  assert.match(main, /controller\.onEnded\(\(\) => \{\s*if \(roomCloses\(onListPage\(\), pinned\(\)\)\) room\.close\(\);/);
  assert.match(main, /presenter\.on\("closed", \(\) => \{\s*presenter = null;\s*room\.close\(\);/);
});

test("File > Show the room screen opens the room window again while the class is open", () => {
  assert.match(main, /function showRoom\(\): void \{\s*if \(roomMayOpen\(controller\.snapshot\(\)\.doc !== null, onListPage\(\), pinned\(\)\)\) room\.open\(\);\s*\}/);
  assert.match(main, /installMenu\(\{[^}]*\bshowRoom\b[^}]*\}\)/);
});

// #159 review: the keep-awake release on the presenter closing and on quit had no test.
test("the display-sleep blocker follows every snapshot and is released with the presenter and on quit", () => {
  assert.match(main, /controller\.watch\(\(s\)\s*=>\s*keepAwake\.update\(s\.view\)\)/);
  assert.match(main, /presenter\.on\("closed", \(\) => \{[^}]*\bkeepAwake\.release\(\);[^}]*\}\);/);
  assert.match(main, /app\.on\("will-quit", \(\) => keepAwake\.release\(\)\);/);
  assert.match(main, /const keepAwake = createKeepAwake\(electronBlocker\);/);
});

test("End class from the room window ends the phone remote and the pin, and the class list comes back", () => {
  assert.match(main, /function endClass\(\): void \{\s*remote\.stop\(\);\s*list\?\.release\(\);\s*showList\(\);\s*\}/);
  assert.match(main, /remote\.watch\(\(v\)\s*=>\s*room\.sendRemote\(v\)\)/);
});

// #202: the room window's slot is joined to the live client, and only the room's button starts it.
test("the room's phone-remote slot is the live client's, refreshed with every snapshot and pairing change", () => {
  assert.match(main, /let remote: RoomRemote = NO_REMOTE;/);
  assert.match(main, /phoneRemote = setupLive\(controller, paired\);\s*const roomRemote = liveRoomRemote\(phoneRemote\);\s*remote = roomRemote;/);
  assert.match(main, /controller\.watch\(\(\) => roomRemote\.refresh\(\)\);/);
  assert.match(main, /paired\.watch\(\(\) => roomRemote\.refresh\(\)\);/);
  // The room's slot is wired before its handlers, so room:remote-start reaches the live client.
  assert.ok(main.indexOf("remote = roomRemote;") < main.indexOf("registerRoomHandlers("));
  // Nothing in the shell starts the phone remote: only the room's handler and the presenter's do.
  assert.doesNotMatch(main, /\b(remote|roomRemote|phoneRemote)\??\.start\(/);
});
