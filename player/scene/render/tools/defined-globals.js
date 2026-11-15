// The names ESLint itself defines in the global scope of a module for the configured ECMAScript
// version (`conf/globals.js` of ESLint: the built-ins, and also `constructor`, `toString`,
// `valueOf`, `hasOwnProperty`, `Temporal` and the rest). ESLint exposes no list, so this lints one
// empty module and reads the variables of its global scope: the answer is whatever the installed
// ESLint defines, never a second list that can drift. eslint.config.js restricts every one of
// them that src/ is not allowed.
import { Linter } from "eslint";

export function definedGlobals(languageOptions = { ecmaVersion: "latest", sourceType: "module" }) {
  let names = [];
  const linter = new Linter();
  linter.verify("export {};", [{
    languageOptions,
    plugins: {
      probe: { rules: { scope: { create: (context) => ({ Program: () => { names = context.sourceCode.getScope(context.sourceCode.ast).variables.map((v) => v.name); } }) } } },
    },
    rules: { "probe/scope": "error" },
  }]);
  return names.sort();
}
