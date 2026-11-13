// The trap the website checks install in the page (site-fake.ts): it runs before the page's own
// script (Playwright's init script is not subject to the page's CSP), records what the checks need
// in `globalThis.__traps` and stands in for the passkey prompt. Playwright serialises the function
// into the page, so it is self-contained: it imports nothing and calls nothing from this module.
//
// A hook whose API is missing is recorded as `missing`, never skipped: the checks fail on it.
// Other realms (an iframe, a popup, a worker) are not instrumented here; the fake records every
// one the page opens, from the browser's side, and the checks require none (#293).

export type Passkey = "ok" | "cancel" | "hold" | "absent";

export function instrument(mode: Passkey): void {
  type Trap = { kind: string; detail: string };
  type Fn = (this: unknown, ...a: unknown[]) => unknown;
  const traps: Trap[] = [];
  (globalThis as unknown as { __traps: Trap[] }).__traps = traps;
  const note = (kind: string, detail: unknown): void => {
    traps.push({ kind, detail: String(detail) });
  };
  const apply = Reflect.apply;
  /**
   * Converts a value to a string the way a DOMString argument is converted. Every route that checks
   * a value converts it once with this and passes that same string on, so an object whose toString
   * answers differently on a second call is written exactly as it was checked (#312).
   */
  const str = (v: unknown): string => {
    if (typeof v === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
    return String(v);
  };
  /** The arguments `a` with those at the positions `at` converted once; a missing one stays missing. */
  const strAt = (a: unknown[], ...at: number[]): unknown[] => a.map((x, i) => (at.includes(i) ? str(x) : x));
  /** Calls `check` ahead of every call of `owner[name]`, then the original with the arguments `check` returns. */
  const wrapWith = (owner: object, name: string, label: string, check: (self: unknown, a: unknown[]) => unknown[]): void => {
    const o = owner as Record<string, unknown>;
    const orig = o[name];
    if (typeof orig !== "function") return note("missing", label);
    o[name] = function (this: unknown, ...a: unknown[]) {
      return apply(orig as Fn, this, check(this, a));
    };
  };
  /** Calls `before` ahead of every call of `owner[name]`. */
  const wrap = (owner: object, name: string, label: string, before: (self: unknown, a: unknown[]) => void): void =>
    wrapWith(owner, name, label, (self, a) => {
      before(self, a);
      return a;
    });
  /** Calls `before` ahead of every read of the accessor `proto[prop]`; writing is unchanged. */
  const onGet = (proto: object, prop: string, label: string, before: (self: unknown) => void): void => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    const get = d?.get;
    if (!d || !get) return note("missing", label);
    Object.defineProperty(proto, prop, {
      ...d,
      get(this: unknown) {
        before(this);
        return apply(get, this, []);
      },
    });
  };
  /** Calls `check` ahead of every write of the accessor `proto[prop]` and writes the value it returns. */
  const onSetWith = (proto: object, prop: string, label: string, check: (self: unknown, v: unknown) => unknown): void => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    const set = d?.set;
    if (!d || !set) return note("missing", label);
    Object.defineProperty(proto, prop, {
      ...d,
      set(this: unknown, v: unknown) {
        apply(set, this, [check(this, v)]);
      },
    });
  };
  /** Calls `before` ahead of every write of the accessor `proto[prop]`; reading is unchanged. */
  const onSet = (proto: object, prop: string, label: string, before: (self: unknown, v: unknown) => void): void =>
    onSetWith(proto, prop, label, (self, v) => {
      before(self, v);
      return v;
    });
  for (const name of ["setItem", "getItem", "removeItem", "clear", "key"] as const) wrap(Storage.prototype, name, `Storage.${name}`, (_s, a) => note("storage", `${name} ${a.join(" ")}`));
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (!cookie?.get || !cookie.set) note("missing", "Document.cookie");
  Object.defineProperty(Document.prototype, "cookie", {
    get() { note("cookie", "read"); return cookie?.get?.call(this); },
    set(v: unknown) { const c = str(v); note("cookie", `write ${c}`); cookie?.set?.call(this, c); },
  });
  const idb = indexedDB.open.bind(indexedDB);
  indexedDB.open = ((n: string, v?: number) => { note("indexeddb", n); return idb(n, v); }) as typeof indexedDB.open;
  if (globalThis.caches) {
    const open = caches.open.bind(caches);
    caches.open = (n: string) => { note("cache", n); return open(n); };
  } else note("missing", "caches");
  for (const k of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
    console[k] = ((...a: unknown[]) => note("console", `${k} ${a.map(String).join(" ")}`)) as never;
  }
  for (const k of ["pushState", "replaceState"] as const) wrap(History.prototype, k, `History.${k}`, (_s, a) => note("history", `${k} ${String(a[2] ?? "")}`));
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
    const c = strAt(a, 0);
    if (c.length && (c[0] as string).toLowerCase() === "inserthtml") note("markup", "execCommand insertHTML");
    return c;
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
  const jsUrl = (s: string): boolean => {
    let i = 0;
    while (i < s.length && (s.charCodeAt(i) <= 0x20 || /\s/.test(s[i]))) i += 1;
    return /^javascript:/i.test(s.slice(i).replace(/[\t\n\r]/g, ""));
  };
  const URL_ATTRS = ["src", "href", "action", "formaction", "data"];
  /** Checks one attribute write, from the name and value as given (`raw…`) and as converted once. */
  const check = (route: string, rawName: unknown, name: string, rawValue: unknown, value: string): void => {
    if (typeof rawName !== "string") note("script", `${route} name not a string`);
    const n = name.toLowerCase().replace(/^[^:]*:/, "");
    if (n === "srcdoc") note("markup", `${route} srcdoc`);
    else if (n.startsWith("on")) note("script", `${route} ${n}`);
    else if (URL_ATTRS.includes(n)) {
      if (typeof rawValue !== "string") note("script", `${route} ${n} not a string`);
      if (jsUrl(value)) note("script", `${route} ${n} javascript:`);
    }
  };
  /** Checks a call naming the attribute at `at[0]` (its value at `at[1]`); returns the arguments converted once. */
  const attr = (route: string, a: unknown[], ...at: [number] | [number, number]): unknown[] => {
    const c = strAt(a, ...at);
    const [ni, vi] = at;
    const has = (i: number | undefined): i is number => i !== undefined && i < c.length;
    if (has(ni)) check(route, a[ni], c[ni] as string, has(vi) ? a[vi] : "", has(vi) ? (c[vi] as string) : "");
    return c;
  };
  // An Attr's name and value, read through the native getters, so neither a property shadowing them
  // on the node nor a replaced `instanceof` hides them (#312); undefined for anything not an Attr.
  const nameGet = Object.getOwnPropertyDescriptor(Attr.prototype, "name")?.get;
  const valueGet = Object.getOwnPropertyDescriptor(Attr.prototype, "value")?.get;
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
    // Nullable on a node: null is written as the empty string. Any node but an Attr is left alone.
    onSetWith(Node.prototype, prop, `Node.${prop}`, (self, v) => (attrOf(self) ? attrSet(`Attr.${prop}`, self, v, v === null ? "" : str(v)) : v));
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
    const href = p && Object.getOwnPropertyDescriptor(p, "href")?.get;
    for (const part of ["protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash"]) {
      const label = `${type}.${part}`;
      const d = p && Object.getOwnPropertyDescriptor(p, part);
      const set = d?.set;
      if (!p || !d || !set || !href) {
        note("missing", label);
        continue;
      }
      Object.defineProperty(p, part, {
        ...d,
        set(this: unknown, v: unknown) {
          apply(set, this, [str(v)]);
          if (jsUrl(str(apply(href, this, [])))) note("script", `${label} javascript:`);
        },
      });
    }
  }
  // Realms the browser does not report to the fake: a shared worker and a service worker.
  for (const name of ["Worker", "SharedWorker"] as const) {
    const C = globalThis[name];
    if (typeof C !== "function") note("missing", name);
    else globalThis[name] = new Proxy(C, { construct: (t, a, nt) => (note("realm", `${name} ${String(a[0])}`), Reflect.construct(t, a, nt)) }) as never;
  }
  wrap(ServiceWorkerContainer.prototype, "register", "ServiceWorkerContainer.register", (_s, a) => note("realm", `serviceWorker ${String(a[0])}`));
  document.addEventListener("securitypolicyviolation", (e) => note("csp", `${e.violatedDirective} ${e.blockedURI}`));
  // The passkey prompt.
  if (mode === "absent") {
    delete (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    return;
  }
  const bytes = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
  const get = (options?: CredentialRequestOptions): Promise<Credential | null> => {
    const pk = options?.publicKey;
    const challenge = pk ? new Uint8Array(pk.challenge as ArrayBuffer) : new Uint8Array();
    note("passkey", `get challenge=${[...challenge].join(",")} allow=${pk?.allowCredentials?.length ?? "none"} uv=${pk?.userVerification ?? ""} rp=${pk?.rpId ?? ""}`);
    if (mode === "hold") return new Promise(() => undefined);
    if (mode === "cancel") return Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));
    return Promise.resolve({
      id: "Y3JlZC0x",
      type: "public-key",
      rawId: bytes("cred-1"),
      authenticatorAttachment: "platform",
      response: { clientDataJSON: bytes('{"type":"webauthn.get"}'), authenticatorData: bytes("auth"), signature: bytes("sig"), userHandle: bytes("user") },
    } as unknown as Credential);
  };
  Object.defineProperty(navigator.credentials, "get", { value: get });
}
