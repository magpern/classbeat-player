// Play, pause and next from the phone page to native code (issue #857). A fake native follower
// logs every intent; the Android reader must pass on only the three commands, one at a time, only
// while following and after a good answer, and never anything else. No phone, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAndroidReader } from "../src/follow/android-reader.ts";
import type { FollowIntents } from "../src/follow/android-reader.ts";
import type { TransportAction } from "../../app/src/core/link/transport.ts";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

interface Fake extends FollowIntents {
  readonly calls: string[];
  /** Commands not answered yet, oldest first, while `hold` is on. */
  readonly pending: Pending[];
  hold: boolean;
}

function fake(): Fake {
  const calls: string[] = [];
  const pending: Pending[] = [];
  const f: Fake = {
    calls,
    pending,
    hold: false,
    follow: async () => (calls.push("follow"), { state: "following" }),
    unfollow: async () => (calls.push("unfollow"), { state: "stopped" }),
    reading: async () => (calls.push("reading"), { state: "nothing" }),
    sendPlay: () => command("play"),
    sendPause: () => command("pause"),
    sendNext: () => command("next"),
  };
  const command = (name: string): Promise<unknown> => {
    calls.push(name);
    if (!f.hold) return Promise.resolve({ state: "sent" });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  return f;
}

/** A reader over `f` whose poll timer runs only when `tick` is called. */
function reader(f: Fake) {
  let poll: (() => void) | null = null;
  const r = createAndroidReader(f, {
    now: () => 0,
    every: (fn) => ((poll = fn), () => (poll = null)),
  });
  const tick = async (): Promise<void> => {
    poll?.();
    await flush();
  };
  return { r, tick };
}

const commandsOf = (f: Fake): string[] => f.calls.filter((c) => c === "play" || c === "pause" || c === "next");

test("each action calls its own intent once, and only after following has had a good answer", async () => {
  const f = fake();
  const { r, tick } = reader(f);
  r.send("play");
  await flush();
  assert.deepEqual(commandsOf(f), [], "not following: nothing goes");
  r.setActive?.(true);
  await flush();
  r.send("pause");
  await flush();
  assert.deepEqual(commandsOf(f), [], "following, but no answer yet: it waits");
  await tick();
  assert.deepEqual(commandsOf(f), ["pause"], "the good answer lets the waiting command through");
  for (const a of ["play", "next", "pause"] as const) {
    r.send(a);
    await flush();
  }
  assert.deepEqual(commandsOf(f), ["pause", "play", "next", "pause"]);
});

test("after stopping, no command reaches native code", async () => {
  const f = fake();
  const { r, tick } = reader(f);
  r.setActive?.(true);
  await flush();
  await tick();
  r.setActive?.(false);
  await flush();
  for (const a of ["play", "pause", "next"] as const) r.send(a);
  await flush();
  assert.deepEqual(commandsOf(f), []);
});

test("an unknown or malformed action never reaches native code", async () => {
  const f = fake();
  const { r, tick } = reader(f);
  r.setActive?.(true);
  await flush();
  await tick();
  const before = [...f.calls];
  for (const bad of ["stop", "seek", "previous", "", "PLAY", "Next", " play", "play ", "toString", "constructor", "__proto__", null, undefined, 1, {}]) {
    r.send(bad as unknown as TransportAction);
  }
  await flush();
  assert.deepEqual(f.calls, before);
});

test("one command is in flight at a time, and the newest waiting one wins", async () => {
  const f = fake();
  const { r, tick } = reader(f);
  r.setActive?.(true);
  await flush();
  await tick();
  f.hold = true;
  r.send("play");
  r.send("pause");
  r.send("next");
  await flush();
  assert.deepEqual(commandsOf(f), ["play"], "the first goes; the others wait for it");
  f.pending.shift()?.resolve({ state: "sent" });
  await flush();
  assert.deepEqual(commandsOf(f), ["play", "next"], "only the newest waiting one follows");
  f.pending.shift()?.resolve({ state: "notSent" });
  await flush();
  assert.deepEqual(commandsOf(f), ["play", "next"]);
});

test("a refused or failed command frees the slot for the next one", async () => {
  const f = fake();
  const { r, tick } = reader(f);
  r.setActive?.(true);
  await flush();
  await tick();
  f.hold = true;
  r.send("next");
  await flush();
  f.pending.shift()?.reject(new Error("refused"));
  await flush();
  r.send("play");
  await flush();
  assert.deepEqual(commandsOf(f), ["next", "play"]);
});

test("an intent that throws at once is taken as failed and frees the slot", async () => {
  const f = fake();
  let throws = true;
  const play = f.sendPlay;
  f.sendPlay = () => {
    f.calls.push("play");
    if (throws) throw new Error("bridge gone");
    return play();
  };
  const { r, tick } = reader(f);
  r.setActive?.(true);
  await flush();
  await tick();
  r.send("play");
  await flush();
  throws = false;
  r.send("pause");
  await flush();
  assert.deepEqual(commandsOf(f), ["play", "pause"]);
});
