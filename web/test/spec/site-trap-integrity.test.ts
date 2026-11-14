// The site trap itself (site-trap-kit.ts, site-instrument.ts): page code cannot blind its record or
// change a verdict by replacing a built-in, an Attr written with undefined gets what native code
// writes, and a `javascript:` address given to a navigation is noted (#315). The sinks the trap
// notes are listed in site-page-security.test.ts.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { launchOffline, openSite, traps } from "../lib/site-fake.ts";
import type { FakeSite, Trap } from "../lib/site-fake.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

const open = (): Promise<FakeSite> => openSite(browser, "/sign-in", { width: 390, height: 844 });
const has = (seen: Trap[], kind: string, detail: string): boolean => seen.some((t) => t.kind === kind && t.detail === detail);

/** Waits up to two seconds for `detail` to be noted, as a note from the browser's side comes late. */
async function noted(site: FakeSite, kind: string, detail: string): Promise<boolean> {
  for (let i = 0; i < 100; i += 1) {
    if (has(await traps(site.page), kind, detail)) return true;
    await site.page.waitForTimeout(20);
  }
  return false;
}

describe("the trap's record", () => {
  it("is a frozen reader that cannot be written, redefined or deleted", async () => {
    const site = await open();
    const d = await site.page.evaluate(() => {
      const p = Object.getOwnPropertyDescriptor(window, "__traps");
      return { type: typeof p?.value, writable: p?.writable, configurable: p?.configurable, frozen: Object.isFrozen(p?.value) };
    });
    assert.deepEqual(d, { type: "function", writable: false, configurable: false, frozen: true });
    await site.context.close();
  });

  // Each attempt runs between two sinks: neither note may be lost, nor the record replaced.
  const blinds: [string, string][] = [
    ["assigning an empty list", "globalThis.__traps = []"],
    ["assigning another reader", "globalThis.__traps = () => '[]'"],
    ["emptying it", "__traps.length = 0"],
    ["redefining it", "Object.defineProperty(globalThis, '__traps', { value: () => '[]' })"],
    ["deleting it", "delete globalThis.__traps"],
    ["replacing globalThis", "globalThis = { __traps: () => '[]' }"],
    ["a setter on an index of every array and object", "for (const p of [Array.prototype, Object.prototype]) for (const i of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) Object.defineProperty(p, i, { set() {}, configurable: true })"],
    ["replacing push, String and JSON.stringify", "Array.prototype.push = () => 0; String = () => ''; JSON.stringify = () => '\"\"'"],
    ["replacing Reflect.apply, call and apply", "Reflect.apply = () => undefined; Function.prototype.call = () => undefined; Function.prototype.apply = () => undefined"],
  ];
  for (const [name, code] of blinds) {
    it(`keeps every note after ${name}`, async () => {
      const site = await open();
      await site.page.evaluate(`(() => {
        const saved = [globalThis, Array.prototype.push, String, JSON.stringify, Reflect.apply, Function.prototype.call, Function.prototype.apply];
        document.createElement('div').setAttribute('onclick', 'go()');
        try { ${code}; } catch {}
        document.createElement('div').setAttribute('onmouseover', 'go()');
        for (const p of [Array.prototype, Object.prototype]) for (let i = 0; i < 10; i += 1) delete p[i];
        globalThis = saved[0];
        [Array.prototype.push, String, JSON.stringify, Reflect.apply, Function.prototype.call, Function.prototype.apply] = saved.slice(1);
      })()`);
      const seen = await traps(site.page);
      assert.ok(has(seen, "script", "setAttribute onclick"), "the note before was lost");
      assert.ok(has(seen, "script", "setAttribute onmouseover"), "the note after was not made");
      await site.context.close();
    });
  }
});

describe("the trap's built-ins", () => {
  // Page code replaces every RegExp, String, Array and Function method the trap could use with one
  // that answers "nothing here", then uses each kind of sink; the originals come back afterwards.
  // The harness itself records and restores by index only, so its own replaced methods (push, the
  // array iterator) do not stop it putting every original back.
  const tamper = `
    const S = String.prototype, R = RegExp.prototype, A = Array.prototype, F = Function.prototype;
    const AI = Object.getPrototypeOf([][Symbol.iterator]());
    const was = [];
    let n = 0;
    const put = (o, k, v) => { was[n] = { o, k, d: Object.getOwnPropertyDescriptor(o, k) }; n += 1; Object.defineProperty(o, k, { value: v, writable: true, configurable: true }); };
    put(R, 'test', () => false); put(R, 'exec', () => null); put(R, Symbol.replace, () => 'title'); put(R, Symbol.match, () => null);
    for (const k of ['toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'replace', 'replaceAll', 'slice', 'substring']) put(S, k, () => 'title');
    put(S, 'startsWith', () => false); put(S, 'includes', () => false); put(S, 'indexOf', () => -1); put(S, 'charCodeAt', () => 0x41);
    put(A, 'includes', () => false); put(A, 'some', () => false); put(A, 'map', () => []); put(A, 'join', () => ''); put(A, 'push', () => 0);
    put(F, 'call', () => undefined); put(F, 'apply', () => undefined); put(F, 'bind', () => () => undefined);
    // Destructuring, spread and for-of read arrays through these two.
    put(A, Symbol.iterator, function* () { yield 'title'; yield '/x'; });
    put(AI, 'next', () => ({ done: true, value: undefined }));
    const restore = () => { for (let i = n - 1; i >= 0; i -= 1) Object.defineProperty(was[i].o, was[i].k, was[i].d); };`;
  const sinks: [string, string, string][] = [
    ["script", "HTMLAnchorElement.href javascript:", "document.createElement('a').href = ' JaVa\\tScRiPt:go()'"],
    ["script", "setAttribute href javascript:", "document.createElement('a').setAttribute('HREF', 'javascript:go()')"],
    ["script", "setAttribute onclick", "document.createElement('div').setAttribute('OnClick', 'go()')"],
    ["script", "setAttributeNS href javascript:", "document.createElementNS('http://www.w3.org/2000/svg', 'a').setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'javascript:go()')"],
    ["script", "HTMLAnchorElement.protocol javascript:", "const a = document.createElement('a'); a.href = 'x:go()'; a.protocol = 'javascript'"],
    ["script", "Attr.nodeValue onclick", "document.createAttribute('onclick').nodeValue = 'go()'"],
    ["markup", "setAttribute srcdoc", "document.createElement('iframe').setAttribute('SrcDoc', '<p>x</p>')"],
    ["markup", "execCommand insertHTML", "document.execCommand('InsertHTML', false, '<b>x</b>')"],
    ["markup", "innerHTML", "document.createElement('div')['inner' + 'HTML'] = 'x'"],
    ["storage", "setItem a b", "localStorage.setItem('a', 'b'); localStorage.removeItem('a')"],
    // A value that is not a string, read by index: the array iterator does not hide it.
    ["script", "setAttribute href not a string", "document.createElement('a').setAttribute('href', { toString: () => 'https://x.test/' })"],
    ["script", "setAttribute name not a string", "document.createElement('div').setAttribute({ toString: () => 'title' }, 'x')"],
    ["script", "setAttributeNS src not a string", "document.createElement('img').setAttributeNS(null, 'src', { toString: () => '/x' })"],
    ["script", "HTMLIFrameElement.src not a string", "document.createElement('iframe').src = { toString: () => '/x' }"],
    ["script", "document.open javascript:", "document.open('javascript:go()', '_blank', '')"],
  ];
  for (const [kind, detail, code] of sinks) {
    it(`still notes ${detail} with every method replaced`, async () => {
      const site = await open();
      await site.page.evaluate(`(() => { ${tamper}
        try { ${code}; } finally { restore(); }
      })()`);
      assert.ok(has(await traps(site.page), kind, detail), `${detail} not noted`);
      await site.context.close();
    });
  }
});

describe("an Attr written with undefined (native parity)", () => {
  it("is written as the empty string, as native code writes it, and that string is checked", async () => {
    const site = await open();
    const written = await site.page.evaluate(() => {
      const out: string[] = [];
      for (const prop of ["nodeValue", "textContent"] as const) {
        for (const v of [undefined, null]) {
          const a = document.createAttribute("title");
          (a as unknown as Record<string, unknown>)[prop] = v;
          out.push(a.value);
        }
      }
      (document.createAttribute("onclick") as unknown as { nodeValue: unknown }).nodeValue = undefined;
      (document.createAttribute("href") as unknown as { textContent: unknown }).textContent = undefined;
      return out;
    });
    assert.deepEqual(written, ["", "", "", ""]);
    const seen = await traps(site.page);
    assert.ok(has(seen, "script", "Attr.nodeValue onclick"), "an event handler written with undefined");
    assert.ok(has(seen, "script", "Attr.textContent href not a string"), "a URL attribute written with undefined");
    assert.ok(!seen.some((t) => t.kind === "script" && t.detail.endsWith("javascript:")));
    await site.context.close();
  });
});

describe("a navigation to a javascript: address (#315)", () => {
  const navigations: [string, string][] = [
    ["navigation javascript:", "location.assign('javascript:go()')"],
    ["navigation javascript:", "location.replace(' JaVa\\tScRiPt:go()')"],
    ["navigation javascript:", "location.href = '\\u0001javascript:go()'"],
    ["navigation javascript:", "document.location = 'JAVASCRIPT:go()'"],
    ["window.open javascript:", "window.open('javascript:go()')"],
    ["window.open javascript:", "window.open(' \\nJavaScript:go()', '_self')"],
    ["window.open not a string", "window.open({ toString: () => 'about:blank' }, '_blank')"],
    // document.open with three arguments is window.open (#315 review).
    ["document.open javascript:", "document.open('javascript:go()', '_blank', '')"],
    ["document.open javascript:", "document.open(' JavaScript:go()', '_self', '')"],
    ["document.open not a string", "document.open({ toString: () => 'about:blank' }, '_blank', '')"],
  ];
  for (const [detail, code] of navigations) {
    it(`notes ${detail}: ${code}`, async () => {
      const site = await open();
      await site.page.evaluate(`(() => { ${code}; })()`);
      assert.ok(await noted(site, "script", detail), `${detail} not noted`);
      await site.context.close();
    });
  }

  it("is noted even after the page replaces every RegExp and String method", async () => {
    const site = await open();
    await site.page.evaluate(`(() => {
      RegExp.prototype.test = () => false; RegExp.prototype.exec = () => null; String.prototype.toLowerCase = () => 'about:blank';
      window.open('javascript:go()');
      location.assign('javascript:go()');
    })()`);
    assert.ok(await noted(site, "script", "window.open javascript:"));
    assert.ok(await noted(site, "script", "navigation javascript:"));
    await site.context.close();
  });

  it("leaves an ordinary address alone", async () => {
    const site = await open();
    await site.page.evaluate(`(() => {
      location.hash = 'javascript:x';
      location.assign('#javascript:x');
      window.open('/sign-in#javascript:x', 'n');
      window.open();
      document.open('/sign-in#javascript:x', 'm', '');
    })()`);
    await site.page.waitForTimeout(300);
    assert.deepEqual((await traps(site.page)).filter((t) => t.kind === "script"), []);
    await site.context.close();
  });
});

describe("the CSP note", () => {
  // The trap listens on the window in the capture phase, ahead of every listener of the page, and
  // reads the report through the getters it captured (#315 review).
  it("is made even when page listeners stop the report and its getters are replaced", async () => {
    const site = await open();
    await site.page.evaluate(`(() => {
      const stop = (e) => e.stopImmediatePropagation();
      for (const t of [window, document, document.documentElement, document.body]) for (const capture of [true, false]) t.addEventListener('securitypolicyviolation', stop, capture);
      for (const k of ['violatedDirective', 'blockedURI']) Object.defineProperty(SecurityPolicyViolationEvent.prototype, k, { get: () => 'nothing', configurable: true });
      const s = document.createElement('script');
      s.textContent = 'void 0';
      document.body.append(s);
    })()`);
    assert.ok(await noted(site, "csp", "script-src-elem inline"), JSON.stringify((await traps(site.page)).filter((t) => t.kind === "csp")));
    await site.context.close();
  });
});
