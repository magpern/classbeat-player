import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Allowlists, not blocklists (rule guards). Three layers close the scene's page off by construction:
// this file (lint), the content-security policy of demo/index.html and the runtime trap of
// tools/shots.ts. `test/source-fences.test.ts` shows each lint fence firing.
//
// 1. three.js: the drawing modules may import only these names. No audio class and no loader is on
//    it, so the dependency's own audio and network classes cannot be reached.
export const THREE_ALLOWED = [
  "AdditiveBlending", "CircleGeometry", "Color", "ConeGeometry", "DoubleSide", "Group", "InstancedMesh", "Mesh", "MeshBasicMaterial",
  "Object3D", "PerspectiveCamera", "PlaneGeometry", "Quaternion", "Scene", "ShaderMaterial", "Vector3", "WebGLRenderer",
];
// 2. The DOM: `document` is not reachable from src/ at all, and `window` only by these members.
export const WINDOW_ALLOWED = ["innerWidth", "innerHeight", "devicePixelRatio", "requestAnimationFrame", "cancelAnimationFrame", "addEventListener", "removeEventListener"];
// The demo page may also read its own canvas and the computed style, and publish its test API.
export const DEMO_WINDOW_ALLOWED = [...WINDOW_ALLOWED, "__scene"];
export const DEMO_DOCUMENT_ALLOWED = ["getElementById", "documentElement"];

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
const srcSyntax = ["error", ...common,
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
const threeImports = ["error", { paths: [{ name: "three", allowImportNames: THREE_ALLOWED, message: "That three.js name is not on the allowlist (no audio, no loaders)." }] }];

// The pure modules (light calculations, bursts, the loop, the tokens reader) import no three.js and
// no DOM, and read no clock.
const pure = ["src/light-calc.ts", "src/bursts.ts", "src/loop.ts", "src/tokens.ts"];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "screenshots/", "artifacts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      ...base,
      "no-restricted-imports": threeImports,
      "no-restricted-globals": globals([...BANNED_GLOBALS, "document", "location", "history", "screen", "name"], "The scene draws what the model says: no network, storage, worker, audio, image or document."),
      "no-restricted-syntax": srcSyntax,
    },
  },
  {
    files: ["demo/**/*.ts"],
    rules: {
      ...base,
      "no-restricted-imports": threeImports,
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
