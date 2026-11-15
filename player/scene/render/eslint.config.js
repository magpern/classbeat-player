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
const REFLECTION_PROPS = "__proto__|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__|onBeforeRender|onAfterRender|onBeforeCompile|onBeforeShadow|onAfterShadow|getRootNode|ownerDocument|defaultView|parentNode|domElement";
const srcSyntax = ["error", ...common,
  // src/ is handed the host's painter (src/host.ts) and never reaches for the renderer's element or the page through it or through three.js callbacks.
  { selector: `MemberExpression[computed=false][property.name=/^(${REFLECTION_PROPS})$/]`, message: "No prototype access, render callback, element or page member in src/." },
  { selector: `MemberExpression[computed=true][property.type='Literal'][property.value=/^(${REFLECTION_PROPS})$/]`, message: "No prototype access, render callback, element or page member in src/." },
  { selector: `Identifier[name=/^(${alt(ERROR_CLASSES)})$/]:not(:matches(NewExpression, CallExpression) > Identifier.callee, TSTypeReference > Identifier)`, message: "src/ only builds an Error (`new Error(...)`); it takes no member of it (no captureStackTrace, no prepareStackTrace)." },
  { selector: identifierAllowedAsObject("Object", OBJECT_MEMBERS_ALLOWED), message: `src/ uses Object only by ${OBJECT_MEMBERS_ALLOWED.join(", ")} (no reflection: no getPrototypeOf, getOwnPropertyDescriptor, defineProperty, setPrototypeOf).` },
  // No route to the global object or the page by building a name at run time: `constructor` (reaches `Function`), and any computed key that is not a literal.
  { selector: "MemberExpression[computed=false][property.name='constructor']", message: "No `constructor` member in src/ (it reaches Function and the global object)." },
  { selector: "MemberExpression[computed=true][property.type='Literal'][property.value='constructor']", message: "No `constructor` member in src/ (it reaches Function and the global object)." },
  // Every destructuring key (nested patterns and parameters too) is a plain identifier, and its name faces the same bans as a member access.
  { selector: "ObjectPattern > Property:not([computed=false][key.type='Identifier'])", message: "src/ destructures by a plain identifier key only (no string or computed key)." },
  { selector: `ObjectPattern > Property[key.name=/^(constructor|${REFLECTION_PROPS})$/]`, message: "No `constructor`, prototype, render callback, element or page member in src/, destructured or not." },
  { selector: "MemberExpression[computed=true]:not([property.type='Literal'])", message: "src/ reads members by a literal key only: a key built at run time can name any member (use .at(i), a destructure or a lookup helper)." },
  { selector: identifierAllowedAsObject("window", WINDOW_ALLOWED), message: `src/ reaches the window only by ${WINDOW_ALLOWED.join(", ")}.` },
];
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
export const LAYER_MEMBERS_ALLOWED = [
  "alert", "appendChild", "at", "backgroundImage", "backgroundPosition", "backgroundSize", "bars", "block", "blocks", "bottom", "boxes", "build", "cached",
  "chip", "className", "clip", "clips", "clock", "compact", "count", "createElement", "cue", "cueLines", "cycleVw", "detail", "done", "end", "endX",
  "estimated", "flatMap", "fold", "folded", "fontSize", "forEach", "from", "gel", "getBoundingClientRect", "getElementById", "height", "hidden", "ink",
  "innerHeight", "innerWidth", "intervals", "join", "kind", "label", "layout", "left", "leftVw", "len", "length", "line", "link", "look", "map", "marks",
  "max", "metrics", "moments", "name", "nameSmall", "next", "note", "now", "nowX", "num", "number", "numeral", "offsetVw", "parts", "pattern", "pause",
  "pauseLine", "paused", "phrases", "push", "rail", "reduced", "right", "root", "row", "score", "seg", "segment", "side", "signature", "sizeVh", "slice",
  "small", "songs", "spec", "squares", "strip", "style", "targets", "text", "textContent", "textLeft", "textRight", "then", "ticks", "time", "title", "to",
  "toFixed", "top", "total", "ts", "txt", "unit", "up", "update", "updateClock", "updateGel", "updateMetrics", "updateNext", "updatePattern", "updateRail",
  "use", "val", "value", "width", "word", "x", "x0", "x1", "zone", "zoneName", "invalidate",
];
const LAYER_BAD_PROPS = BAD_PROPS.split("|").filter((p) => p !== "createElement" && p !== "appendChild").join("|");
const layerSyntax = ["error",
  ...common.filter((rule) => !rule.selector.includes(BAD_PROPS) && !rule.selector.startsWith("ImportDeclaration[source.value='three']")),
  { selector: `MemberExpression[computed=false][property.name=/^(${LAYER_BAD_PROPS})$/]`, message: "No beacon, playback, markup, src, href, cookie, attribute setting or crypto randomness in the text layer." },
  { selector: `MemberExpression[computed=true][property.type='Literal'][property.value=/^(${LAYER_BAD_PROPS})$/]`, message: "No beacon, playback, markup, src, href, cookie, attribute setting or crypto randomness in the text layer." },
  { selector: `CallExpression[callee.property.name='createElement']:not([arguments.0.value=/^(${alt(LAYER_TAGS)})$/])`, message: `The text layer makes only ${LAYER_TAGS.join(" and ")} nodes (a literal tag).` },
  { selector: "MemberExpression[computed=true][property.value='createElement']", message: "Call createElement by name, with a literal tag." },
  { selector: `MemberExpression[computed=false][property.name=/^(${REFLECTION_PROPS})$/]`, message: "No prototype access, render callback, element or page member in the text layer." },
  { selector: `MemberExpression[computed=true][property.type='Literal'][property.value=/^(${REFLECTION_PROPS})$/]`, message: "No prototype access, render callback, element or page member in the text layer." },
  { selector: "MemberExpression[computed=false][property.name='constructor']", message: "No `constructor` member in the text layer." },
  { selector: "MemberExpression[computed=true]:not([property.type='Literal'])", message: "The text layer reads members by a literal key only (use .at(i) or a lookup)." },
  { selector: "ImportDeclaration[source.value=/^three/]", message: "The text layer draws no three.js." },
  { selector: `MemberExpression[computed=false]:not([property.name=/^(${alt(LAYER_MEMBERS_ALLOWED)})$/])`, message: "That member is not on the text layer's allowlist of members (eslint.config.js LAYER_MEMBERS_ALLOWED)." },
  { selector: "MemberExpression[computed=true]:not([property.type='Literal'])", message: "The text layer reads members by a literal key only." },
  { selector: "ObjectPattern > Property:not([computed=false][key.type='Identifier'])", message: "The text layer destructures by a plain identifier key only." },
  { selector: `ObjectPattern > Property[key.name=/^(constructor|${REFLECTION_PROPS})$/]`, message: "No `constructor`, prototype or page member in the text layer, destructured or not." },
  { selector: `CallExpression[callee.property.name='getElementById']:not([arguments.0.value='${LAYER_ROOT_ID}'])`, message: `The text layer finds only its own root, #${LAYER_ROOT_ID}.` },
  { selector: "Literal[value=/url\\(/i]", message: "No url( in the text layer: it loads nothing." },
  { selector: "TemplateElement[value.raw=/url\\(/i]", message: "No url( in the text layer: it loads nothing." },
  { selector: identifierAllowedAsObject("Object", OBJECT_MEMBERS_ALLOWED), message: "The text layer uses Object only by its listed members." },
  { selector: identifierAllowedAsObject("window", WINDOW_ALLOWED), message: `The text layer reaches the window only by ${WINDOW_ALLOWED.join(", ")}.` },
  { selector: identifierAllowedAsObject("document", LAYER_DOCUMENT_ALLOWED), message: `The text layer reaches the document only by ${LAYER_DOCUMENT_ALLOWED.join(", ")}.` },
];

const properties = ["error",
  { object: "Math", property: "random", message: "The rig is deterministic." },
];
const base = { "no-restricted-properties": properties, "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error" };
const threeImports = (allowed) => ["error", { paths: [{ name: "three", allowImportNames: allowed, message: "That three.js name is not on the allowlist (no audio, no loaders; the renderer is built by the host, not src/)." }] }];

// The pure modules (light calculations, bursts, the loop, the tokens reader) import no three.js and
// no DOM, and read no clock.
const pure = [
  "src/light-calc.ts", "src/bursts.ts", "src/loop.ts", "src/tokens.ts",
  // The text layer's rules and calculations: words, fitting, the score, the pattern count, the mask's numbers.
  "src/text-types.ts", "src/text-view.ts", "src/text-box.ts", "src/text-words.ts", "src/text-pattern-calc.ts", "src/text-fit-calc.ts",
  "src/text-score-calc.ts", "src/text-view-calc.ts", "src/text-mask-calc.ts",
];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "screenshots/", "artifacts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: Object.fromEntries(SRC_GLOBALS.map((name) => [name, "readonly"])) },
    rules: {
      ...base,
      "no-undef": "error",
      "no-restricted-imports": threeImports(THREE_ALLOWED),
      "no-restricted-globals": globals([...new Set([...BANNED_GLOBALS, ...SRC_BUILTINS_RESTRICTED]), "document", "location", "history", "screen", "name"], "The scene draws what the model says: no network, storage, worker, audio, image or document."),
      "no-restricted-syntax": srcSyntax,
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
    files: ["layer/**/*.ts"],
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
    files: pure,
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$|\\.\\./\\.\\./model/src/index\\.ts$).*$", message: "A pure module imports only its siblings and the scene model (no three.js, DOM or I/O)." }] }],
      "no-restricted-globals": globals([...BANNED_GLOBALS, "window", "document", "location", "requestAnimationFrame", "performance", "Date", "setTimeout", "setInterval"], "A pure module reads no clock, no DOM and no I/O."),
    },
  },
);
