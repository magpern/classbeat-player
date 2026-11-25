// The update settings, the feed address, what the renderer is told and its words
// (core/update/settings.ts, feed-address.ts, view.ts, words.ts) and the settings file
// (main/update/settings-file.ts): defaults on anything unreadable, an override that is not https
// failing closed, no address in the view or the words, and a file readable by this user only.
import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_FEED, MAX_FEED_LENGTH, parseFeedAddress } from "../../src/core/update/feed-address.ts";
import { DEFAULT_SETTINGS, feedOf, readSettings, writeSettings } from "../../src/core/update/settings.ts";
import { couldNotCheck } from "../../src/core/update/status.ts";
import type { UpdateStatus } from "../../src/core/update/status.ts";
import { viewOf } from "../../src/core/update/view.ts";
import type { UpdateView } from "../../src/core/update/view.ts";
import { noticeWords, settingsWords, statusWords } from "../../src/core/update/words.ts";
import { MAX_SETTINGS_BYTES, SETTINGS_FILE, settingsFile } from "../../src/main/update/settings-file.ts";

test("the feed address: https only, no user name or password, not too long", () => {
  assert.equal(parseFeedAddress(DEFAULT_FEED), DEFAULT_FEED);
  assert.equal(parseFeedAddress("https://feed.invalid/r"), "https://feed.invalid/r");
  const bad: unknown[] = ["http://feed.invalid/", "file:///etc/passwd", "javascript:alert(1)", "https://u@feed.invalid/", "https://u:p@feed.invalid/", "", "feed.invalid", 42, null, `https://feed.invalid/${"a".repeat(MAX_FEED_LENGTH)}`];
  for (const b of bad) assert.equal(parseFeedAddress(b), null, String(b));
});

test("the settings: defaults for a missing, unreadable or wrong file; a wrong value gives its default; a wrong feed fails closed", () => {
  for (const t of [null, "", "not json", "[]", "null", "42"]) assert.deepEqual(readSettings(t), DEFAULT_SETTINGS, String(t));
  assert.deepEqual(DEFAULT_SETTINGS, { auto: true, prereleases: false, feed: null });
  assert.deepEqual(readSettings('{"automaticChecks":false,"prereleases":true}'), { auto: false, prereleases: true, feed: null });
  assert.deepEqual(readSettings('{"automaticChecks":"no","prereleases":1}'), DEFAULT_SETTINGS);
  assert.equal(readSettings('{"feed":42}').feed, "");
  assert.equal(feedOf(readSettings('{"feed":42}')), null);
  assert.equal(feedOf(readSettings('{"feed":"http://feed.invalid/"}')), null);
  assert.equal(feedOf(readSettings('{"feed":"https://feed.invalid/"}')), "https://feed.invalid/");
  assert.equal(feedOf(DEFAULT_SETTINGS), DEFAULT_FEED);
});

test("writing keeps the override as it was written, so a switch never loses it", () => {
  const s = readSettings('{"automaticChecks":true,"prereleases":false,"feed":""}');
  assert.deepEqual(readSettings(writeSettings({ ...s, prereleases: true })), { auto: true, prereleases: true, feed: "" });
  assert.equal(JSON.parse(writeSettings(DEFAULT_SETTINGS)).feed, undefined);
});

const NEWER: UpdateStatus = { kind: "newer", current: "0.1.0", latest: "0.2.0" };

test("the view: the last result while a check runs, a failure drops the notice but keeps the last latest, and before any result it cannot check", () => {
  const s = DEFAULT_SETTINGS;
  assert.deepEqual(viewOf("0.1.0", NEWER, "0.2.0", false, s), { kind: "newer", current: "0.1.0", latest: "0.2.0", notice: "0.2.0", checked: true, auto: true, prereleases: false });
  assert.deepEqual(viewOf("0.1.0", NEWER, "0.2.0", true, s), { kind: "checking", current: "0.1.0", latest: "0.2.0", notice: "0.2.0", checked: true, auto: true, prereleases: false });
  assert.deepEqual(viewOf("0.1.0", couldNotCheck("0.1.0"), "0.2.0", false, s), { kind: "could not check", current: "0.1.0", latest: "0.2.0", notice: null, checked: true, auto: true, prereleases: false });
  assert.deepEqual(viewOf("0.1.0", null, null, false, { ...s, auto: false }), { kind: "could not check", current: "0.1.0", latest: null, notice: null, checked: false, auto: false, prereleases: false });
  assert.equal(viewOf("0.1.0", { kind: "up to date", current: "0.1.0", latest: "0.1.0" }, "0.1.0", false, s).notice, null);
});

const V = (over: Partial<UpdateView>): UpdateView => ({ kind: "up to date", current: "0.1.0", latest: "0.1.0", notice: null, checked: true, auto: true, prereleases: false, ...over });

test("the words: a marker and words per state, Open release page only for a newer version, Check now busy only while checking", () => {
  const cases: [UpdateView, string, string, boolean, boolean][] = [
    [V({}), "ok", "Up to date", false, false],
    [V({ kind: "newer", latest: "0.2.0", notice: "0.2.0" }), "news", "Newer version available", true, false],
    [V({ kind: "checking", notice: "0.2.0" }), "work", "Checking…", false, true],
    [V({ kind: "could not check", latest: null }), "away", "Could not check", false, false],
  ];
  for (const [v, marker, words, open, busy] of cases) {
    const w = settingsWords(v);
    assert.equal(w.status.marker, marker);
    assert.equal(w.status.words, words);
    assert.equal(w.open, open, words);
    assert.equal(w.busy, busy, words);
  }
  assert.equal(settingsWords(V({ kind: "could not check", latest: null })).status.detail, "The list of releases could not be read. Press Check now to try again.", "after a failed check");
  assert.equal(settingsWords(V({ kind: "could not check", latest: null, checked: false })).status.detail, "No check has run yet. Press Check now.", "before any check");
  assert.deepEqual(settingsWords(V({ latest: null })).latest, { version: null, pre: false });
  assert.deepEqual(settingsWords(V({ latest: "0.3.0-rc.1" })).latest, { version: "0.3.0-rc.1", pre: true });
  assert.equal(settingsWords(V({ latest: "0.3.0+build-1" })).latest.pre, false, "a hyphen in build data is not a pre-release");
  assert.match(settingsWords(V({ auto: false })).auto.help, /only when you press Check now/);
  assert.match(settingsWords(V({})).auto.help, /every 6 hours/);
});

test("the notice: only with a newer version, kept while checking, with the running version; no address in any words", () => {
  assert.equal(noticeWords(null), null);
  assert.equal(noticeWords(V({})), null);
  assert.deepEqual(noticeWords(V({ kind: "checking", notice: "0.3.0-rc.1" })), { version: "0.3.0-rc.1", pre: true, detail: "You have 0.1.0. Nothing is downloaded or installed." });
  const all = [V({}), V({ kind: "newer", latest: "0.2.0", notice: "0.2.0" }), V({ kind: "checking" }), V({ kind: "could not check", latest: null })];
  for (const v of all) assert.doesNotMatch(JSON.stringify([statusWords(v), settingsWords(v), noticeWords(v)]), /http|:\/\/|github/i);
});

test("the settings file: a round trip, readable by this user only, defaults when missing, too large or a link", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "update-settings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = settingsFile(dir);
  assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  store.save({ auto: false, prereleases: true, feed: null });
  assert.deepEqual(store.load(), { auto: false, prereleases: true, feed: null });
  const file = join(dir, SETTINGS_FILE);
  if (process.platform !== "win32") assert.equal(lstatSync(file).mode & 0o777, 0o600);
  writeFileSync(file, `{"automaticChecks":false,"x":"${"a".repeat(MAX_SETTINGS_BYTES)}"}`);
  assert.deepEqual(store.load(), DEFAULT_SETTINGS, "too large: not read");
  if (process.platform !== "win32") {
    // A link planted at the temporary file's place is removed, never written through.
    const target = join(dir, "target");
    writeFileSync(target, "keep");
    symlinkSync(target, `${file}.tmp`);
    store.save(DEFAULT_SETTINGS);
    assert.equal(readFileSync(target, "utf8"), "keep");
    assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  }
});
