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
const REFLECTION_PROPS = "__proto__|prototype|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__|onBeforeRender|onAfterRender|onBeforeCompile|onBeforeShadow|onAfterShadow|getRootNode|ownerDocument|defaultView|parentNode|domElement";
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
  // A subclass of a three.js class can declare a render callback as a method, which no member access shows.
  { selector: ":matches(ClassDeclaration, ClassExpression)[superClass]", message: "src/ declares no class with a superclass (a subclass method can be a three.js render callback)." },
  { selector: "MemberExpression[computed=true]:not([property.type='Literal'])",message: "src/ reads members by a literal key only: a key built at run time can name any member (use .at(i), a destructure or a lookup helper)." },
  { selector: identifierAllowedAsObject("window", WINDOW_ALLOWED), message: `src/ reaches the window only by ${WINDOW_ALLOWED.join(", ")}.` },
];
const demoSyntax = ["error", ...common,
  { selector: identifierAllowedAsObject("window", DEMO_WINDOW_ALLOWED), message: `The demo reaches the window only by ${DEMO_WINDOW_ALLOWED.join(", ")}.` },
  { selector: identifierAllowedAsObject("document", DEMO_DOCUMENT_ALLOWED), message: `The demo reaches the document only by ${DEMO_DOCUMENT_ALLOWED.join(", ")}.` },
  { selector: identifierAllowedAsObject("location", ["search"]), message: "The demo reads location.search and nothing else." },
];

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
  ...(pattern ? { patterns: [{ regex: pattern, message: "Not on this directory's import allowlist (three.js by name, its siblings, the scene model and guard/render-callbacks.ts for src/; three.js only for guard/)." }] } : {}),
}];

// The pure modules (light calculations, bursts, the loop, the tokens reader) import no three.js and
// no DOM, and read no clock.
const pure = ["src/light-calc.ts", "src/bursts.ts", "src/loop.ts", "src/tokens.ts"];

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
      "no-restricted-imports": threeImports(THREE_ALLOWED, SRC_IMPORT_PATTERN),
      "no-restricted-globals": globals([...new Set([...BANNED_GLOBALS, ...SRC_BUILTINS_RESTRICTED]), "document", "location", "history", "screen", "name"], "The scene draws what the model says: no network, storage, worker, audio, image or document."),
      "no-restricted-syntax": srcSyntax,
    },
  },
  {
    // guard/ names prototypes and the callbacks (the src/ syntax fences would refuse that) and nothing else of the page:
    // the src/ globals, banned names and three.js allowlist, plus the common syntax fences.
    files: ["guard/**/*.ts"],
    languageOptions: { globals: Object.fromEntries(SRC_GLOBALS.map((name) => [name, "readonly"])) },
    rules: {
      ...base,
      "no-undef": "error",
      "no-restricted-imports": threeImports(THREE_GUARD_ALLOWED, GUARD_IMPORT_PATTERN),
      "no-restricted-globals": globals([...new Set([...BANNED_GLOBALS, ...SRC_BUILTINS_RESTRICTED]), "document", "location", "history", "screen", "name"], "The guard reads three.js's prototypes and nothing of the page: no network, storage, worker, audio, image or document."),
      "no-restricted-syntax": ["error", ...common],
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
    files: pure,
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$|\\.\\./\\.\\./model/src/index\\.ts$).*$", message: "A pure module imports only its siblings and the scene model (no three.js, DOM or I/O)." }] }],
      "no-restricted-globals": globals([...BANNED_GLOBALS, "window", "document", "location", "requestAnimationFrame", "performance", "Date", "setTimeout", "setInterval"], "A pure module reads no clock, no DOM and no I/O."),
    },
  },
);
