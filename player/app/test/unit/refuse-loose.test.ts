// The runtime guard's refusal (refuse-loose.ts) never throws out of the Electron listener that calls
// it, and every throw still ends with the renderer closed, or the application ended (#156 review, N-2).
import assert from "node:assert/strict";
import { test } from "node:test";
import { refuse, refuseLoose } from "../../src/main/refuse-loose.ts";
import type { RefusableRenderer, RefuseDeps } from "../../src/main/refuse-loose.ts";
import { REPORTED_KEYS, secureWebPreferences } from "../../src/main/web-preferences.ts";

const PRELOAD = "/app/dist/preload.cjs";
const want = secureWebPreferences(PRELOAD) as unknown as Record<string, unknown>;
const REPORTED = Object.fromEntries(REPORTED_KEYS.map((k) => [k, want[k]]));
const SESSION = { getPreloadScripts: (): unknown[] => [], isSpellCheckerEnabled: (): boolean => false };
const boom = (): never => {
  throw new Error("native call failed");
};

interface Rig {
  readonly contents: RefusableRenderer;
  readonly deps: RefuseDeps;
  readonly calls: string[];
}

/** A renderer and its deps; `loose` makes it lose the sandbox, `throws` names the calls that throw. */
function rig(opts: { loose?: boolean; destroyed?: boolean; throws?: readonly ("isDestroyed" | "close" | "report" | "fatal")[] } = {}): Rig {
  const calls: string[] = [];
  const throws = new Set(opts.throws ?? []);
  const call = <T>(name: "isDestroyed" | "close" | "report" | "fatal", value: T): T => {
    calls.push(name);
    if (throws.has(name)) boom();
    return value;
  };
  const contents: RefusableRenderer = {
    session: SESSION,
    getLastWebPreferences: () => (opts.loose === true ? { ...REPORTED, sandbox: false } : REPORTED),
    _getPreloadScript: () => ({ type: "frame", filePath: PRELOAD }),
    isDestroyed: () => call("isDestroyed", opts.destroyed === true),
    close: () => call("close", undefined),
  };
  const deps: RefuseDeps = {
    defaultSession: () => SESSION,
    preloads: [PRELOAD],
    report: (m) => {
      call("report", undefined);
      calls.push(`message:${m}`);
    },
    fatal: () => call("fatal", undefined),
  };
  return { contents, deps, calls };
}

test("a hardened renderer is left alone, a destroyed one untouched (controls)", () => {
  const ok = rig();
  refuseLoose(ok.contents, ok.deps);
  assert.deepEqual(ok.calls, ["isDestroyed"]);
  const gone = rig({ loose: true, destroyed: true });
  refuseLoose(gone.contents, gone.deps);
  assert.deepEqual(gone.calls, ["isDestroyed"]);
});

test("a loose renderer is reported by name and closed", () => {
  const r = rig({ loose: true });
  refuseLoose(r.contents, r.deps);
  assert.deepEqual(r.calls, ["isDestroyed", "report", "message:Refused a renderer that is not hardened (sandbox).", "close"]);
});

test("isDestroyed() that throws refuses even a hardened renderer", () => {
  const r = rig({ throws: ["isDestroyed"] });
  assert.doesNotThrow(() => refuseLoose(r.contents, r.deps));
  assert.deepEqual(r.calls, ["isDestroyed", "report", "message:Refused a renderer that is not hardened (unreadable).", "close"]);
});

test("a report that throws still closes the renderer", () => {
  const r = rig({ loose: true, throws: ["report"] });
  assert.doesNotThrow(() => refuseLoose(r.contents, r.deps));
  assert.deepEqual(r.calls.filter((c) => !c.startsWith("message:")), ["isDestroyed", "report", "close"]);
});

test("close() that throws ends the application", () => {
  const r = rig({ loose: true, throws: ["close"] });
  assert.doesNotThrow(() => refuseLoose(r.contents, r.deps));
  assert.deepEqual(r.calls.filter((c) => !c.startsWith("message:")), ["isDestroyed", "report", "close", "fatal"]);
});

test("every call throwing: nothing escapes, and close then fatal were both tried", () => {
  const all = ["isDestroyed", "close", "report", "fatal"] as const;
  const r = rig({ loose: true, throws: all });
  assert.doesNotThrow(() => refuseLoose(r.contents, r.deps));
  assert.deepEqual(r.calls.filter((c) => !c.startsWith("message:")), ["isDestroyed", "report", "close", "fatal"]);
});

test("refuse() for a named reason closes, and falls back to fatal, without throwing", () => {
  const ok = rig();
  refuse(ok.contents, ["guards"], ok.deps);
  assert.deepEqual(ok.calls, ["report", "message:Refused a renderer that is not hardened (guards).", "close"]);
  const stuck = rig({ throws: ["report", "close", "fatal"] });
  assert.doesNotThrow(() => refuse(stuck.contents, ["guards"], stuck.deps));
  assert.deepEqual(stuck.calls, ["report", "close", "fatal"]);
});
