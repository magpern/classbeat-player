// The notification listener stays empty (ADR 0011 §6, issue #632): Android grants a follower its
// view of the music app only through notification access, and the app uses that access for nothing
// else. These checks read the phone shell's Kotlin, main and test sources alike: one listener,
// with no body; no read of a notification anywhere; no notification object outside the listener.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "android",
  "app",
  "src",
);
const LISTENER = join(
  "main",
  "kotlin",
  "org",
  "classbeat",
  "player",
  "follow",
  "FollowListener.kt",
);

interface Source {
  readonly path: string;
  readonly text: string;
}

function kotlin(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return kotlin(p);
    return /\.(kt|kts|java)$/.test(e.name)
      ? [{ path: relative(SRC, p), text: readFileSync(p, "utf8") }]
      : [];
  });
}

/** The source without comments and string literals (a test may name the listener's action). */
const bare = (t: string): string =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"/g, '""');

/** The code without comments, strings, package and import lines. */
const code = (t: string): string =>
  bare(t)
    .replace(/^\s*(package|import)\s.*$/gm, "")
    .trim();

/** Anything that reads, keeps or acts on a notification or its ranking. */
const NOTIFICATION_READ =
  /getActiveNotifications|activeNotifications|\.notification\b|\.extras\b|tickerText|EXTRA_TITLE|EXTRA_TEXT|EXTRA_BIG_TEXT|snoozeNotification|cancelNotification|currentRanking|getCurrentRanking|getNotification\b/;
const LISTENS =
  /:\s*(android\.service\.notification\.)?NotificationListenerService\s*\(/;
const EMPTY_LISTENER =
  /^class FollowListener : NotificationListenerService\(\)$/;

/** The problems in [sources], one line each; empty when the listener rules hold. */
function problems(sources: readonly Source[]): string[] {
  const found: string[] = [];
  const listeners = sources.filter((s) => LISTENS.test(code(s.text)));
  if (listeners.length !== 1 || listeners[0].path !== LISTENER)
    found.push(
      `listeners: ${listeners.map((s) => s.path).join(", ") || "none"}`,
    );
  const listener = sources.find((s) => s.path === LISTENER);
  if (!listener || !EMPTY_LISTENER.test(code(listener.text)))
    found.push("the listener is not empty");
  for (const s of sources) {
    const c = code(s.text);
    if (NOTIFICATION_READ.test(c))
      found.push(`${s.path}: reads a notification`);
    if (/\bStatusBarNotification\b|\bRankingMap\b/.test(c))
      found.push(`${s.path}: holds a notification`);
    if (
      s.path !== LISTENER &&
      /\bandroid\.service\.notification\b/.test(bare(s.text))
    )
      found.push(`${s.path}: uses the notification service`);
  }
  return found;
}

const sources = kotlin(SRC);

test("there is Kotlin to check, the listener among it", () => {
  assert.ok(sources.some((s) => s.path === LISTENER));
  assert.ok(sources.some((s) => s.path.startsWith(`test${sep}`)));
  assert.ok(sources.length > 30);
});

test("one notification listener, empty, and no read of a notification anywhere in the phone shell's Kotlin", () => {
  assert.deepEqual(problems(sources), []);
});

test("the guard fails on a listener that reads a notification, and on every other way in", () => {
  const listener = sources.find((s) => s.path === LISTENER)!;
  const other = join(
    "main",
    "kotlin",
    "org",
    "classbeat",
    "player",
    "follow",
    "Other.kt",
  );
  const swap = (text: string): Source[] =>
    sources.map((s) => (s.path === LISTENER ? { ...s, text } : s));
  const add = (text: string): Source[] => [...sources, { path: other, text }];
  const reads = [
    "override fun onNotificationPosted(sbn: StatusBarNotification) { val t = sbn.notification.extras }",
    "override fun onListenerConnected() { activeNotifications.forEach { } }",
    "override fun onListenerConnected() { getActiveNotifications() }",
    "override fun onListenerConnected() { val r = currentRanking }",
    "override fun onNotificationPosted(sbn: StatusBarNotification) { cancelNotification(sbn.key) }",
  ];
  for (const body of reads) {
    const mutated = listener.text.replace(
      "NotificationListenerService()",
      `NotificationListenerService() {\n    ${body}\n}`,
    );
    assert.notEqual(mutated, listener.text);
    const found = problems(swap(mutated));
    assert.ok(found.includes("the listener is not empty"), body);
    assert.ok(
      found.some(
        (f) =>
          f.includes("reads a notification") ||
          f.includes("holds a notification"),
      ),
      body,
    );
  }
  // An empty override has no effect today, but the listener stays without a body all the same.
  assert.ok(
    problems(
      swap(
        listener.text.replace(
          "NotificationListenerService()",
          "NotificationListenerService() {\n    override fun onListenerConnected() {}\n}",
        ),
      ),
    ).includes("the listener is not empty"),
  );
  assert.ok(
    problems(add("class Second : NotificationListenerService()"))[0].startsWith(
      "listeners:",
    ),
  );
  assert.ok(
    problems(
      add(
        "class Second : android.service.notification.NotificationListenerService()",
      ),
    )[0].startsWith("listeners:"),
  );
  assert.deepEqual(problems(add("fun f(s: StatusBarNotification) = s.key")), [
    `${other}: holds a notification`,
  ]);
  assert.deepEqual(problems(add("fun f(n: Any) = n.extras")), [
    `${other}: reads a notification`,
  ]);
  assert.deepEqual(
    problems(
      add(
        "import android.service.notification.StatusBarNotification\nfun f() = 1",
      ),
    ),
    [`${other}: uses the notification service`],
  );
  assert.deepEqual(problems(sources.filter((s) => s.path !== LISTENER)), [
    "listeners: none",
    "the listener is not empty",
  ]);
  // Comments and strings are not code.
  assert.deepEqual(
    problems(
      add(
        "// sbn.notification.extras and getActiveNotifications are never read\nfun f() = 1",
      ),
    ),
    [],
  );
  assert.deepEqual(
    problems(
      add(
        'val action = "android.service.notification.NotificationListenerService"',
      ),
    ),
    [],
  );
});
