import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { console: "readonly", process: "readonly", __dirname: "readonly", window: "readonly", document: "readonly" } },
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name='innerHTML']", message: "Use textContent; nothing from a file becomes markup." },
        { selector: "MemberExpression[property.name='outerHTML']", message: "Use textContent; nothing from a file becomes markup." },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Use textContent; nothing from a file becomes markup." },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
);
