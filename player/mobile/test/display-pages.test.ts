// The external display's idle stage (issue #759, docs/design/app-room-display.md): the instructor's line
// in display.html and the rider's line in display-rider.html. The line is a fixed string chosen by the
// mode alone, so it can carry no rider data (plan rule 13).
import assert from "node:assert/strict";
import { test } from "node:test";
import { pageHtml } from "../src/page.ts";

const line = (html: string): string[] => [...html.matchAll(/<main class="idle"><span data-tier="text" data-lines="2">([^<]*)<\/span><\/main>/g)].map((m) => m[1]);

test("the instructor's idle page shows the instructor's line", () => {
  assert.deepEqual(line(pageHtml("display.html")), ["The class shows here when it opens on the phone"]);
});

test("the rider's idle page shows the rider's line, and only that", () => {
  assert.deepEqual(line(pageHtml("display-rider.html")), ["Your class is on your phone"]);
  assert.doesNotMatch(pageHtml("display-rider.html"), /The class shows here/);
});

test("both idle pages are the same stage: one line in the text tier, one shared script, no data", () => {
  for (const name of ["display.html", "display-rider.html"] as const) {
    const html = pageHtml(name);
    assert.match(html, /<link rel="stylesheet" href="display\.css">/, name);
    assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="display.js" defer>'], name);
    assert.doesNotMatch(html, /\$\{|data-(?!tier|lines)[a-z-]+=/, name);
  }
});
