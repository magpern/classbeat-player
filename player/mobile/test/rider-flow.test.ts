// Rider mode's page as a state (issue #633): the two steps, the join's answers, and the four endings,
// each of which opens step 1 with nothing of the last rider (owner, app-rider-join.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { typed } from "../../../web/src/rider/core/join.ts";
import type { FieldName } from "../../../web/src/rider/core/join.ts";
import { CODE_ERROR, ENDING_WORDS, backToCode, continueCode, ended, joinAnswered, joinPressed, keepRiding, onEvent, retry, start } from "../src/rider/flow.ts";
import type { Ending, Flow } from "../src/rider/flow.ts";
import { parseEvent } from "../src/rider/native.ts";
import type { NativeEvent } from "../src/rider/native.ts";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schema", "live", "v1", "examples");
const frame = (dir: string, name: string): NativeEvent => {
  const e = parseEvent({ kind: "frame", text: readFileSync(join(EXAMPLES, dir, "valid", name), "utf8") });
  assert.ok(e, `${dir}/${name}`);
  return e;
};

const type = (f: Flow, field: FieldName, text: string): Flow => ({ ...f, form: typed(f.form, field, text) });

/** Step 2 filled in and joined, with Remember as given, then welcomed. */
function inClass(remember: boolean): Flow {
  let f = continueCode(type(start(true, null), "code", "KXPD-RMTB"));
  f = type(type(type(f, "nickname", "Sam"), "ftp", "250"), "hrmax", "185");
  if (remember) f = { ...f, form: { ...f.form, remember: true, remembered: true } };
  const r = joinPressed(f);
  assert.deepEqual(r.send, { session: "KXPD-RMTB", nickname: "Sam" });
  f = joinAnswered(r.flow, { kind: "joined" });
  assert.equal(f.screen, "live");
  f = onEvent(f, { kind: "opened" }, 1);
  return onEvent(f, frame("welcome-rider", "host-in.json"), 2);
}

/** Nothing of the last rider: no code, nickname or numbers, Remember Off, nothing remembered. */
function assertFresh(f: Flow, how: Ending): void {
  assert.equal(f.screen, "code", how);
  assert.equal(f.ending, how);
  assert.equal(f.live, null);
  assert.equal(f.nickname, null);
  assert.deepEqual(f.form.typed, { code: "", nickname: "", ftp: "", hrmax: "" }, how);
  assert.equal(f.form.code, null);
  assert.equal(f.form.remember, false);
  assert.equal(f.form.remembered, false);
  assert.deepEqual(f.mine, { ftp: null, hrmax: null });
}

test("each of the endings opens step 1 with no nickname, FTP or heart rate, and Remember Off", () => {
  const endings: [Ending, (f: Flow) => Flow][] = [
    // Back asks first ("Leave the class?"); Leave then ends with flow.ts's own ending (app.ts).
    ["left", (f) => ended(onEvent(f, { kind: "back" }, 3), "left")],
    ["removed", (f) => onEvent(f, frame("ended", "dropped.json"), 3)],
    ["ended", (f) => onEvent(f, frame("ended", "host-ended.json"), 3)],
    ["ended", (f) => onEvent(f, { kind: "closed", code: 4403 }, 3)],
    ["lapsed", (f) => onEvent(f, { kind: "closed", code: 4401 }, 3)],
  ];
  for (const remember of [false, true]) {
    for (const [how, end] of endings) {
      assertFresh(end(inClass(remember)), how);
    }
  }
});

test("Back asks before leaving, Keep riding goes back, and only the rider's own Leave shows no plate", () => {
  const asked = onEvent(inClass(true), { kind: "back" }, 3);
  assert.equal(asked.screen, "leave");
  assert.equal(onEvent(asked, { kind: "back" }, 4).screen, "leave");
  assert.equal(keepRiding(asked).screen, "live");
  assert.equal(ENDING_WORDS.left, null);
  for (const how of ["removed", "ended", "lapsed"] as const) assert.ok(ENDING_WORDS[how]?.[0]);
});

test("a mode switch is a new page: step 1 with no nickname, and numbers only if remembered on this phone", () => {
  // The mode switch drops the web view's storage (AndroidModeParts.kt), so the new page finds none.
  const fresh = start(true, null);
  assert.equal(fresh.screen, "code");
  assert.deepEqual(fresh.form.typed, { code: "", nickname: "", ftp: "", hrmax: "" });
  assert.equal(fresh.form.remember, false);
  // Numbers come up only from what "Remember on this phone" kept; the nickname never does.
  const kept = continueCode(type(start(true, { ftp: 250, hrmax: 185 }), "code", "KXPD-RMTB"));
  assert.equal(kept.form.typed.nickname, "");
  assert.deepEqual([kept.form.typed.ftp, kept.form.typed.hrmax, kept.form.remember], ["250", "185", true]);
});

test("Continue checks the code's shape only; Back returns to step 1 with the code kept", () => {
  const bad = continueCode(type(start(true, null), "code", "KXPD"));
  assert.equal(bad.screen, "code");
  assert.equal(bad.form.errors.code, CODE_ERROR);
  assert.equal(bad.form.typed.code, "KXPD");
  const good = continueCode(type(start(true, null), "code", "kxpd rmtb"));
  assert.equal(good.screen, "details");
  assert.equal(good.form.code, "KXPD-RMTB");
  const back = backToCode(good);
  assert.equal(back.screen, "code");
  assert.equal(back.form.typed.code, "KXPD-RMTB");
  assert.equal(back.form.code, null);
});

test("Join sends only the code and the nickname, and nothing while a field is wrong", () => {
  let f = continueCode(type(start(true, null), "code", "KXPD-RMTB"));
  assert.equal(joinPressed(f).send, undefined);
  f = type(type(f, "nickname", "Sam"), "ftp", "9");
  assert.equal(joinPressed(f).send, undefined);
  const r = joinPressed(type(f, "ftp", "250"));
  assert.deepEqual(Object.keys(r.send ?? {}).sort(), ["nickname", "session"]);
  assert.deepEqual(r.flow.mine, { ftp: 250, hrmax: null });
});

test("the join's answers: refused pages, plates on step 2, and Try again", () => {
  const joining = joinPressed(type(continueCode(type(start(true, null), "code", "KXPD-RMTB")), "nickname", "Sam")).flow;
  const notJoined = joinAnswered(joining, { kind: "answer", status: 404, body: { error: "cannot_join" } });
  assert.equal(notJoined.screen, "not_joined");
  assert.equal(retry(notJoined).screen, "details");
  assert.equal(joinAnswered(joining, { kind: "unreachable" }).screen, "no_connection");
  const tooMany = joinAnswered(joining, { kind: "answer", status: 429, body: null });
  assert.deepEqual([tooMany.screen, tooMany.form.plate, tooMany.form.busy], ["details", "too_many", false]);
  assert.equal(joinAnswered(joining, { kind: "answer", status: 0, body: null }).form.plate, "went_wrong");
  // A late answer after the page moved on changes nothing.
  assert.equal(joinAnswered(notJoined, { kind: "joined" }), notJoined);
});

test("a lost link is not an ending: the class stays, to reconnect", () => {
  const f = onEvent(inClass(false), { kind: "closed", code: 1006 }, 3);
  assert.equal(f.screen, "live");
  assert.equal(f.ending, null);
  assert.equal(f.nickname, "Sam");
});
