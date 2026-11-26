// The rule guards' TypeScript, CSS and markup lexer (ts-lex.ts, issue #861): real comments out,
// every string, template and regular expression kept whole.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cssSource, jsSource, markupSource } from "./ts-lex.ts";

test("jsSource takes out line and block comments, and keeps the code around them", () => {
  assert.equal(jsSource("a(); // fetch(u)\nb();"), "a(); \nb();");
  assert.equal(jsSource("a(/* fetch(u) */1);"), "a( 1);");
  assert.equal(jsSource("x = 1;/* never closed"), "x = 1; ");
  // A comment after ":" is a comment (code() keeps it, taking it for an address).
  assert.equal(jsSource("const o = { a:// fetch(u)\n1 };"), "const o = { a:\n1 };");
});

test("jsSource keeps strings whole, so a comment marker in one hides nothing after it", () => {
  for (const s of ['const s = "//"; fetch(u);', "const s = '//'; fetch(u);", 'const s = "/*"; fetch(u); const t = "*/";', 'const s = "a\\"//"; fetch(u);', "const u = \"https://x\";"]) {
    assert.equal(jsSource(s), s, s);
  }
  // A string ends at its line: an unclosed quote hides no more than that line.
  assert.equal(jsSource("const s = \"abc\nfetch(u); // x"), "const s = \"abc\nfetch(u); ");
});

test("jsSource keeps template literals, and lexes the code in their placeholders", () => {
  assert.equal(jsSource("const s = `//${a /* x */ + `/*${b}`}`; fetch(u);"), "const s = `//${a   + `/*${b}`}`; fetch(u);");
  assert.equal(jsSource("const s = `${{ a: 1 }.a}//`; fetch(u); // c"), "const s = `${{ a: 1 }.a}//`; fetch(u); ");
});

test("jsSource keeps regular expressions whole, and tells them from division", () => {
  for (const s of ["const re = /\\/\\//; fetch(u);", 'const re = /["\']room["\']/; fetch(u);', "const re = /[/]/; fetch(u);", "if (/a\\/\\/b/.test(s)) fetch(u);", "return /\\/*/.test(s);"]) {
    assert.equal(jsSource(s), s, s);
  }
  assert.equal(jsSource("const x = a / b; // c / d"), "const x = a / b; ");
  assert.equal(jsSource("const x = f(a) / 2 / g[1] / 3; // c"), "const x = f(a) / 2 / g[1] / 3; ");
});

test("cssSource takes out comments and keeps strings whole", () => {
  assert.equal(cssSource("a { color: red; /* animation: x */ }"), "a { color: red;   }");
  assert.equal(cssSource('a::before { content: "/*"; animation: run 1s; } b { content: "*/"; }'), 'a::before { content: "/*"; animation: run 1s; } b { content: "*/"; }');
});

test("markupSource takes out only <!-- --> comments: // and /* are text in a page", () => {
  assert.equal(markupSource('<a href="https://x">//</a><!-- <audio> --><p>/* */</p>'), '<a href="https://x">//</a> <p>/* */</p>');
});
