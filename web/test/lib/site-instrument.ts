// The trap the website checks install in the page (site-fake.ts): it runs before the page's own
// script (Playwright's init script is not subject to the page's CSP), records what the checks need
// in `globalThis.__traps` and stands in for the passkey prompt. It is built from `kit`
// (site-trap-kit.ts: the record, and the built-ins captured at install so page code cannot blind
// it, #315) and calls `standIn` (site-passkey.ts) last. Playwright serialises the functions into
// the page as source text, so each is self-contained: it imports nothing and calls nothing from
// its module.
//
// A hook whose API is missing is recorded as `missing`, never skipped: the checks fail on it.
// Other realms (an iframe, a popup, a worker) are not instrumented here; the fake records every
// one the page opens, from the browser's side, and the checks require none (#293).
import type { Note, Passkey } from "./site-passkey.ts";
import type { Kit } from "./site-trap-kit.ts";

export type { Passkey };

export function instrument(mode: Passkey, kit: Kit, standIn: (mode: Passkey, note: Note) => void): void {
  const { apply, construct, own, define, S, note, str, strAt, lower, bare, starts, words, jsUrl, wrapWith, wrap, onGet, onSetWith, onSet } = kit;
  // Array.prototype.join's reading of a value: null and undefined are empty.
  const joined = (x: unknown): string => (x === null || x === undefined ? "" : S(x));
  for (const name of ["setItem", "getItem", "removeItem", "clear", "key"] as const) wrap(Storage.prototype, name, `Storage.${name}`, (_s, a) => note("storage", `${name} ${words(a, joined)}`));
  const cookie = own(Document.prototype, "cookie");
  const [cookieGet, cookieSet] = [cookie?.get, cookie?.set];
  if (!cookieGet || !cookieSet) note("missing", "Document.cookie");
  define(Document.prototype, "cookie", {
    get() { note("cookie", "read"); return cookieGet ? apply(cookieGet, this, []) : undefined; },
    set(v: unknown) { const c = str(v); note("cookie", `write ${c}`); if (cookieSet) apply(cookieSet, this, [c]); },
  });
  const idb = indexedDB.open.bind(indexedDB);
  indexedDB.open = ((n: string, v?: number) => { note("indexeddb", n); return idb(n, v); }) as typeof indexedDB.open;
  if (globalThis.caches) {
    const open = caches.open.bind(caches);
    caches.open = (n: string) => { note("cache", n); return open(n); };
  } else note("missing", "caches");
  for (const k of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
    console[k] = ((...a: unknown[]) => note("console", `${k} ${words(a, S)}`)) as never;
  }
  for (const k of ["pushState", "replaceState"] as const) wrap(History.prototype, k, `History.${k}`, (_s, a) => note("history", `${k} ${S(a[2] ?? "")}`));
  // Turning a string into markup, however the name was written (#260; ui/dom.ts sets text only).
  for (const [proto, prop] of [[Element.prototype, "innerHTML"], [Element.prototype, "outerHTML"], [ShadowRoot.prototype, "innerHTML"], [HTMLIFrameElement.prototype, "srcdoc"]] as const) {
    onSet(proto, prop, prop, () => note("markup", prop));
  }
  for (const [proto, name] of [[Element.prototype, "insertAdjacentHTML"], [Element.prototype, "setHTMLUnsafe"], [Element.prototype, "setHTML"], [ShadowRoot.prototype, "setHTMLUnsafe"], [ShadowRoot.prototype, "setHTML"], [Document.prototype, "write"], [Document.prototype, "writeln"], [Range.prototype, "createContextualFragment"], [DOMParser.prototype, "parseFromString"]] as const) {
    const label = proto === ShadowRoot.prototype ? `ShadowRoot.${name}` : name;
    wrap(proto, name, label, () => note("markup", label));
  }
  // Static Document.parseHTMLUnsafe / Document.parseHTML, and pasting markup into an editable part.
  for (const name of ["parseHTMLUnsafe", "parseHTML"] as const) wrap(Document, name, `Document.${name}`, () => note("markup", `Document.${name}`));
  wrapWith(Document.prototype, "execCommand", "execCommand", (_s, a) => {
    strAt(a, 0);
    if (a.length && lower(a[0] as string) === "inserthtml") note("markup", "execCommand insertHTML");
    return a;
  });
  // A response parsed as a document, and an XSLT transform's output (#307).
  onSetWith(XMLHttpRequest.prototype, "responseType", "XMLHttpRequest.responseType", (_s, v) => {
    const c = str(v);
    if (c === "document") note("markup", "XMLHttpRequest responseType document");
    return c;
  });
  onGet(XMLHttpRequest.prototype, "responseXML", "XMLHttpRequest.responseXML", () => note("markup", "XMLHttpRequest.responseXML"));
  const xslt = (globalThis as { XSLTProcessor?: { prototype: object } }).XSLTProcessor;
  for (const name of ["transformToFragment", "transformToDocument"] as const) {
    if (!xslt) note("missing", `XSLTProcessor.${name}`);
    else wrap(xslt.prototype, name, `XSLTProcessor.${name}`, () => note("markup", `XSLTProcessor.${name}`));
  }
  // An attribute that is markup (an iframe's srcdoc) or script (an on… event handler, or a
  // `javascript:` address in a URL attribute), on every way an attribute is written: by name, by
  // namespace, as an Attr node, or through the Attr (#293, #307). The address is read as the URL
  // parser reads it: C0 controls and spaces trimmed in front, tab and newline dropped, any case.
  // An attribute name, or a URL attribute's value, that is not a string is noted as well: the site
  // writes strings only, and an object is how a value that changes after its check gets in (#312).
  const isUrlAttr = (n: string): boolean => n === "src" || n === "href" || n === "action" || n === "formaction" || n === "data";
  /** Checks one attribute write, from the name and value as given (`raw…`) and as converted once. */
  const check = (route: string, rawName: unknown, name: string, rawValue: unknown, value: string): void => {
    if (typeof rawName !== "string") note("script", `${route} name not a string`);
    const n = bare(name);
    if (n === "srcdoc") note("markup", `${route} srcdoc`);
    else if (starts(n, "on")) note("script", `${route} ${n}`);
    else if (isUrlAttr(n)) {
      if (typeof rawValue !== "string") note("script", `${route} ${n} not a string`);
      if (jsUrl(value)) note("script", `${route} ${n} javascript:`);
    }
  };
  /** Checks a call naming the attribute at `ni` (its value at `vi`); returns the arguments converted once. */
  const attr = (route: string, a: unknown[], ni: number, vi = -1): unknown[] => {
    if (ni >= a.length) return a;
    const hasValue = vi >= 0 && vi < a.length;
    // Read by index: destructuring would go through the page's array iterator.
    const rawName = a[ni];
    const rawValue = hasValue ? a[vi] : "";
    strAt(a, ni, vi);
    check(route, rawName, a[ni] as string, rawValue, hasValue ? (a[vi] as string) : "");
    return a;
  };
  // An Attr's name and value, read through the native getters, so neither a property shadowing them
  // on the node nor a replaced `instanceof` hides them (#312); undefined for anything not an Attr.
  const nameGet = own(Attr.prototype, "name")?.get;
  const valueGet = own(Attr.prototype, "value")?.get;
  if (!nameGet || !valueGet) note("missing", "Attr.name or Attr.value");
  const attrOf = (x: unknown): [string, string] | undefined => {
    try {
      return nameGet && valueGet ? [str(apply(nameGet, x, [])), str(apply(valueGet, x, []))] : undefined;
    } catch {
      return undefined;
    }
  };
  const node = (route: string, x: unknown): void => {
    const nv = attrOf(x);
    if (nv) check(route, nv[0], nv[0], nv[1], nv[1]);
  };
  wrapWith(Element.prototype, "setAttribute", "setAttribute", (_s, a) => attr("setAttribute", a, 0, 1));
  wrapWith(Element.prototype, "toggleAttribute", "toggleAttribute", (_s, a) => attr("toggleAttribute", a, 0));
  wrapWith(Element.prototype, "setAttributeNS", "setAttributeNS", (_s, a) => attr("setAttributeNS", a, 1, 2));
  for (const name of ["setAttributeNode", "setAttributeNodeNS"] as const) wrap(Element.prototype, name, name, (_s, a) => node(name, a[0]));
  for (const name of ["setNamedItem", "setNamedItemNS"] as const) wrap(NamedNodeMap.prototype, name, name, (_s, a) => node(name, a[0]));
  const attrSet = (route: string, self: unknown, v: unknown, c: string): string => {
    const nv = attrOf(self);
    if (nv) check(route, nv[0], nv[0], v, c);
    return c;
  };
  onSetWith(Attr.prototype, "value", "Attr.value", (self, v) => attrSet("Attr.value", self, v, str(v)));
  for (const prop of ["nodeValue", "textContent"] as const) {
    // Nullable on a node: null and undefined are written as the empty string, as native code writes
    // them (#315), and that empty string is what is checked. Any node but an Attr is left alone.
    onSetWith(Node.prototype, prop, `Node.${prop}`, (self, v) => (attrOf(self) ? attrSet(`Attr.${prop}`, self, v, v === null || v === undefined ? "" : str(v)) : v));
  }
  // The same address written through an element's URL property, or an SVG link's href (#307).
  const urlProps: [string, string][] = [
    ["HTMLAnchorElement", "href"], ["HTMLAreaElement", "href"], ["HTMLLinkElement", "href"], ["HTMLBaseElement", "href"],
    ["HTMLIFrameElement", "src"], ["HTMLFrameElement", "src"], ["HTMLScriptElement", "src"], ["HTMLImageElement", "src"],
    ["HTMLEmbedElement", "src"], ["HTMLSourceElement", "src"], ["HTMLMediaElement", "src"], ["HTMLInputElement", "src"],
    ["HTMLTrackElement", "src"], ["HTMLObjectElement", "data"], ["HTMLFormElement", "action"], ["HTMLButtonElement", "formAction"],
    ["HTMLInputElement", "formAction"], ["SVGAnimatedString", "baseVal"],
  ];
  const proto = (type: string): object | undefined => (globalThis as unknown as Record<string, { prototype: object } | undefined>)[type]?.prototype;
  for (const [type, prop] of urlProps) {
    const label = `${type}.${prop}`;
    const p = proto(type);
    if (!p) note("missing", label);
    else onSetWith(p, prop, label, (_s, v) => {
      const c = str(v);
      if (typeof v !== "string") note("script", `${label} not a string`);
      if (jsUrl(c)) note("script", `${label} javascript:`);
      return c;
    });
  }
  // A link's address changed one part at a time, as in `a.href = "x:go()"; a.protocol = "javascript"`
  // (#312). After each part is written the whole address is read back through the native href
  // getter and checked, so no part, and no order of parts, leaves a `javascript:` address unseen.
  for (const type of ["HTMLAnchorElement", "HTMLAreaElement"]) {
    const p = proto(type);
    const href = p && own(p, "href")?.get;
    for (const part of ["protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash"]) {
      const label = `${type}.${part}`;
      const d = p && own(p, part);
      const set = d?.set;
      if (!p || !d || !set || !href) {
        note("missing", label);
        continue;
      }
      define(p, part, {
        ...d,
        set(this: unknown, v: unknown) {
          apply(set, this, [str(v)]);
          if (jsUrl(str(apply(href, this, [])))) note("script", `${label} javascript:`);
        },
      });
    }
  }
  // A popup's or a named frame's address (#315). The page's own address (location.href, assign,
  // replace) cannot be wrapped: those members are unforgeable, so the fake notes those navigations
  // from the browser's side (site-fake.ts). An absent address is passed on absent, as native code
  // takes it as the empty string. `document.open` with three or more arguments is the same call.
  const popup = (route: string, a: unknown[]): unknown[] => {
    if (!a.length || a[0] === undefined) return a;
    const raw = a[0];
    strAt(a, 0);
    if (typeof raw !== "string") note("script", `${route} not a string`);
    if (jsUrl(a[0] as string)) note("script", `${route} javascript:`);
    return a;
  };
  wrapWith(globalThis, "open", "window.open", (_s, a) => popup("window.open", a));
  wrapWith(Document.prototype, "open", "Document.open", (_s, a) => (a.length >= 3 ? popup("document.open", a) : a));
  // Realms the browser does not report to the fake: a shared worker and a service worker.
  for (const name of ["Worker", "SharedWorker"] as const) {
    const C = globalThis[name];
    if (typeof C !== "function") note("missing", name);
    else globalThis[name] = new Proxy(C, { construct: (t, a, nt) => (note("realm", `${name} ${S(a[0])}`), construct(t, a, nt)) }) as never;
  }
  wrap(ServiceWorkerContainer.prototype, "register", "ServiceWorkerContainer.register", (_s, a) => note("realm", `serviceWorker ${S(a[0])}`));
  // A CSP report, read through the native getters, on the window in the capture phase: no listener
  // of the page runs ahead of this one, so none can stop it.
  const csp = SecurityPolicyViolationEvent.prototype;
  const [directive, blocked] = [own(csp, "violatedDirective")?.get, own(csp, "blockedURI")?.get];
  if (!directive || !blocked) note("missing", "SecurityPolicyViolationEvent");
  else addEventListener("securitypolicyviolation", (e) => note("csp", `${S(apply(directive, e, []))} ${S(apply(blocked, e, []))}`), true);
  standIn(mode, note);
}
