import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The pure modules (light calculations, bursts, the loop, the tokens reader) import no three.js
// and no DOM, and read no clock: the second block enforces it. The drawing modules may use three.js
// and the DOM and nothing else: no network, no audio, no storage.
const pure = ["src/light-calc.ts", "src/bursts.ts", "src/loop.ts", "src/tokens.ts"];

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "screenshots/", "artifacts/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "demo/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error",
        ...["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "localStorage", "sessionStorage", "AudioContext", "Audio"].map((name) => ({ name, message: "The scene draws what the model says: no network, storage or audio." })),
      ],
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "The rig is deterministic." }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: pure,
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$|\\.\\./\\.\\./model/src/index\\.ts$).*$", message: "A pure module imports only its siblings and the scene model (no three.js, DOM or I/O)." }] }],
      "no-restricted-globals": ["error", ...["window", "document", "navigator", "requestAnimationFrame", "performance", "Date", "setTimeout", "setInterval", "fetch", "localStorage"].map((name) => ({ name, message: "A pure module reads no clock, no DOM and no I/O." }))],
    },
  },
);
