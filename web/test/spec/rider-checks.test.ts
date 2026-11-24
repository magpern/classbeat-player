// The rider page's measurable checks (docs/design/rider.md, R1 to R12) on the real page, on the fake
// site and live process with recorded `rider_state` messages and a paused clock: every state of the
// spec and the worst cases, the class and ending states at the four sizes, the forms in portrait.
// Each stage also checks the state's words. The stages are in ../lib/rider-stages.ts, the shots and
// their checks in ../lib/rider-shots.ts (SPEC_ONLY, SPEC_JOBS).
import assert from "node:assert/strict";
import { checkRiderShots } from "../lib/rider-shots.ts";
import { IN, NICK24, NOW, RUN, WORST, Z4, at, inClass, joinWith, send, then, variant, words } from "../lib/rider-stages.ts";
import type { State, StateDef } from "../lib/rider-stages.ts";

const STATES: Readonly<Record<string, StateDef>> = {
  // Before and while joining (forms, portrait).
  enter: { form: true, stage: words(["Join the class", "Class code KXPD-RMTB", "Your instructor sees your nickname. FTP and max heart rate stay on this phone and are never sent.", "Nickname", "FTP, in watts (optional)", "Max heart rate, in bpm (optional)", "Remember on this phone", "Off"], ["Forget"]) },
  "enter-remembered": { form: true, open: { remembered: '{"ftp":250,"hrmax":185}' }, stage: then(async (f) => assert.equal(await f.page.inputValue("#rider-ftp"), "250"), words(["On", "Forget"])) },
  "enter-error": { form: true, stage: then(joinWith({ nickname: "", ftp: "2500" }), (f) => at(f, "#rider-ftp-error"), words(["Type a nickname, 1 to 24 characters.", "FTP is a whole number from 50 to 600."])) },
  "enter-no-code": { form: true, open: { hash: "" }, stage: words(["Type the class code from the room screen.", "Class code"], ["KXPD-RMTB"]) },
  "no-storage": { form: true, open: { noStorage: true }, stage: words(["Not available on this phone", "Off"]) },
  "too-many": { form: true, open: { answers: [{ status: 429, body: { error: "too_many_requests" } }] }, stage: then(joinWith(), (f) => at(f, ".plate"), words(["Too many tries.", "Wait a minute and try again."])) },
  "went-wrong": { form: true, open: { answers: [{ status: 500, body: { error: "internal_error" } }] }, stage: then(joinWith(), (f) => at(f, ".plate"), words(["Something went wrong.", "Try again."])) },
  joining: { form: true, open: { ...IN, welcome: null }, stage: then(joinWith({ ftp: "250", hrmax: "185" }), (f) => at(f, ".field.dim"), words(["Joining the class", "Getting you into the class", "Joining…"])) },
  away: { form: true, open: IN, stage: then(inClass(RUN), async (f) => f.live.close(4401), (f) => at(f, ".plate"), words(["You were away too long", "Join again to get back in."]), async (f) => assert.equal(await f.page.inputValue("#rider-nickname"), "Anna")) },
  "my-numbers": { form: true, open: IN, stage: then(inClass(RUN), (f) => f.page.click("[data-action=my_numbers]"), (f) => at(f, "[data-action=done]"), words(["My numbers", "Used on this phone to work out your effort. Never sent.", "Done"])) },
  "worst-form": { form: true, open: { remembered: '{"ftp":250,"hrmax":185}' }, stage: then(joinWith({ nickname: NICK24, ftp: "9999", hrmax: "9999" }), (f) => at(f, "#rider-hrmax-error"), words(["Max heart rate is a whole number from 80 to 230."])) },
  // Refused, and the ending pages (all sizes).
  "not-joined": { open: { answers: [{ status: 403, body: { error: "cannot_join" } }] }, stage: then(joinWith(), (f) => at(f, "[data-action=retry]"), words(["Could not join", "Check the code with your instructor.", "KXPD-RMTB", "Try again"])) },
  "no-connection": { open: { answers: [{ status: 0, fail: true }] }, stage: then(joinWith(), (f) => at(f, "[data-action=retry]"), words(["No connection", "Check your phone's network, then try again."])) },
  waiting: { open: { ...IN, welcome: false }, stage: then(inClass(null), (f) => at(f, ".work"), words(["Waiting for the instructor", "You are in. The class shows here when the instructor is back.", "Joined as Anna"])) },
  removed: { open: IN, stage: then(inClass(RUN), send({ v: 1, type: "ended", reason: "dropped" }, "h1"), words(["The instructor removed you from this class", "To join again, scan the code on the room screen."], ["Try again", "Join the class"])) },
  ended: { open: IN, stage: then(inClass(RUN), send({ v: 1, type: "ended", reason: "host_ended" }, "h1"), words(["The class has ended", "You can close this page."])) },
  // In the class (all sizes).
  running: { open: IN, stage: then(inClass(RUN), words(["Joined as Anna", "23:41", "left", "Threshold", "Interval left", "1:10", "Position", "Seated", "Power", "220–235", "W", "Heart rate", "157–170", "bpm", "RPE", "7–8", "Next", "Endurance", "My numbers"], ["%", "Add your FTP"])) },
  "running-percent": { open: IN, stage: then(inClass(RUN, false), words(["88–94%", "FTP", "85–92%", "max", "Add your FTP and max heart rate in My numbers to see watts and beats."])) },
  "ftp-test": { open: IN, stage: then(inClass(variant(RUN, { now: { ...NOW, zone: { number: 5, name: "VO2 max", effort: { ftpPct: null, hrmaxPct: null, rpe: [9, 10] } }, test: { kind: "ftp", minutes: 20 }, remainingMs: 720_000 } })), words(["FTP test, 20 min", "VO2 max", "12:00", "9–10"], ["Power"])) },
  "before-start": { open: IN, stage: then(inClass(variant(RUN, { status: "not_started", classMs: 0, classRemainingMs: 2_700_000 })), words(["First zone", "First interval", "45:00", "class"])) },
  paused: { open: IN, stage: then(inClass(variant(RUN, { status: "paused" })), words(["Paused", "Interval left", "1:10"]), (f) => at(f, ".gel.down")) },
  holding: { open: IN, stage: then(inClass(variant(RUN, { status: "holding", now: { ...NOW, zone: Z4, remainingMs: 0 } })), words(["Until the next song", "0:00"])) },
  "last-interval": { open: IN, stage: then(inClass(variant(RUN, { next: [] })), words(["Last interval", "End of class"])) },
  finished: { open: IN, stage: then(inClass(variant(RUN, { status: "ended" })), words(["Class complete", "45:00 ridden", "Thank you for riding."], ["My numbers", "Power"])) },
  "host-away": { open: IN, stage: then(inClass(RUN), send({ v: 1, type: "host_status", connected: false }, ".count.est"), words(["Waiting for the instructor", "Interval left, not live"]), (f) => at(f, ".gel.down")) },
  reconnecting: {
    open: IN,
    stage: then(inClass(RUN), async (f) => {
      f.live.refuse = true;
      await f.live.close(1006);
      await at(f, ".count.est");
    }, words(["Reconnecting", "Interval left, not live"])),
  },
  "no-wake": { open: { ...IN, wake: "absent" }, stage: then(inClass(RUN), words(["Set your screen to stay on"])) },
  worst: { open: IN, stage: then(inClass(WORST, true, NICK24), words(["FTP test, 20 min", "58:58", "1:58:58", "Standing", "W"])) },
  "worst-percent": { open: IN, stage: then(inClass(variant(WORST, { now: { ...(WORST.now as State), test: null } }), false, NICK24), words(["112–150%", "80–100%", "Add your FTP"])) },
};

checkRiderShots("the rider page against its spec", STATES);
