import js from "@eslint/js";
import tseslint from "typescript-eslint";

// An allowlist, not a blocklist (rule guards). The drawing modules may import only these three.js
// names: no audio class (`Audio`, `PositionalAudio`, `AudioListener`, `AudioLoader`) and no loader
// (`TextureLoader`, `FileLoader`, ...) is on it, so the dependency's own audio and network classes
// cannot be reached. Adding a name is a reviewed change; `test/source-rules.test.ts` holds the same
// list and shows each fence firing.
export const THREE_ALLOWED = [
  "AdditiveBlending", "CircleGeometry", "Color", "ConeGeometry", "DoubleSide", "Group", "InstancedMesh", "Mesh", "MeshBasicMaterial",
  "Object3D", "PerspectiveCamera", "PlaneGeometry", "Quaternion", "Scene", "ShaderMaterial", "Vector3", "WebGLRenderer",
];
// Globals the scene never needs: network, storage, workers, audio, randomness, the global object.
const BANNED_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "Worker", "SharedWorker",
  "localStorage", "sessionStorage", "indexedDB", "caches", "crypto", "navigator", "globalThis", "self", "AudioContext", "webkitAudioContext", "Audio", "Image", "importScripts"];
const globals = (names, message) => ["error", ...names.map((name) => ({ name, message }))];

const syntax = ["error",
  { selector: "ImportExpression", message: "No dynamic import: every import is static and checked." },
  { selector: "MemberExpression[property.name=/^(sendBeacon|play|cookie|getRandomValues|randomUUID)$/]", message: "No beacon, audio playback, cookie or crypto randomness." },
  { selector: "MemberExpression[computed=true][property.type='Literal'][property.value=/^(sendBeacon|play|cookie|getRandomValues)$/]", message: "No beacon, audio playback, cookie or crypto randomness." },
  { selector: "ImportDeclaration[source.value=/^three\\//]", message: "Import from \"three\" only, by the names on the allowlist." },
  { selector: "ImportDeclaration[source.value='three'] > :matches(ImportNamespaceSpecifier, ImportDefaultSpecifier)", message: "Import named three.js classes from the allowlist only." },
];

// The pure modules (light calculations, bursts, the loop, the tokens reader) import no three.js and
// no DOM, and read no clock. The drawing modules may use three.js (allowlist) and the DOM.
const pure = ["src/light-calc.ts", "src/bursts.ts", "src/loop.ts", "src/tokens.ts"];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "screenshots/", "artifacts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "demo/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "three", allowImportNames: THREE_ALLOWED, message: "That three.js name is not on the allowlist (no audio, no loaders)." }] }],
      "no-restricted-globals": globals(BANNED_GLOBALS, "The scene draws what the model says: no network, storage, worker, audio or randomness."),
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "The rig is deterministic." }],
      "no-restricted-syntax": syntax,
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: pure,
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$|\\.\\./\\.\\./model/src/index\\.ts$).*$", message: "A pure module imports only its siblings and the scene model (no three.js, DOM or I/O)." }] }],
      "no-restricted-globals": globals([...BANNED_GLOBALS, "window", "document", "requestAnimationFrame", "performance", "Date", "setTimeout", "setInterval"], "A pure module reads no clock, no DOM and no I/O."),
    },
  },
);
