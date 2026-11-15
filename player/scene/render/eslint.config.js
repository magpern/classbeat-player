import js from "@eslint/js";
import globalsPackage from "globals";
import tseslint from "typescript-eslint";
import { definedGlobals } from "./tools/defined-globals.js";

// Allowlists, not blocklists (rule guards). Three layers close the scene's page off by construction:
// this file (lint), the content-security policy of demo/index.html and the runtime trap of
// tools/shots.ts. `test/source-fences.test.ts` shows each lint fence firing.
//
// 1. three.js: the drawing modules may import only these names. No audio class and no loader is on
//    it, so the dependency's own audio and network classes cannot be reached.
export const THREE_ALLOWED = [
  "AdditiveBlending", "CircleGeometry", "Color", "ConeGeometry", "DoubleSide", "Group", "InstancedMesh", "Mesh", "MeshBasicMaterial",
  "Object3D", "PerspectiveCamera", "PlaneGeometry", "Quaternion", "Scene", "ShaderMaterial", "Vector3",
];
// guard/ (the run-time check of the render callbacks) also reads `Material`, to recognise a material held by any field.
export const THREE_GUARD_ALLOWED = [...THREE_ALLOWED, "Material"];
// The demo (the host) alone builds the three.js renderer and hands it to src/ (src/host.ts).
export const THREE_DEMO_ALLOWED = [...THREE_ALLOWED, "WebGLRenderer"];
// 2. The DOM: `document` is not reachable from src/ at all, and `window` only by these members.
export const WINDOW_ALLOWED = ["innerWidth", "innerHeight", "devicePixelRatio", "requestAnimationFrame", "cancelAnimationFrame", "addEventListener", "removeEventListener"];
// The demo page may also read its own canvas and the computed style, and publish its test API.
export const DEMO_WINDOW_ALLOWED = [...WINDOW_ALLOWED, "__scene"];
export const DEMO_DOCUMENT_ALLOWED = ["getElementById", "documentElement"];

// 3. src/ is handed everything it touches (src/host.ts) and reads no browser global at all: `no-undef`
//    with exactly these names, ECMAScript built-ins and TypeScript's utility types. No `window`,
//    `document`, `navigator`, `fetch`, `Image`, `Audio`, `Range`, `FontFace`, `speechSynthesis`,
//    `globalThis` or `self` is defined there, so any use is an error, whatever its name. Widening
//    this list is a reviewed change; `test/source-fences.test.ts` holds its own copy.
export const SRC_BUILTINS = [
  "Object", "Array", "Number", "String", "Boolean", "Math", "JSON", "Error", "TypeError", "RangeError", "Map", "Set",
  "parseFloat", "parseInt", "isNaN", "isFinite", "Infinity", "NaN", "undefined",
];
// TypeScript's utility types are types only (no value exists to reach).
export const SRC_TYPES = [
  "Readonly", "ReadonlyArray", "ReadonlyMap", "ReadonlySet", "Record", "Pick", "Omit", "Partial", "Required", "ReturnType", "Parameters",
  "NonNullable", "Exclude", "Extract", "Awaited", "Iterable", "ArrayLike",
];
export const SRC_GLOBALS = [...SRC_BUILTINS, ...SRC_TYPES];
// ESLint defines more than the ES built-ins in every scope (`conf/globals.js`: `Temporal`, `constructor`,
// `toString`, `valueOf`, `hasOwnProperty` ...), so `no-undef` cannot close them and no list of ours can
// know them. They are read from ESLint itself (tools/defined-globals.js, the global scope of an empty
// module) together with the `globals` package's built-ins, and every one that is not on SRC_BUILTINS
// is restricted: a built-in a new ESLint or ECMAScript adds is refused by default. That covers
// Function, Reflect, Proxy, globalThis, eval, Date, Temporal and the rest. A name that is no built-in
// at all (WebAssembly) is an undefined global. `Object` and `Error` are further limited below.
export const SRC_BUILTINS_RESTRICTED = [...new Set([...definedGlobals(), ...Object.keys(globalsPackage.builtin)])].filter((name) => !SRC_BUILTINS.includes(name)).sort();
export const OBJECT_MEMBERS_ALLOWED = ["entries", "fromEntries", "keys", "values", "freeze"];
// `Error` and its subclasses are only built (`new Error(...)`) or named as a type: no `captureStackTrace`, no `prepareStackTrace`.
export const ERROR_CLASSES = ["Error", "TypeError", "RangeError"];

const alt = (names) => names.join("|");
// Globals the scene never needs: network, storage, workers, audio, images, randomness, the global
// object and every other way to the window or the document.
const BANNED_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "Worker", "SharedWorker",
  "localStorage", "sessionStorage", "indexedDB", "caches", "crypto", "navigator", "globalThis", "self", "top", "parent", "frames", "opener",
  "AudioContext", "webkitAudioContext", "Audio", "Image", "Option", "importScripts", "DOMParser", "HTMLAudioElement", "HTMLMediaElement",
  "HTMLImageElement", "HTMLScriptElement", "HTMLIFrameElement", "HTMLLinkElement", "HTMLSourceElement", "HTMLVideoElement"];
const globals = (names, message) => ["error", ...names.map((name) => ({ name, message }))];

// Property names that load, play, write or send: banned wherever they are read, called or assigned.
const BAD_PROPS = "sendBeacon|play|cookie|getRandomValues|randomUUID|createElement|createElementNS|createRange|ownerDocument|write|writeln|innerHTML|outerHTML|insertAdjacentHTML|insertAdjacentElement|appendChild|append|prepend|replaceWith|setAttribute|setAttributeNS|src|srcset|srcdoc|href|autoplay|open|postMessage";
const identifierAllowedAsObject = (name, members) => `Identifier[name='${name}']:not(MemberExpression[computed=false][object.name='${name}'][property.name=/^(${alt(members)})$/] > Identifier.object)`;

const common = [
  { selector: "ImportExpression", message: "No dynamic import: every import is static and checked." },
  { selector: `MemberExpression[computed=false][property.name=/^(${BAD_PROPS})$/]`, message: "No beacon, playback, element creation, markup, src, href, cookie or crypto randomness." },
  { selector: `MemberExpression[computed=true][property.type='Literal'][property.value=/^(${BAD_PROPS})$/]`, message: "No beacon, playback, element creation, markup, src, href, cookie or crypto randomness." },
  { selector: "ImportDeclaration[source.value=/^three\\//]", message: "Import from \"three\" only, by the names on the allowlist." },
  { selector: "ImportDeclaration[source.value='three'] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)", message: "Import named three.js classes from the allowlist only." },
  { selector: "CallExpression[callee.property.name=/^(add|remove)EventListener$/][callee.object.name='window']:not([arguments.0.value='resize'])", message: "The window's only listener is for resize." },
];
const RENDER_CALLBACKS = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"];
const REFLECTION_NAMES = ["__proto__", "prototype", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", ...RENDER_CALLBACKS, "getRootNode", "ownerDocument", "defaultView", "parentNode", "domElement"];
const REFLECTION_PROPS = alt(REFLECTION_NAMES);
// guard/ checks `prototype` and the five callbacks, so it alone may name them; every other reflection name stays banned there.
const GUARD_REFLECTION_PROPS = alt(REFLECTION_NAMES.filter((n) => n !== "prototype" && !RENDER_CALLBACKS.includes(n)));
export const GUARD_OBJECT_MEMBERS_ALLOWED = [...OBJECT_MEMBERS_ALLOWED, "getPrototypeOf"];
const LITERAL_KEYS_ONLY = "MemberExpression[computed=true]:not([property.type='Literal'])";
// The syntax fences of a directory that reads three.js and nothing of the page. src/ bans every reflection name; guard/ takes the same
// rules minus `prototype` and the five callback names, with `getPrototypeOf` on top of the Object members. Both read members by a
// literal key only: guard/ reads the five callbacks as explicit member accesses, never `x[name]` (any binding of `name` can be built at run time).
const scriptSyntax = (where, reflectionProps, objectMembers, computedKey) => ["error", ...common,
  // src/ is handed the host's painter (src/host.ts) and never reaches for the renderer's element or the page through it or through three.js callbacks.
  { selector: `MemberExpression[computed=false][property.name=/^(${reflectionProps})$/]`, message: `No prototype access, render callback, element or page member in ${where}.` },
  { selector: `MemberExpression[computed=true][property.type='Literal'][property.value=/^(${reflectionProps})$/]`, message: `No prototype access, render callback, element or page member in ${where}.` },
  { selector: `Identifier[name=/^(${alt(ERROR_CLASSES)})$/]:not(:matches(NewExpression, CallExpression) > Identifier.callee, TSTypeReference > Identifier)`, message: `${where} only builds an Error (\`new Error(...)\`); it takes no member of it (no captureStackTrace, no prepareStackTrace).` },
  { selector: identifierAllowedAsObject("Object", objectMembers), message: `${where} uses Object only by ${objectMembers.join(", ")} (no further reflection: no getOwnPropertyDescriptor, defineProperty, setPrototypeOf).` },
  // No route to the global object or the page by building a name at run time: `constructor` (reaches `Function`), and any computed key that is not a literal.
  { selector: "MemberExpression[computed=false][property.name='constructor']", message: `No \`constructor\` member in ${where} (it reaches Function and the global object).` },
  { selector: "MemberExpression[computed=true][property.type='Literal'][property.value='constructor']", message: `No \`constructor\` member in ${where} (it reaches Function and the global object).` },
  // Every destructuring key (nested patterns and parameters too) is a plain identifier, and its name faces the same bans as a member access.
  { selector: "ObjectPattern > Property:not([computed=false][key.type='Identifier'])", message: `${where} destructures by a plain identifier key only (no string or computed key).` },
  { selector: `ObjectPattern > Property[key.name=/^(constructor|${reflectionProps})$/]`, message: `No \`constructor\`, prototype, render callback, element or page member in ${where}, destructured or not.` },
  // A subclass of a three.js class can declare a render callback as a method, which no member access shows.
  { selector: ":matches(ClassDeclaration, ClassExpression)[superClass]", message: `${where} declares no class with a superclass (a subclass method can be a three.js render callback).` },
  { selector: computedKey, message: `${where} reads members by a literal key only: a key built at run time can name any member (use .at(i), a destructure or a lookup helper).` },
  { selector: identifierAllowedAsObject("window", WINDOW_ALLOWED), message: `${where} reaches the window only by ${WINDOW_ALLOWED.join(", ")}.` },
];
const srcSyntax = scriptSyntax("src/", REFLECTION_PROPS, OBJECT_MEMBERS_ALLOWED, LITERAL_KEYS_ONLY);
// The strings "constructor" and "__proto__" are not guard/ data either: no key spelled out for a lookup.
const guardSyntax = [...scriptSyntax("guard/", GUARD_REFLECTION_PROPS, GUARD_OBJECT_MEMBERS_ALLOWED, LITERAL_KEYS_ONLY),
  { selector: "Literal[value=/^(constructor|__proto__)$/]", message: "guard/ holds no string that names `constructor` or `__proto__`." }];
const demoSyntax = ["error", ...common,
  { selector: identifierAllowedAsObject("window", DEMO_WINDOW_ALLOWED), message: `The demo reaches the window only by ${DEMO_WINDOW_ALLOWED.join(", ")}.` },
  { selector: identifierAllowedAsObject("document", DEMO_DOCUMENT_ALLOWED), message: `The demo reaches the document only by ${DEMO_DOCUMENT_ALLOWED.join(", ")}.` },
  { selector: identifierAllowedAsObject("location", ["search"]), message: "The demo reads location.search and nothing else." },
];

// 4. The text layer (layer/) is the one place that builds DOM nodes, and it is closed the same way: a node is a `div` or a
//    `span` (a literal), set by text, class and style; no markup, no `src`, no link, no `setAttribute`; the document only by
//    `getElementById` and `createElement`; no three.js. `test/layer-fences.test.ts` shows each fence firing.
export const LAYER_DOCUMENT_ALLOWED = ["getElementById", "createElement"];
export const LAYER_TAGS = ["div", "span"];
// The one element the layer may find: its own root. It never reaches the scene's canvas or anything else.
export const LAYER_ROOT_ID = "text";
// Allowlist of globals (ECMAScript built-ins and utility types as in src/, plus the two page objects, each limited by member
// below, and the one DOM type the layer names). Every other name, `Range`, `Document`, `Reflect`, `Function`..., is undefined or restricted.
export const LAYER_GLOBALS = [...SRC_GLOBALS, "document", "window", "HTMLElement"];
// Allowlist of every member name the layer's code reads, calls or sets: the DOM members it uses on its own nodes, and the names of
// the view it is handed. A member not on it (setHTMLUnsafe, attachShadow, replaceChildren, cssText, createContextualFragment,
// parseHTMLUnsafe, construct ...) is refused; adding one is a reviewed change, and test/layer-fences.test.ts holds its own copy.
// `value` is there for the view's own field (MetricView.value); no DOM node that has one (an Attr, an input) is reachable, because
// `attributes`, `children`, `parent*`, `*Sibling`, `firstChild`, `ownerDocument` and `getRootNode` are not on this list.
export const LAYER_MEMBERS_ALLOWED = [
  "alert", "appendChild", "at", "bars", "block", "blocks", "bottom", "boxes", "build", "cached",
  "chip", "className", "clip", "clips", "clock", "compact", "count", "createElement", "cue", "cueLines", "cycleVw", "detail", "done", "end", "endX",
  "estimated", "flatMap", "fold", "folded", "forEach", "from", "gel", "getBoundingClientRect", "getElementById", "height", "hidden", "ink",
  "innerHeight", "innerWidth", "intervals", "join", "kind", "label", "layout", "left", "leftVw", "len", "length", "line", "link", "look", "map", "marks",
  "max", "metrics", "moments", "name", "nameSmall", "next", "nextKey", "note", "now", "nowX", "num", "number", "numeral", "offsetVw", "parts", "pattern", "pause",
  "pauseLine", "paused", "phrases", "push", "rail", "reduced", "right", "root", "row", "score", "seg", "segment", "side", "signature", "sizeVh", "slice",
  "small", "songs", "spec", "squares", "state", "strip", "targets", "text", "textContent", "textLeft", "textRight", "then", "ticks", "time", "title", "to",
  "top", "total", "ts", "txt", "unit", "up", "update", "updateClock", "updateGel", "updateMetrics", "updateNext", "updatePattern", "updateRail",
  "use", "val", "value", "width", "word", "x", "x0", "x1", "zone", "zoneName", "invalidate",
];
// What dom-kit.ts alone may also use: the style properties it sets and the number methods it builds values with.
export const DOMKIT_MEMBERS_ALLOWED = [...LAYER_MEMBERS_ALLOWED, "style", "fontSize", "backgroundImage", "backgroundSize", "backgroundPosition", "toFixed", "isFinite", "isInteger", "concat"];
// The only words a string literal in dom-kit.ts may be (an import path apart): the units, the gradient's fixed words and two messages.
// A word that is not here, "ur", "l(" ..., is refused, so no url can be spelled even in pieces.
export const DOMKIT_WORDS = ["", "vw", "vh", "%", "% ", ", ", " 100%", " 0", ")", "var(--ink) ", "transparent ", "linear-gradient(90deg, ", "not a finite number", "digits out of range"];
const reEscape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LAYER_BAD_PROPS = BAD_PROPS.split("|").filter((p) => p !== "createElement" && p !== "appendChild").join("|");
const layerSyntaxFor = (members, extra) => ["error",
  ...common.filter((rule) => !rule.selector.includes(BAD_PROPS) && !rule.selector.startsWith("ImportDeclaration[source.value='three']")),
  { selector: `MemberExpression[computed=false][property.name=/^(${LAYER_BAD_PROPS})$/]`, message: "No beacon, playback, markup, src, href, cookie, attribute setting or crypto randomness in the text layer." },
  { selector: `CallExpression[callee.property.name='createElement']:not([arguments.0.value=/^(${alt(LAYER_TAGS)})$/])`, message: `The text layer makes only ${LAYER_TAGS.join(" and ")} nodes (a literal tag).` },
  { selector: `MemberExpression[computed=false][property.name=/^(${REFLECTION_PROPS})$/]`, message: "No prototype access, render callback, element or page member in the text layer." },
  { selector: "MemberExpression[computed=false][property.name='constructor']", message: "No `constructor` member in the text layer." },
  { selector: "ImportDeclaration[source.value=/^three/]", message: "The text layer draws no three.js." },
  { selector: `MemberExpression[computed=false]:not([property.name=/^(${alt(members)})$/])`, message: "That member is not on the text layer's allowlist of members (eslint.config.js LAYER_MEMBERS_ALLOWED)." },
  // One syntax only: dot access. No computed key, literal or not; no destructuring (it reads members by key without a dot).
  { selector: "MemberExpression[computed=true]", message: "The text layer reads members by dot access only (no computed key, literal or not)." },
  { selector: ":matches(ObjectPattern, ArrayPattern)", message: "The text layer does not destructure: read members by dot access, so each one is checked." },
  { selector: `CallExpression[callee.property.name='getElementById']:not([arguments.0.value='${LAYER_ROOT_ID}'])`, message: `The text layer finds only its own root, #${LAYER_ROOT_ID}.` },
  { selector: "Literal[value=/url\\(/i]", message: "No url( in the text layer: it loads nothing." },
  { selector: "TemplateElement[value.raw=/url\\(/i]", message: "No url( in the text layer: it loads nothing." },
  { selector: identifierAllowedAsObject("Object", OBJECT_MEMBERS_ALLOWED), message: "The text layer uses Object only by its listed members." },
  { selector: identifierAllowedAsObject("window", WINDOW_ALLOWED), message: `The text layer reaches the window only by ${WINDOW_ALLOWED.join(", ")}.` },
  { selector: identifierAllowedAsObject("document", LAYER_DOCUMENT_ALLOWED), message: `The text layer reaches the document only by ${LAYER_DOCUMENT_ALLOWED.join(", ")}.` },
  ...extra,
];
// Every file of layer/ but dom-kit.ts: no `.style` at all (it calls dom-kit's functions), and no style method.
const layerSyntax = layerSyntaxFor(LAYER_MEMBERS_ALLOWED, [
  { selector: "MemberExpression[property.name='style']", message: "`.style` is touched only in layer/dom-kit.ts: call its functions." },
  { selector: "MemberExpression[property.name=/^(setProperty|cssText|removeProperty|getPropertyValue)$/]", message: "No setProperty or cssText in the text layer: call dom-kit's functions." },
]);
// layer/dom-kit.ts, the one file that sets a style, and from numbers only: no string literal but its few words, no `+`, no template
// with an expression, no join, no String.raw, and nothing typed string (or any or unknown). Short enough to read whole.
const domKitSyntax = layerSyntaxFor(DOMKIT_MEMBERS_ALLOWED, [
  { selector: `Literal[value=/./]:not(ImportDeclaration > Literal):not([value=/^(${DOMKIT_WORDS.filter((w) => w !== "").map(reEscape).join("|")})$/])`, message: "dom-kit.ts holds no string literal but its listed words (DOMKIT_WORDS)." },
  { selector: "BinaryExpression[operator='+'], AssignmentExpression[operator='+=']", message: "dom-kit.ts builds no string with `+` (use .concat of its listed words and toFixed output)." },
  { selector: "TemplateLiteral", message: "dom-kit.ts uses no template literal." },
  { selector: "CallExpression[callee.property.name='join']", message: "dom-kit.ts does not .join." },
  { selector: "MemberExpression[object.name='String']", message: "dom-kit.ts does not use String.raw or any String member." },
  { selector: ":matches(TSStringKeyword, TSAnyKeyword, TSUnknownKeyword, TSTemplateLiteralType)", message: "dom-kit.ts takes and returns numbers only: no string, any or unknown type." },
]);
// A comment is text too: no url( in dom-kit.ts, comments included.
const localPlugin = { rules: { "no-url-text": { create: (context) => ({
  Program: () => { for (const c of context.sourceCode.getAllComments()) if (/url\(/i.test(c.value)) context.report({ loc: c.loc, message: "No url( in dom-kit.ts, comments included." }); },
}) } } };

const properties = ["error",
  { object: "Math", property: "random", message: "The rig is deterministic." },
];
const base = { "no-restricted-properties": properties, "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error" };
// src/ imports three.js (the allowlist above), its own siblings, the scene model and the guard's one entry, and nothing else
// (not tools/, not demo/, not other guard/ files, no package). guard/ imports three.js only.
export const SRC_IMPORT_PATTERN = "^(?!three$|\\./[A-Za-z0-9-]+\\.ts$|\\.\\./\\.\\./model/src/index\\.ts$|\\.\\./guard/render-callbacks\\.ts$).*$";
export const GUARD_IMPORT_PATTERN = "^(?!three$).*$";
const threeImports = (allowed, pattern) => ["error", {
  paths: [{ name: "three", allowImportNames: allowed, message: "That three.js name is not on the allowlist (no audio, no loaders; the renderer is built by the host, not src/)." }],
  ...(pattern ? { patterns: [{ regex: pattern, caseSensitive: true, message: "Not on this directory's import allowlist (three.js by name, its siblings, the scene model and guard/render-callbacks.ts for src/; three.js only for guard/)." }] } : {}),
}];

// The pure modules (light calculations, bursts, the loop, the tokens reader) import no three.js and
// no DOM, and read no clock.
const pure = [
  "src/light-calc.ts", "src/bursts.ts", "src/loop.ts", "src/tokens.ts",
  // The deferred looks (#546): the colour cross, the stage looks, a pattern's light and the softening numbers.
  "src/colour-cross.ts", "src/stage-calc.ts", "src/pattern-light-calc.ts", "src/soft-calc.ts",
  // The text layer's rules and calculations: words, fitting, the score, the pattern count, the mask's numbers.
  "src/text-types.ts", "src/text-view.ts", "src/text-box.ts", "src/text-words.ts", "src/text-pattern-calc.ts", "src/text-fit-calc.ts",
  "src/text-score-calc.ts", "src/text-view-calc.ts", "src/text-mask-calc.ts",
];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "screenshots/", "artifacts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,mts,cts,js,mjs,cjs}"],
    languageOptions: { globals: Object.fromEntries(SRC_GLOBALS.map((name) => [name, "readonly"])) },
    rules: {
      ...base,
      "no-undef": "error",
      "no-restricted-imports": threeImports(THREE_ALLOWED, SRC_IMPORT_PATTERN),
      "no-restricted-globals": globals([...new Set([...BANNED_GLOBALS, ...SRC_BUILTINS_RESTRICTED]), "document", "location", "history", "screen", "name"], "The scene draws what the model says: no network, storage, worker, audio, image or document."),
      "no-restricted-syntax": srcSyntax,
    },
  },
  {
    // guard/ names prototypes and the callbacks (the src/ syntax fences would refuse that) and nothing else of the page:
    // the src/ globals, banned names and three.js allowlist, plus the common syntax fences.
    files: ["guard/**/*.{ts,mts,cts,js,mjs,cjs}"],
    languageOptions: { globals: Object.fromEntries(SRC_GLOBALS.map((name) => [name, "readonly"])) },
    rules: {
      ...base,
      "no-undef": "error",
      "no-restricted-imports": threeImports(THREE_GUARD_ALLOWED, GUARD_IMPORT_PATTERN),
      "no-restricted-globals": globals([...new Set([...BANNED_GLOBALS, ...SRC_BUILTINS_RESTRICTED]), "document", "location", "history", "screen", "name"], "The guard reads three.js's prototypes and nothing of the page: no network, storage, worker, audio, image or document."),
      "no-restricted-syntax": guardSyntax,
    },
  },
  {
    files: ["demo/**/*.ts"],
    rules: {
      ...base,
      "no-restricted-imports": threeImports(THREE_DEMO_ALLOWED),
      "no-restricted-globals": globals(BANNED_GLOBALS, "The demo draws what the model says: no network, storage, worker, audio or image."),
      "no-restricted-syntax": demoSyntax,
    },
  },
  {
    files: ["layer/**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"],
    languageOptions: { globals: Object.fromEntries(LAYER_GLOBALS.map((name) => [name, "readonly"])) },
    rules: {
      ...base,
      "no-restricted-imports": ["error", { patterns: [{ regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$|\\.\\./src/[A-Za-z0-9-]+\\.ts$).*$", message: "The text layer imports its siblings and the scene's own src/ modules only." }] }],
      "no-undef": "error",
      "no-restricted-globals": globals([...new Set([...BANNED_GLOBALS, ...SRC_BUILTINS_RESTRICTED]), "location", "history"], "The text layer draws what the view says: no network, storage, worker, audio or image."),
      "no-restricted-syntax": layerSyntax,
    },
  },
  {
    files: ["layer/dom-kit.ts"],
    plugins: { local: localPlugin },
    rules: { "no-restricted-syntax": domKitSyntax, "local/no-url-text": "error" },
  },
  {
    files: pure,
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ caseSensitive: true, regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$|\\.\\./\\.\\./model/src/index\\.ts$).*$", message: "A pure module imports only its siblings and the scene model (no three.js, DOM or I/O)." }] }],
      "no-restricted-globals": globals([...BANNED_GLOBALS, "window", "document", "location", "requestAnimationFrame", "performance", "Date", "setTimeout", "setInterval"], "A pure module reads no clock, no DOM and no I/O."),
    },
  },
);
