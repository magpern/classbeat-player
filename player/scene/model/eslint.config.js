import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The model is pure (AGENTS.md section 3 and code structure rule 2): in src/ nothing may be
// imported but sibling modules, and no I/O, DOM, clock or randomness global may be named.
// tsconfig.src.json adds a second fence: it loads no DOM and no Node types.
const banned = ["window", "document", "navigator", "fetch", "XMLHttpRequest", "WebSocket", "process",
  "require", "Buffer", "setTimeout", "setInterval", "requestAnimationFrame", "performance", "localStorage", "globalThis"];

export default tseslint.config(
  { ignores: ["node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ regex: "^(?!\\./[A-Za-z0-9-]+\\.ts$).*$", message: "The scene model imports only its own sibling modules (no three.js, DOM, Node I/O or network)." }] }],
      "no-restricted-globals": ["error", ...banned.map((name) => ({ name, message: "The scene model is pure: no I/O, DOM, clock or global state." }))],
      "no-restricted-properties": ["error",
        { object: "Math", property: "random", message: "Looks and directions are deterministic." },
        { object: "Date", property: "now", message: "Time is an input, never read." }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
);
