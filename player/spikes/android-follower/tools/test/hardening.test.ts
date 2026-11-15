// Issue #570: the guard follow-ups from the reviews of #566 and #568 (N8, N9, N10, NB-A, NB-B, NB-C).
// Every refusal here is a firing test: the fixture is refused with the named rule (and message), and the same
// fixture with the refused part removed is accepted, so the test shows the refusal is what stops it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkTree } from "../src/guard_rules.js";
import type { Tree } from "../src/guard_rules.js";
import { statements } from "../src/use_sites.js";
import { loadTree } from "./load_tree.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const real = loadTree(root);

const READER = "app/src/main/kotlin/org/classbeat/spike/follower/SpotifyReader.kt";
const LISTENER = "app/src/main/kotlin/org/classbeat/spike/follower/SpikeListener.kt";
const CORE_TEST = "core/src/test/kotlin/org/classbeat/spike/SpotifyFilterTest.kt";
const SCRIPTS = ["settings.gradle.kts", "build.gradle.kts", "app/build.gradle.kts", "core/build.gradle.kts"];
const WRAPPER = ["gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.properties"];

function edit(path: string, from: string | RegExp, to: string): Tree {
  const text = real.files[path];
  assert.ok(text !== undefined, `${path} is not in the tree`);
  const next = text.replace(from, () => to);
  assert.notEqual(next, text, `edit of ${path} changed nothing`);
  return { ...real, files: { ...real.files, [path]: next } };
}

/** The fixture is refused (rule, and message if given); the fixture with the refused part removed is accepted. */
function fires(bad: Tree, good: Tree, rule: string, message?: RegExp, path?: string) {
  const found = checkTree(bad);
  const hit = found.filter((x) => x.startsWith(`${rule}:`) && (!path || x.includes(path)) && (!message || message.test(x)));
  assert.ok(hit.length > 0, `expected a "${rule}" violation${message ? ` matching ${message}` : ""}, got ${JSON.stringify(found)}`);
  assert.deepEqual(checkTree(good), [], "the same fixture without the refused part must be accepted");
}

describe("N8: the wrapper is pinned by its exact bytes", () => {
  const lines = (p: string) => real.files[p]!;
  const variants: [string, string, (t: string) => string][] = [
    ["a trailing space after the sh line continuation", "gradlew", (t) => t.replace('set -- \\\n', 'set -- \\ \n')],
    ["a trailing tab after the sh line continuation", "gradlew", (t) => t.replace('set -- \\\n', 'set -- \\\t\n')],
    ["an extra blank line", "gradlew", (t) => t.replace("\n\n", "\n\n\n")],
    ["an extra blank line at the end", "gradlew", (t) => `${t}\n`],
    ["CRLF line endings", "gradlew", (t) => t.replace(/\n/g, "\r\n")],
    ["a trailing space on one line", "gradlew", (t) => t.replace("MAX_FD=maximum\n", "MAX_FD=maximum \n")],
    ["a trailing space on one batch line", "gradlew.bat", (t) => t.replace("\r\n", " \r\n")],
    ["an extra blank line in the batch script", "gradlew.bat", (t) => t.replace("\r\n", "\r\n\r\n")],
    ["LF line endings in the batch script", "gradlew.bat", (t) => t.replace(/\r\n/g, "\n")],
    ["a trailing space in the properties", "gradle/wrapper/gradle-wrapper.properties", (t) => t.replace("networkTimeout=10000", "networkTimeout=10000 ")],
    ["an extra blank line in the properties", "gradle/wrapper/gradle-wrapper.properties", (t) => t.replace("\n", "\n\n")],
    ["CRLF in the properties", "gradle/wrapper/gradle-wrapper.properties", (t) => t.replace(/\n/g, "\r\n")],
    ["a missing final newline", "gradle/wrapper/gradle-wrapper.properties", (t) => t.replace(/\n$/, "")],
  ];
  for (const [name, path, change] of variants) {
    it(`refuses ${name}`, () => {
      const next = change(lines(path));
      assert.notEqual(next, lines(path), "the variant changed nothing");
      fires({ ...real, files: { ...real.files, [path]: next } }, real, "build", /differs from its pinned bytes/, path);
    });
  }

  it("pins every wrapper text as read from disk", () => {
    for (const p of WRAPPER) assert.ok(real.files[p] !== undefined, p);
    assert.deepEqual(checkTree(real), []);
  });
});

describe("N9: counting brackets inside strings fails closed", () => {
  it("a lone ( in a string keeps the statement open, so the next line joins it", () => {
    assert.deepEqual(statements('val s = "("\nval t = 1'), ['val s = "(" val t = 1']);
    assert.deepEqual(statements('val s = "x"\nval t = 1'), ['val s = "x"', "val t = 1"]);
  });

  it("a pinned use site joined to a string with ( is no longer the pinned statement, and is refused", () => {
    const anchor = "    private val manager";
    fires(edit(READER, anchor, `    val s = "("\n${anchor}`), edit(READER, anchor, `    val s = "x"\n${anchor}`), "reflection", /outside the pinned use sites/, READER);
  });
});

describe("N10: every Kotlin source under the project is read and checked", () => {
  it("the loader reads every .kt and .kts path, core/src/test included", () => {
    const kotlin = real.paths.filter((p) => /\.kts?$/.test(p));
    assert.ok(kotlin.includes(CORE_TEST), "the core test source is a path of the tree");
    for (const p of kotlin) assert.ok(real.files[p] !== undefined, `${p} was not read`);
  });

  it("a violation in core/src/test is found", () => {
    fires(edit(CORE_TEST, "class SpotifyFilterTest", 'val u = java.net.URL("x")\nclass SpotifyFilterTest'), real, "network", undefined, CORE_TEST);
  });

  it("Kotlin in any other source set is refused, read or not; Kotlin under tools/ is refused when not read", () => {
    fires({ ...real, paths: [...real.paths, "tools/Evil.kt"] }, real, "sources", /did not read/, "tools/Evil.kt");
    for (const p of ["app/src/test/kotlin/org/x/Evil.kt", "app/src/debug/kotlin/Evil.kt", "extra/src/main/kotlin/Evil.kt"]) {
      for (const text of [undefined, "class Evil\n"]) {
        const files = text === undefined ? real.files : { ...real.files, [p]: text };
        fires({ ...real, paths: [...real.paths, p], files }, real, "sources", undefined, p);
      }
    }
  });

  it("Kotlin the loader did not read is refused, on an allowlisted path too", () => {
    const p = "core/src/test/kotlin/org/classbeat/spike/Unread.kt";
    fires({ ...real, paths: [...real.paths, p] }, real, "sources", /did not read/, p);
  });

  it("a script path the loader did not read is refused", () => {
    fires({ ...real, paths: [...real.paths, "app/extra.gradle.kts"] }, real, "sources", /did not read/, "app/extra.gradle.kts");
  });

  it("Kotlin with an unusual extension case is refused even when read", () => {
    const p = "app/src/main/kotlin/org/classbeat/spike/follower/Evil.KT";
    fires({ ...real, paths: [...real.paths, p], files: { ...real.files, [p]: "class Evil\n" } }, real, "sources", /did not read/, p);
  });
});

describe("NB-A: Intent, ComponentName and getSystemService are not declared or aliased", () => {
  const forms: [string, (n: string) => string][] = [
    ["class", (n) => `class ${n}(a: Any, val c: Class<*>)`],
    ["class with type parameters", (n) => `class ${n}<T>(a: Any, val c: Class<T>)`],
    ["object", (n) => `object ${n}`],
    ["interface", (n) => `interface ${n}`],
    ["typealias", (n) => `typealias ${n} = Pair<Any, Class<*>>`],
    ["typealias on a second line", (n) => `typealias\n${n} = Pair<Any, Class<*>>`],
    ["import alias", (n) => `import a.b.C as ${n}`],
  ];
  for (const name of ["Intent", "ComponentName", "getSystemService"]) {
    for (const [kind, code] of forms) {
      it(`refuses ${kind} ${name}`, () => {
        // The same declaration under another name (`Intents`) is accepted: only the guarded name is refused.
        fires(edit(READER, "class SpotifyReader", `${code(name)}\nclass SpotifyReader`), edit(READER, "class SpotifyReader", `${code(`${name}s`)}\nclass SpotifyReader`), "reflection", undefined, READER);
      });
    }
  }
});

describe("NB-B: the merged-manifest check cannot be switched off", () => {
  const words = ["enabled = false", "isEnabled = false", "setEnabled(false)", "onlyIf { false }", "setOnlyIf { false }"];
  for (const script of SCRIPTS) {
    for (const word of words) {
      it(`refuses \`${word}\` in ${script}`, () => {
        const text = real.files[script]!;
        const bad = { ...real, files: { ...real.files, [script]: `${text.trimEnd()}\ncheck.configure { ${word} }\n` } };
        const found = checkTree(bad);
        // The second layer names the word, and the whole-file pin refuses the script as well.
        assert.ok(found.some((x) => x.startsWith("manifest:") && x.includes(script) && x.includes("in the added line")), JSON.stringify(found));
        assert.ok(found.some((x) => x.startsWith("build:") && x.includes(script) && x.includes("differs from its pinned text")), JSON.stringify(found));
        assert.deepEqual(checkTree(real), [], "the script without the refused line is accepted");
      });
    }
  }
});

describe("NB-C: the second view finds what the stripped view cannot see", () => {
  // A block comment is gone from the stripped text but still in the raw text minus `//` lines.
  const hide = (code: string) => `/* ${code} */`;
  const note = hide("note");

  it("StatusBarNotification outside the listener", () => {
    fires(edit(READER, "class SpotifyReader", `${hide("fun f(s: StatusBarNotification) = s")}\nclass SpotifyReader`), edit(READER, "class SpotifyReader", `${note}\nclass SpotifyReader`), "notifications", /StatusBarNotification outside the listener/, READER);
  });

  it("a second notification listener", () => {
    fires(edit(READER, "class SpotifyReader", `${hide("class Other : NotificationListenerService()")}\nclass SpotifyReader`), edit(READER, "class SpotifyReader", `${note}\nclass SpotifyReader`), "listener", /exactly one listener/);
  });

  it("an empty-body count that differs", () => {
    fires(edit(LISTENER, "NotificationListenerService() {", `NotificationListenerService() {\n    ${hide("fun x() { 1 }")}`), edit(LISTENER, "NotificationListenerService() {", `NotificationListenerService() {\n    ${note}`), "listener", /empty body/, LISTENER);
  });

  it("a second Gradle wiring statement", () => {
    // The whole-file pin refuses any change to this script, so the good tree is the real one.
    const wiring = "        tasks.matching { it.name in guarded }";
    const bad = edit("app/build.gradle.kts", wiring, `        ${hide("tasks.matching { it.name in guarded }.configureEach { dependsOn(check) }")}\n${wiring}`);
    const found = checkTree(bad);
    assert.ok(found.some((x) => x.startsWith("manifest:") && /exactly one `tasks\.matching/.test(x)), JSON.stringify(found));
    assert.deepEqual(checkTree(real), []);
  });
});
