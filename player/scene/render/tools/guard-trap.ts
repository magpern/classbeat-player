// The runtime trap of the browser run (layer 3 of three: lint, the page's content-security policy,
// this). Installed before any page script runs, it records a violation, and blocks the call, when
// the page tries to play media, reach the network, send a beacon, open a socket, create a media,
// image, script, frame, link or source element, or set a `src` or one of the loading attributes.
// It also records every `securitypolicyviolation` event. The run fails on any violation, and
// `selfTest` shows the trap and the policy firing on the Reviewer's bypass.
import type { Page } from "playwright-core";

export const TRAP = `(() => {
  const violations = [];
  window.__violations = violations;
  const record = (what) => violations.push(what);
  const block = (what) => () => { record(what); throw new Error("blocked: " + what); };
  const TAGS = /^(audio|video|img|image|script|iframe|frame|embed|object|link|source|track)$/i;
  HTMLMediaElement.prototype.play = block("HTMLMediaElement.play");
  window.fetch = block("fetch");
  XMLHttpRequest.prototype.open = block("XMLHttpRequest.open");
  Navigator.prototype.sendBeacon = block("navigator.sendBeacon");
  window.WebSocket = function () { block("WebSocket")(); };
  window.EventSource = function () { block("EventSource")(); };
  window.Image = function () { block("new Image")(); };
  window.Audio = function () { block("new Audio")(); };
  window.FontFace = function () { block("new FontFace")(); };
  window.SpeechSynthesisUtterance = function () { block("new SpeechSynthesisUtterance")(); };
  if (window.SpeechSynthesis) SpeechSynthesis.prototype.speak = block("speechSynthesis.speak");
  Range.prototype.createContextualFragment = block("Range.createContextualFragment");
  DOMParser.prototype.parseFromString = block("DOMParser.parseFromString");
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) { if (TAGS.test(String(tag))) block("createElement(" + tag + ")")(); return create.call(this, tag, ...rest); };
  const createNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function (ns, tag, ...rest) { if (TAGS.test(String(tag))) block("createElementNS(" + tag + ")")(); return createNS.call(this, ns, tag, ...rest); };
  for (const C of [HTMLImageElement, HTMLMediaElement, HTMLScriptElement, HTMLIFrameElement, HTMLSourceElement, HTMLEmbedElement, HTMLTrackElement]) {
    const d = Object.getOwnPropertyDescriptor(C.prototype, "src");
    if (d) Object.defineProperty(C.prototype, "src", { ...d, set: block(C.name + ".src") });
  }
  const set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (/^(src|srcset|srcdoc|href|autoplay|data)$/i.test(String(name)) && this !== document.documentElement) block("setAttribute(" + name + ")")();
    return set.call(this, name, value);
  };
  document.addEventListener("securitypolicyviolation", (e) => record("csp: " + e.violatedDirective + " " + e.blockedURI));
})();`;

/** Install the trap on a page, before it loads. */
export async function install(page: Page): Promise<void> {
  await page.addInitScript(TRAP);
}

/** The violations the page recorded (empty on a clean run). */
export async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? ["the trap was not installed"]);
}

/** Show the trap and the policy firing on the Reviewer's bypass; returns what was recorded. */
export async function selfTest(page: Page): Promise<string[]> {
  await page.evaluate(() => {
    const tries: (() => unknown)[] = [
      () => { const a = document.createElement("audio"); a.setAttribute("autoplay", ""); },
      () => document.createElement("div").setAttribute("autoplay", ""),
      () => { const a = new window.Audio("https://example.invalid/a.mp3"); void a.play(); },
      () => { new window.Image().src = "https://example.invalid/x.png"; },
      () => fetch("https://example.invalid"),
      () => navigator.sendBeacon("https://example.invalid", "x"),
      () => new WebSocket("wss://example.invalid"),
      () => new XMLHttpRequest().open("GET", "https://example.invalid"),
      () => speechSynthesis.speak(new SpeechSynthesisUtterance("go")),
      () => new FontFace("f", "url(https://example.invalid/f.woff2)").load(),
      () => new Range().createContextualFragment("<img src=https://example.invalid/x.png>"),
      () => document.createElement("script"),
      () => document.createElement("iframe"),
    ];
    for (const t of tries) { try { t(); } catch { /* the trap throws; the record is what counts */ } }
    // The parser, not a script, makes this image: only the content-security policy can stop it.
    const div = document.body.appendChild(document.createElement("div"));
    div.style.backgroundImage = "url(https://example.invalid/bg.png)"; // a style, not a script: only the policy can stop it
    div.innerHTML = '<img src="https://example.invalid/parsed.png">';
  });
  await page.waitForTimeout(300);
  return violations(page);
}
