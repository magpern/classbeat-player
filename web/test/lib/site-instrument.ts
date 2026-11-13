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
  /** Calls `before` ahead of every call of `owner[name]`. */
  const wrap = (owner: object, name: string, label: string, before: (self: unknown, a: unknown[]) => void): void => {
    const o = owner as Record<string, unknown>;
    const orig = o[name];
    if (typeof orig !== "function") return note("missing", label);
    o[name] = function (this: unknown, ...a: unknown[]) {
      before(this, a);
      return (orig as Fn).apply(this, a);
    };
  };
  /** Calls `before` ahead of every read of the accessor `proto[prop]`; writing is unchanged. */
  const onGet = (proto: object, prop: string, label: string, before: (self: unknown) => void): void => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    const get = d?.get;
    if (!d || !get) return note("missing", label);
    Object.defineProperty(proto, prop, {
      ...d,
      get(this: unknown) {
        before(this);
        return get.call(this);
      },
    });
  };
  /** Calls `before` ahead of every write of the accessor `proto[prop]`; reading is unchanged. */
  const onSet = (proto: object, prop: string, label: string, before: (self: unknown, v: unknown) => void): void => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    const set = d?.set;
    if (!d || !set) return note("missing", label);
    Object.defineProperty(proto, prop, {
      ...d,
      set(this: unknown, v: unknown) {
        before(this, v);
        set.call(this, v);
      },
    });
  };
  for (const name of ["setItem", "getItem", "removeItem", "clear", "key"] as const) wrap(Storage.prototype, name, `Storage.${name}`, (_s, a) => note("storage", `${name} ${a.join(" ")}`));
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (!cookie?.get || !cookie.set) note("missing", "Document.cookie");
  Object.defineProperty(Document.prototype, "cookie", {
    get() { note("cookie", "read"); return cookie?.get?.call(this); },
    set(v: string) { note("cookie", `write ${v}`); cookie?.set?.call(this, v); },
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
  wrap(Document.prototype, "execCommand", "execCommand", (_s, a) => {
    if (String(a[0]).toLowerCase() === "inserthtml") note("markup", "execCommand insertHTML");
  });
  // A response parsed as a document, and an XSLT transform's output (#307).
  onSet(XMLHttpRequest.prototype, "responseType", "XMLHttpRequest.responseType", (_s, v) => {
    if (String(v) === "document") note("markup", "XMLHttpRequest responseType document");
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
  const jsUrl = (v: unknown): boolean => {
    const s = String(v);
    let i = 0;
    while (i < s.length && (s.charCodeAt(i) <= 0x20 || /\s/.test(s[i]))) i += 1;
    return /^javascript:/i.test(s.slice(i).replace(/[\t\n\r]/g, ""));
  };
  const URL_ATTRS = ["src", "href", "action", "formaction", "data"];
  const attr = (route: string, name: unknown, value: unknown): void => {
    const n = String(name).toLowerCase().replace(/^[^:]*:/, "");
    if (n === "srcdoc") note("markup", `${route} srcdoc`);
    else if (n.startsWith("on")) note("script", `${route} ${n}`);
    else if (URL_ATTRS.includes(n) && jsUrl(value)) note("script", `${route} ${n} javascript:`);
  };
  const attrName = (a: unknown): unknown => (a instanceof Attr ? a.name : a);
  const attrValue = (a: unknown): unknown => (a instanceof Attr ? a.value : "");
  wrap(Element.prototype, "setAttribute", "setAttribute", (_s, a) => attr("setAttribute", a[0], a[1]));
  wrap(Element.prototype, "toggleAttribute", "toggleAttribute", (_s, a) => attr("toggleAttribute", a[0], ""));
  wrap(Element.prototype, "setAttributeNS", "setAttributeNS", (_s, a) => attr("setAttributeNS", a[1], a[2]));
  for (const name of ["setAttributeNode", "setAttributeNodeNS"] as const) wrap(Element.prototype, name, name, (_s, a) => attr(name, attrName(a[0]), attrValue(a[0])));
  for (const name of ["setNamedItem", "setNamedItemNS"] as const) wrap(NamedNodeMap.prototype, name, name, (_s, a) => attr(name, attrName(a[0]), attrValue(a[0])));
  onSet(Attr.prototype, "value", "Attr.value", (self, v) => attr("Attr.value", attrName(self), v));
  for (const prop of ["nodeValue", "textContent"] as const) {
    onSet(Node.prototype, prop, `Node.${prop}`, (self, v) => {
      if (self instanceof Attr) attr(`Attr.${prop}`, self.name, v);
    });
  }
  // The same address written through an element's URL property, or an SVG link's href (#307).
  const urlProps: [string, string][] = [
    ["HTMLAnchorElement", "href"], ["HTMLAreaElement", "href"], ["HTMLLinkElement", "href"], ["HTMLBaseElement", "href"],
    ["HTMLIFrameElement", "src"], ["HTMLFrameElement", "src"], ["HTMLScriptElement", "src"], ["HTMLImageElement", "src"],
    ["HTMLEmbedElement", "src"], ["HTMLSourceElement", "src"], ["HTMLMediaElement", "src"], ["HTMLInputElement", "src"],
    ["HTMLTrackElement", "src"], ["HTMLObjectElement", "data"], ["HTMLFormElement", "action"], ["HTMLButtonElement", "formAction"],
    ["HTMLInputElement", "formAction"], ["SVGAnimatedString", "baseVal"],
  ];
  for (const [type, prop] of urlProps) {
    const label = `${type}.${prop}`;
    const C = (globalThis as unknown as Record<string, { prototype: object } | undefined>)[type];
    if (!C) note("missing", label);
    else onSet(C.prototype, prop, label, (_s, v) => {
      if (jsUrl(v)) note("script", `${label} javascript:`);
    });
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
