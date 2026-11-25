// The MixSource interface, its fake, the unavailable default and the empty setting. With no source
// set the player behaves exactly as today: the shipped app reaches no source but the unavailable one
// (sign-in on the class list, #691, loads core/mix/ for its words, never a source that connects).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { modePolicy } from "../../src/core/mix/mode-policy.ts";
import { chooseMixSource, DEFAULT_MIX_SOURCE_SETTING, isAllowedOrigin } from "../../src/core/mix/source-setting.ts";
import { UnavailableMixSource } from "../../src/core/mix/unavailable-source.ts";
import { REPO } from "./fixtures.ts";
import { FAKE_TOKEN, FakeMixSource } from "./fake-mix-source.ts";
import { closure, graphOf } from "./import-graph.ts";
import type { Files } from "./import-graph.ts";

const drain = async (s: AsyncIterable<Uint8Array>): Promise<number[]> => {
  const out: number[] = [];
  for await (const c of s) out.push(...c);
  return out;
};

describe("UnavailableMixSource, the default", () => {
  it("has no fields and answers unavailable", async () => {
    const s = new UnavailableMixSource();
    assert.deepEqual(s.credentialFields(), []);
    assert.deepEqual(await s.signIn(), { ok: false, refusal: "unavailable" });
    assert.deepEqual(await s.describe(), { ok: false, refusal: "unavailable" });
    assert.deepEqual(await s.read(), { ok: false, refusal: "unavailable" });
    await s.signOut();
  });
  it("is what the empty setting, and every setting for now, chooses", () => {
    assert.equal(DEFAULT_MIX_SOURCE_SETTING.mixSourceOrigin, "");
    assert.equal(chooseMixSource().kind, "unavailable");
    assert.equal(chooseMixSource({ mixSourceOrigin: "http://127.0.0.1:1" }).kind, "unavailable");
  });
  it("makes every mix class the manual clock, exactly as today", () => {
    const source = chooseMixSource();
    for (const readiness of ["ready", "streaming", "downloading", "not_checked", "not_allowed"] as const) {
      const r = modePolicy({ musicSource: "swedebeat", hasMix: true, sourceAvailable: source.kind === "available", keychainUsable: true, hasToken: true, readiness });
      assert.deepEqual(r, { mode: "manual", reason: "disabled" });
    }
  });
  it("is the only source the shipped bundles can reach", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));
    const src = join(REPO, "player", "app", "src");
    const files: Files = new Map(walk(src).map((p) => [relative(REPO, p).split("\\").join("/"), readFileSync(p, "utf8")]));
    const graph = graphOf(files);
    const entries = [...files.keys()].filter((p) => /\/src\/(main\/main|preload\/[^/]+|renderer\/[^/]+)\.ts$/.test(p));
    assert.ok(entries.length > 3);
    const reached = [...closure(graph, entries)];
    // Every class that is a MixSource, anywhere the shipped app reaches: the unavailable one only.
    const sources = reached.filter((p) => /\bimplements\s+MixSource\b|\bnew\s+\w*MixSource\(/.test(files.get(p) ?? ""));
    assert.deepEqual(sources.sort(), ["player/app/src/core/mix/source-setting.ts", "player/app/src/core/mix/unavailable-source.ts"]);
    assert.ok(!reached.some((p) => /fake/i.test(p)));
    // Nothing the renderer or preload loads holds a source.
    const pages = [...closure(graph, entries.filter((p) => !p.endsWith("/main/main.ts")))];
    assert.ok(!pages.some((p) => /\/core\/mix\/(source-setting|unavailable-source)\.ts$|\/main\/mix\//.test(p)), pages.join("\n"));
  });
});

// The text of a node, without its comments and with single spaces.
const flat = (n: ts.Node, sf: ts.SourceFile): string => n.getText(sf).replace(/\s+/g, " ");

function walkNodes(n: ts.Node, visit: (n: ts.Node) => void): void {
  visit(n);
  n.forEachChild((c) => walkNodes(c, visit));
}

describe("the source the shell builds (#709)", () => {
  const read = (p: string): ts.SourceFile => ts.createSourceFile(p, readFileSync(join(REPO, p), "utf8"), ts.ScriptTarget.Latest, true);
  it("is chooseMixSource() in setupMix, unless the test switch is on, and that one source goes to the cache and the service", () => {
    const sf = read("player/app/src/main/mix/setup.ts");
    const decls = new Map<string, string[]>();
    const passed: string[] = [];
    walkNodes(sf, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) decls.set(n.name.text, [...(decls.get(n.name.text) ?? []), n.initializer === undefined ? "" : flat(n.initializer, sf)]);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^create(MixCache|MixService)$/.test(n.expression.text)) {
        const deps = n.arguments[0];
        assert.ok(deps !== undefined && ts.isObjectLiteralExpression(deps), n.expression.text);
        for (const p of deps.properties) if (p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === "source") passed.push(`${n.expression.text} ${flat(p, sf)}`);
      }
    });
    assert.deepEqual(decls.get("source"), ["test ? testMixSource() : chooseMixSource()"]);
    assert.deepEqual(decls.get("test"), ["testMixOn(app)"]);
    assert.deepEqual(passed.sort(), ["createMixCache source", "createMixService source"]);
  });
  it("holds no source written as an object literal anywhere the shipped app reaches, but the switched-off test one", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));
    const files: Files = new Map(walk(join(REPO, "player", "app", "src")).map((p) => [relative(REPO, p).split("\\").join("/"), readFileSync(p, "utf8")]));
    const entries = [...files.keys()].filter((p) => /\/src\/(main\/main|preload\/[^/]+|renderer\/[^/]+)\.ts$/.test(p));
    const literals: string[] = [];
    for (const p of closure(graphOf(files), entries)) {
      const sf = ts.createSourceFile(p, files.get(p) ?? "", ts.ScriptTarget.Latest, true);
      walkNodes(sf, (n) => {
        if (!ts.isObjectLiteralExpression(n)) return;
        const names = n.properties.map((x) => (x.name !== undefined && (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name)) ? x.name.text : ""));
        // Every MixSource has `credentialFields`; one that connects is `kind: "available"`.
        const available = n.properties.some((x) => ts.isPropertyAssignment(x) && flat(x, sf) === 'kind: "available"');
        if (names.includes("credentialFields") || available) literals.push(p);
      });
    }
    assert.deepEqual(literals, ["player/app/src/main/mix/test-mix.ts"]);
  });
});

describe("the origin setting", () => {
  it("allows empty and loopback only", () => {
    for (const o of ["", "http://localhost:8080", "https://127.0.0.1", "http://127.0.0.1:5000/"]) assert.equal(isAllowedOrigin(o), true, o);
    for (const o of ["https://mixes.example.invalid", "http://localhost.invalid", "ftp://localhost", "localhost", "http://user@localhost", "http://10.0.0.1"]) assert.equal(isAllowedOrigin(o), false, o);
  });
});

describe("FakeMixSource", () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);
  it("declares fields, signs in, describes and reads from an offset, recording what it was asked", async () => {
    const s = new FakeMixSource(bytes);
    assert.deepEqual(s.credentialFields().map((f) => f.name), ["username", "password"]);
    assert.deepEqual(await s.signIn({ username: "u", password: "secret-value" }), { ok: true, token: FAKE_TOKEN });
    const d = await s.describe(FAKE_TOKEN, "mix-1");
    assert.deepEqual(d, { ok: true, mix: { byteLength: 10, durationMs: 1000, version: "v1", mayPlay: true } });
    const r = await s.read(FAKE_TOKEN, "mix-1", 6);
    assert.ok(r.ok);
    assert.deepEqual(await drain(r.bytes), [6, 7, 8, 9]);
    assert.deepEqual(s.calls, ["signIn password,username", "describe mix-1", "read mix-1 6"]);
    assert.ok(!s.calls.join().includes("secret-value"));
  });
  it("scripts a refusal, a wrong length, an invalid token and no access", async () => {
    const s = new FakeMixSource(bytes);
    s.refuseSignIn = "rate_limited";
    assert.deepEqual(await s.signIn({}), { ok: false, refusal: "rate_limited" });
    s.statedByteLength = 99;
    s.mayPlay = false;
    const d = await s.describe(FAKE_TOKEN, "m");
    assert.ok(d.ok && d.mix.byteLength === 99 && !d.mix.mayPlay);
    s.tokenInvalid = true;
    assert.deepEqual(await s.describe(FAKE_TOKEN, "m"), { ok: false, refusal: "token_invalid" });
    assert.deepEqual(await s.read(FAKE_TOKEN, "m", 0), { ok: false, refusal: "token_invalid" });
    assert.deepEqual(await new FakeMixSource(bytes).describe("other", "m"), { ok: false, refusal: "token_invalid" });
  });
  it("can stall a read after some chunks", async () => {
    const s = new FakeMixSource(bytes);
    s.stallAfterChunks = 1;
    const r = await s.read(FAKE_TOKEN, "m", 0);
    assert.ok(r.ok);
    const it = r.bytes[Symbol.asyncIterator]();
    assert.deepEqual([...(await it.next()).value!], [0, 1, 2, 3]);
    const next = await Promise.race([it.next().then(() => "chunk"), new Promise((res) => setTimeout(() => res("stalled"), 50))]);
    assert.equal(next, "stalled");
  });
});
