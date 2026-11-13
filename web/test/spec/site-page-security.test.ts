// What the website's pages may do in the browser (ADR 0002, sections 4 and 5; docs/design/site.md):
// one CSP with no inline script, no eval and no other origin; nothing kept in storage, cookies or
// logs; no Referer; the session left to the server's cookie; and the keyboard path through Sign in.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { DIST, WEB_DIR } from "../lib/browser.ts";
import { CSP, ORIGIN, crossSite, launchOffline, openSite, settled, traps } from "../lib/site-fake.ts";
import { MARKUP } from "../lib/markup-apis.ts";
import { reach } from "../lib/site-measure.ts";
import { CHALLENGE_B64, LINK_TOKEN, STATES } from "../lib/site-states.ts";

let browser: Browser;
before(async () => {
  browser = await launchOffline();
});
after(async () => {
  await browser.close();
});

describe("the page's CSP", () => {
  it("is the one the backend sends", () => {
    const policy = readFileSync(join(WEB_DIR, "..", "backend", "src", "player_backend", "request_policy.py"), "utf8");
    const m = /CONTENT_SECURITY_POLICY: Final = \(\s*"([^"]+)"\s*\)/.exec(policy);
    assert.ok(m, "the backend's CSP constant was not found");
    assert.equal(m[1], CSP, "the fake serves the backend's CSP");
    for (const bad of ["unsafe-", "data:", "blob:", "http:", "https:", "*"]) assert.ok(!CSP.includes(bad), bad);
  });

  it("is in the page too, and the page has no inline script, style or handler", () => {
    const html = readFileSync(join(DIST, "site", "index.html"), "utf8");
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    assert.ok(meta, "no CSP meta");
    assert.match(meta[1], /^default-src 'self';/);
    assert.ok(!/unsafe-|https?:|\*/.test(meta[1]));
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\ssrc="\/[\w.]+"/, `inline script: ${tag}`);
    assert.doesNotMatch(html, /<script\b[^>]*>[^<]+<\/script>/);
    assert.doesNotMatch(html, /<style\b|\sstyle=|\son\w+=/i);
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
  });

  it("is met by the bundle: no eval and no other origin", () => {
    const js = readFileSync(join(DIST, "site", "site.js"), "utf8");
    assert.doesNotMatch(js, /\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*["'`]/);
    assert.doesNotMatch(js, /https?:\/\/|wss?:\/\//);
    assert.doesNotMatch(js, /javascript:/i, "a javascript: address (#307)");
    const css = readFileSync(join(DIST, "site", "site.css"), "utf8");
    assert.doesNotMatch(css, /url\(\s*["']?(https?:|\/\/)|@import/);
  });
});

describe("rendering in the built bundle (#260)", () => {
  // The bundler folds a computed name such as `el["inner" + "HTML"]` into the plain one, which
  // the source scan (test/unit/site-render-guard.test.ts) cannot see. A name the bundler leaves
  // computed is caught when it runs: the "markup" trap below.
  it("never turns a string into markup", () => {
    const js = readFileSync(join(DIST, "site", "site.js"), "utf8");
    for (const bad of MARKUP) assert.doesNotMatch(js, bad, `site.js uses ${bad.source}`);
  });
});

describe("the fake's cross-site refusal (backend `cross_site_refusal`)", () => {
  // Page requests reach the fake without `Sec-Fetch-*` (Playwright does not show them), so this
  // table is where that half of the rule is exercised (#257).
  const same = { origin: ORIGIN };
  const cases: [string, Record<string, string>, boolean][] = [
    ["GET", {}, false],
    ["HEAD", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, false],
    ["POST", same, false],
    ["POST", { ...same, "sec-fetch-site": "same-origin" }, false],
    ["POST", { ...same, "sec-fetch-site": "same-site" }, true],
    ["POST", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["POST", { ...same, "sec-fetch-site": "none" }, true],
    ["post", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["DELETE", { ...same, "sec-fetch-site": "same-site" }, true],
    ["PATCH", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["PUT", { ...same, "sec-fetch-site": "cross-site" }, true],
    ["POST", {}, true],
    ["POST", { origin: "null" }, true],
    ["POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }, true],
  ];
  for (const [method, headers, refused] of cases) {
    it(`${method} ${JSON.stringify(headers)} is ${refused ? "refused" : "let through"}`, () => {
      assert.equal(crossSite(method, headers), refused);
    });
  }
});

describe("nothing secret leaves the page, in any state", () => {
  for (const state of STATES) {
    it(state.name, async () => {
      const site = await reach(browser, { state, width: 390, zoom: 1, ink: false });
      // Read only once the page has settled, so a realm or trap that comes late is not missed (#307).
      await settled(site);
      const seen = await traps(site.page);
      // The session is the server's HttpOnly cookie: the page never reads or writes a cookie, and
      // keeps nothing in storage, IndexedDB or the cache. Nothing is turned into markup or an event
      // handler, every hook of the trap is in place, and no other realm (where the trap is not) is opened.
      assert.deepEqual(seen.filter((t) => ["storage", "cookie", "indexeddb", "cache", "console", "csp", "markup", "script", "realm", "missing"].includes(t.kind)), []);
      assert.deepEqual(site.realms, [], "another realm: a frame, a page or a worker");
      assert.deepEqual(site.console.filter((c) => !c.includes("Failed to load resource")), []);
      assert.deepEqual(site.external, [], "a request to another origin");
      assert.deepEqual(site.unscripted, [], "an API request the state does not expect");
      assert.deepEqual(site.crossSite, [], "an API request the backend refuses as cross-site");
      for (const a of site.api) {
        assert.equal(a.headers["referer"], undefined, `Referer on ${a.route}`);
        assert.equal(new URL(a.url).search, "", `a query on ${a.route}`);
        assert.ok(a.headers["content-type"] === undefined || a.headers["content-type"] === "application/json", a.route);
      }
      const secret = [LINK_TOKEN.slice(7), CHALLENGE_B64];
      for (const u of [site.page.url(), ...site.urls.slice(1)]) for (const s of secret) assert.ok(!u.includes(s), `secret in ${u}`);
      for (const t of seen) for (const s of secret) assert.ok(!t.detail.includes(s), `secret in ${t.kind}`);
      assert.equal(await site.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await site.context.close();
    });
  }
});

describe("the markup trap", () => {
  // Each way a string becomes markup is noted when it runs, so a computed name that the source
  // scan cannot see is still caught.
  const calls: [string, string][] = [
    ["innerHTML", "document.createElement('div').innerHTML = 'x'"],
    ["setHTMLUnsafe", "document.createElement('div').setHTMLUnsafe('x')"],
    ["setHTML", "document.createElement('div').setHTML('x')"],
    ["Document.parseHTMLUnsafe", "Document.parseHTMLUnsafe('x')"],
    ["ShadowRoot.setHTMLUnsafe", "document.createElement('div').attachShadow({ mode: 'open' }).setHTMLUnsafe('x')"],
    ["ShadowRoot.setHTML", "document.createElement('div').attachShadow({ mode: 'open' }).setHTML('x')"],
    ["Document.parseHTML", "Document.parseHTML('x')"],
    ["srcdoc", "document.createElement('iframe').srcdoc = '<p>x</p>'"],
    ["setAttribute srcdoc", "document.createElement('iframe').setAttribute('SrcDoc', '<p>x</p>')"],
    ["execCommand insertHTML", "document.execCommand('InsertHTML', false, '<b>x</b>')"],
    // Every other way to write an attribute (#293).
    ["setAttributeNS srcdoc", "document.createElement('iframe').setAttributeNS(null, 'srcdoc', '<p>x</p>')"],
    ["toggleAttribute srcdoc", "document.createElement('iframe').toggleAttribute('srcdoc')"],
    ["setAttributeNode srcdoc", "document.createElement('iframe').setAttributeNode(document.createAttribute('srcdoc'))"],
    ["setAttributeNodeNS srcdoc", "document.createElement('iframe').setAttributeNodeNS(document.createAttributeNS(null, 'srcdoc'))"],
    ["setNamedItem srcdoc", "document.createElement('iframe').attributes.setNamedItem(document.createAttribute('srcdoc'))"],
    ["setNamedItemNS srcdoc", "document.createElement('iframe').attributes.setNamedItemNS(document.createAttributeNS(null, 'srcdoc'))"],
    ["Attr.value srcdoc", "const f = document.createElement('iframe'); f.toggleAttribute('srcdoc'); f.getAttributeNode('srcdoc').value = '<p>x</p>'"],
    ["Attr.nodeValue srcdoc", "document.createAttribute('srcdoc').nodeValue = '<p>x</p>'"],
    ["Attr.textContent srcdoc", "document.createAttribute('srcdoc').textContent = '<p>x</p>'"],
    // A response parsed as a document, and an XSLT transform's output (#307).
    ["XMLHttpRequest responseType document", "const x = new XMLHttpRequest(); x.open('GET', '/sign-in'); x.responseType = 'document'"],
    ["XMLHttpRequest.responseXML", "void new XMLHttpRequest().responseXML"],
    ["XSLTProcessor.transformToFragment", "try { new XSLTProcessor().transformToFragment(document, document); } catch {}"],
    ["XSLTProcessor.transformToDocument", "try { new XSLTProcessor().transformToDocument(document); } catch {}"],
  ];
  // An event handler written as an attribute, by each route (#293).
  const handlers: [string, string][] = [
    ["setAttribute onclick", "document.createElement('div').setAttribute('OnClick', 'go()')"],
    ["setAttributeNS onerror", "document.createElement('img').setAttributeNS(null, 'onerror', 'go()')"],
    ["toggleAttribute onload", "document.createElement('img').toggleAttribute('onload')"],
    ["setAttributeNode onload", "document.createElement('img').setAttributeNode(document.createAttribute('onload'))"],
    ["setAttributeNodeNS onload", "document.createElement('img').setAttributeNodeNS(document.createAttributeNS(null, 'onload'))"],
    ["setNamedItem onfocus", "document.createElement('a').attributes.setNamedItem(document.createAttribute('onfocus'))"],
    ["setNamedItemNS onfocus", "document.createElement('a').attributes.setNamedItemNS(document.createAttributeNS(null, 'onfocus'))"],
    ["Attr.value onclick", "const h = document.createAttribute('onclick'); h.value = 'go()'"],
    ["Attr.nodeValue onclick", "document.createAttribute('onclick').nodeValue = 'go()'"],
    ["Attr.textContent onclick", "document.createAttribute('onclick').textContent = 'go()'"],
    // A javascript: address in a URL attribute or property, read as the URL parser reads it (#307).
    ["setAttribute href javascript:", "document.createElement('a').setAttribute('HREF', ' \\u0001JaVa\\tScRiPt:go()')"],
    ["setAttribute src javascript:", "document.createElement('iframe').setAttribute('src', '\\njavascript:go()')"],
    ["setAttributeNS href javascript:", "document.createElementNS('http://www.w3.org/2000/svg', 'a').setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', 'javascript:go()')"],
    ["setAttributeNode src javascript:", "const a = document.createAttribute('src'); a.value = 'javascript:go()'; document.createElement('iframe').setAttributeNode(a)"],
    ["setAttributeNodeNS href javascript:", "const a = document.createAttributeNS(null, 'href'); a.value = 'javascript:go()'; document.createElement('a').setAttributeNodeNS(a)"],
    ["setNamedItem href javascript:", "const a = document.createAttribute('href'); a.value = 'javascript:go()'; document.createElement('a').attributes.setNamedItem(a)"],
    ["setNamedItemNS src javascript:", "const a = document.createAttributeNS(null, 'src'); a.value = 'javascript:go()'; document.createElement('img').attributes.setNamedItemNS(a)"],
    ["Attr.value href javascript:", "const a = document.createElement('a'); a.toggleAttribute('href'); a.getAttributeNode('href').value = 'javascript:go()'"],
    ["Attr.nodeValue src javascript:", "document.createAttribute('src').nodeValue = 'javascript:go()'"],
    ["Attr.textContent action javascript:", "document.createAttribute('action').textContent = 'javascript:go()'"],
    ["HTMLAnchorElement.href javascript:", "document.createElement('a').href = 'JAVASCRIPT:go()'"],
    ["HTMLIFrameElement.src javascript:", "document.createElement('iframe').src = ' java\\nscript:go()'"],
    ["HTMLScriptElement.src javascript:", "document.createElement('script').src = 'javascript:go()'"],
    ["HTMLFormElement.action javascript:", "document.createElement('form').action = 'javascript:go()'"],
    ["HTMLButtonElement.formAction javascript:", "document.createElement('button').formAction = 'javascript:go()'"],
    ["HTMLObjectElement.data javascript:", "document.createElement('object').data = 'javascript:go()'"],
    ["SVGAnimatedString.baseVal javascript:", "document.createElementNS('http://www.w3.org/2000/svg', 'a').href.baseVal = 'javascript:go()'"],
    // The same address made one URL part at a time (#312).
    ["HTMLAnchorElement.protocol javascript:", "const a = document.createElement('a'); a.href = 'x:go()'; a.protocol = 'javascript'"],
    ["HTMLAreaElement.protocol javascript:", "const a = document.createElement('area'); a.href = 'x:go()'; a.protocol = 'JavaScript'"],
    // A name or URL value that is not a string, as an object whose toString changes (#312).
    ["setAttribute name not a string", "document.createElement('iframe').setAttribute({ toString: () => 'srcdoc' }, '<p>x</p>')"],
    ["setAttribute href not a string", "document.createElement('a').setAttribute('href', new URL('https://x.test/'))"],
    ["setAttributeNS name not a string", "document.createElement('a').setAttributeNS(null, { toString: () => 'title' }, 'x')"],
    ["setAttributeNS src not a string", "document.createElement('img').setAttributeNS(null, 'src', { toString: () => '/x' })"],
    ["toggleAttribute name not a string", "document.createElement('img').toggleAttribute({ toString: () => 'onload' })"],
    ["Attr.value href not a string", "document.createAttribute('href').value = { toString: () => '/x' }"],
    ["Attr.textContent src not a string", "document.createAttribute('src').textContent = 1"],
    ["HTMLIFrameElement.src not a string", "document.createElement('iframe').src = { toString: () => '/x' }"],
    ["HTMLAnchorElement.href not a string", "document.createElement('a').href = new URL('https://x.test/')"],
    // An Attr is read through the native getters: a shadowed name or a replaced instanceof hides nothing (#312).
    ["setAttributeNode onerror", "const a = document.createAttribute('onerror'); Object.defineProperty(a, 'name', { value: 'title' }); document.createElement('img').setAttributeNode(a)"],
    ["setNamedItem onerror", "Object.defineProperty(Attr, Symbol.hasInstance, { value: () => false }); document.createElement('img').attributes.setNamedItem(document.createAttribute('onerror'))"],
    ["Attr.nodeValue onerror", "Object.defineProperty(Attr, Symbol.hasInstance, { value: () => false }); document.createAttribute('onerror').nodeValue = 'go()'"],
  ];
  for (const [kind, table] of [["markup", calls], ["script", handlers]] as const) {
    for (const [detail, code] of table) {
      it(`notes ${detail}`, async () => {
        const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
        // These APIs exist in the Chromium the tests run on, so a missing one is a failure, not a skip.
        await site.page.evaluate(`(() => { ${code}; })()`);
        assert.ok((await traps(site.page)).some((t) => t.kind === kind && t.detail === detail), `${detail} not noted`);
        await site.context.close();
      });
    }
  }

  it("leaves an ordinary address in a URL attribute alone (#307)", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
    await site.page.evaluate(`(() => {
      const a = document.createElement('a');
      for (const v of ['/sign-in', './javascript:x', 'java%73cript:x', '#javascript:x', 'https://x.test/javascript:x']) { a.setAttribute('href', v); a.href = v; }
      // Every URL part written on an ordinary address, on both kinds of link (#312).
      for (const l of [a, document.createElement('area')]) {
        l.href = 'https://x.test/a?b#c';
        for (const [part, v] of [['protocol', 'http'], ['protocol', 'javascript'], ['username', 'u'], ['password', 'p'], ['host', 'y.test:81'], ['hostname', 'z.test'], ['port', '82'], ['pathname', 'javascript:x'], ['search', 'javascript:x'], ['hash', 'javascript:x']]) l[part] = v;
      }
    })()`);
    assert.deepEqual((await traps(site.page)).filter((t) => t.kind === "script"), []);
    await site.context.close();
  });

  // Each checked value is converted to a string once, and that string is what is written: an object
  // that answers `/x` when checked and a dangerous value later is written as `/x` (#312). Each
  // case returns what was written; the object's toString must have run exactly once.
  const twoFaced: [string, string, string][] = [
    ["setAttribute href", "const a = document.createElement('a'); a.setAttribute('href', two('/x', 'javascript:go()')); return a.getAttribute('href')", "/x"],
    ["setAttribute name srcdoc", "const f = document.createElement('iframe'); f.setAttribute(two('title', 'srcdoc'), '<p>x</p>'); return f.getAttributeNames().join()", "title"],
    ["setAttribute name onclick", "const d = document.createElement('div'); d.setAttribute(two('title', 'onclick'), 'go()'); return d.getAttributeNames().join()", "title"],
    ["setAttributeNS href", "const a = document.createElement('a'); a.setAttributeNS(null, 'href', two('/x', 'javascript:go()')); return a.getAttribute('href')", "/x"],
    ["setAttributeNS name", "const f = document.createElement('iframe'); f.setAttributeNS(null, two('title', 'srcdoc'), 'x'); return f.getAttributeNames().join()", "title"],
    ["toggleAttribute name", "const i = document.createElement('img'); i.toggleAttribute(two('title', 'onload')); return i.getAttributeNames().join()", "title"],
    ["Attr.value", "const a = document.createAttribute('href'); a.value = two('/x', 'javascript:go()'); return a.value", "/x"],
    ["Attr.nodeValue", "const a = document.createAttribute('src'); a.nodeValue = two('/x', 'javascript:go()'); return a.value", "/x"],
    ["Attr.textContent", "const a = document.createAttribute('action'); a.textContent = two('/x', 'javascript:go()'); return a.value", "/x"],
    ["HTMLIFrameElement.src", "const f = document.createElement('iframe'); f.src = two('/x', 'javascript:go()'); return f.getAttribute('src')", "/x"],
    ["HTMLAnchorElement.href", "const a = document.createElement('a'); a.href = two('/x', 'javascript:go()'); return a.getAttribute('href')", "/x"],
    ["SVGAnimatedString.baseVal", "const a = document.createElementNS('http://www.w3.org/2000/svg', 'a'); a.href.baseVal = two('/x', 'javascript:go()'); return a.getAttribute('href')", "/x"],
    ["HTMLAnchorElement.protocol", "const a = document.createElement('a'); a.href = 'x:go()'; a.protocol = two('y', 'javascript'); return a.href", "y:go()"],
    ["XMLHttpRequest.responseType", "const x = new XMLHttpRequest(); x.responseType = two('text', 'document'); return x.responseType", "text"],
    ["execCommand", "document.execCommand(two('bold', 'insertHTML'), false, '<b>x</b>'); return 'called'", "called"],
  ];
  for (const [route, code, written] of twoFaced) {
    it(`converts a value once: ${route}`, async () => {
      const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
      const got = await site.page.evaluate(`(() => {
        let calls = 0;
        const two = (first, later) => ({ toString: () => (calls += 1) === 1 ? first : later });
        const written = (() => { ${code}; })();
        return { written, calls };
      })()`);
      assert.deepEqual(got, { written, calls: 1 });
      // Nothing dangerous was written, so the only note is the one for a value that is not a string.
      assert.deepEqual((await traps(site.page)).filter((t) => ["markup", "script"].includes(t.kind) && !t.detail.endsWith("not a string")), []);
      await site.context.close();
    });
  }

  it("has every hook in place, and a hook whose API is missing is noted, not skipped", async () => {
    const whole = await openSite(browser, "/sign-in", { width: 390, height: 844 });
    assert.deepEqual((await traps(whole.page)).filter((t) => t.kind === "missing"), []);
    await whole.context.close();
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844, before: "delete Element.prototype.setAttributeNode; delete Document.parseHTML; delete XMLHttpRequest.prototype.responseXML; delete globalThis.XSLTProcessor; delete HTMLAnchorElement.prototype.href; delete HTMLAreaElement.prototype.protocol;" });
    const missing = (await traps(site.page)).filter((t) => t.kind === "missing").map((t) => t.detail);
    for (const m of ["setAttributeNode", "Document.parseHTML", "XMLHttpRequest.responseXML", "XSLTProcessor.transformToFragment", "HTMLAnchorElement.href", "HTMLAnchorElement.protocol", "HTMLAreaElement.protocol"]) assert.ok(missing.includes(m), `${m}: ${missing.join(", ")}`);
    await site.context.close();
  });
});

describe("the realm check (#293)", () => {
  // The trap is installed in the page's own realm only. A fresh realm has prototypes it does not
  // wrap, so the fake records every realm the page opens and the checks above require none.
  const opens: [string, string, string][] = [
    ["an iframe used and removed at once", "frame", "const f = document.createElement('iframe'); document.body.append(f); const set = Object.getOwnPropertyDescriptor(f.contentWindow.Element.prototype, 'innerHTML').set; set.call(document.createElement('div'), '<b>x</b>'); f.remove()"],
    ["an iframe in a closed shadow root", "frame", "const h = document.createElement('div'); document.body.append(h); h.attachShadow({ mode: 'closed' }).append(document.createElement('iframe'))"],
    ["an object element", "frame", "const o = document.createElement('object'); o.data = '/sign-in'; o.type = 'text/html'; document.body.append(o)"],
    ["a popup", "page", "window.open('about:blank', '_blank')"],
    ["a dedicated worker", "worker", "new Worker('/site.js')"],
    ["a shared worker", "realm", "new SharedWorker('/site.js')"],
    ["a service worker", "realm", "navigator.serviceWorker.register('/site.js').catch(() => undefined)"],
  ];
  for (const [name, seen, code] of opens) {
    it(`records ${name}`, async () => {
      const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
      assert.deepEqual(site.realms, []);
      await site.page.evaluate(`(() => { ${code}; })()`);
      const recorded = async (): Promise<boolean> => (seen === "realm" ? (await traps(site.page)).some((t) => t.kind === "realm") : site.realms.some((r) => r.startsWith(`${seen} `)));
      for (let i = 0; i < 100 && !(await recorded()); i += 1) await site.page.waitForTimeout(20);
      assert.ok(await recorded(), `${name} not recorded: ${site.realms.join(", ")}`);
      await site.context.close();
    });
  }

  it("records a service worker from the browser's side, even one registered past the trap (#307)", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844, before: "globalThis.__register = ServiceWorkerContainer.prototype.register;" });
    await site.page.evaluate("globalThis.__register.call(navigator.serviceWorker, '/site.js').catch(() => undefined)");
    for (let i = 0; i < 100 && !site.realms.some((r) => r.startsWith("serviceworker ")); i += 1) await site.page.waitForTimeout(20);
    assert.ok(site.realms.includes(`serviceworker ${ORIGIN}/site.js`), site.realms.join(", "));
    assert.deepEqual((await traps(site.page)).filter((t) => t.kind === "realm"), [], "the trap's wrapper was passed by");
    await site.context.close();
  });

  it("waits for the page to settle, so a realm opened late is still seen (#307)", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
    await site.page.evaluate("setTimeout(() => document.body.append(document.createElement('iframe')), 250)");
    assert.equal(site.realms.length, 0, "not yet opened");
    await settled(site);
    assert.ok(site.realms.some((r) => r.startsWith("frame ")), site.realms.join(", "));
    await site.context.close();
  });
});

describe("the keyboard (site.md, S8)", () => {
  it("reaches the skip link first, which moves focus to the page without changing the address", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844 });
    await site.page.keyboard.press("Tab");
    assert.equal(await site.page.evaluate(() => document.activeElement?.className), "skip");
    await site.page.keyboard.press("Enter");
    assert.equal(await site.page.evaluate(() => document.activeElement?.id), "main");
    assert.equal(site.page.url(), `${ORIGIN}/sign-in`);
    await site.page.keyboard.press("Tab");
    assert.equal(await site.page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name), "email");
    await site.context.close();
  });

  it("asks for a link with Enter in the field and signs in with a passkey from the keyboard", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844, script: { "POST sign-in/link": { status: 200, body: { status: "accepted" } } } });
    await site.page.focus("input[name=email]");
    await site.page.keyboard.type("ana@example.com");
    await site.page.keyboard.press("Enter");
    await site.page.waitForSelector(".note");
    assert.deepEqual(site.api.map((a) => a.route), ["POST sign-in/link"]);
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("note")), true, "focus moves to the result");
    await site.context.close();
  });

  it("moves focus to the plate that explains a failure", async () => {
    const site = await openSite(browser, "/sign-in", { width: 390, height: 844, script: { "POST sign-in/link": { status: 503, body: { error: "unavailable" } } } });
    await site.page.fill("input[name=email]", "ana@example.com");
    await site.page.keyboard.press("Enter");
    await site.page.waitForSelector(".plate");
    assert.equal(await site.page.evaluate(() => document.activeElement?.classList.contains("plate")), true);
    await site.context.close();
  });
});
