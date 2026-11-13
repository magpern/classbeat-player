// The checker behind window-prefs-static.test.ts (#149, N4): every renderer the shell creates has
// the hardening of web-preferences.ts. Allowlists, read from the TypeScript syntax tree:
//
// - A renderer host (`BrowserWindow`, `BrowserView`, `WebContentsView`) is named only as an
//   unaliased import from "electron", in a type, as the callee of a `new` that is checked, or in a
//   direct call of a static method that finds existing windows (STATIC_CALLS).
//   No other reference (no `const W = BrowserWindow`, no member access, no `extends`), no string
//   with its name, no default or namespace import of "electron", no `require`, no `import()`,
//   no `import x = require(...)`.
// - No way to reach a constructor by another road: no `constructor` (as a name, a string or part
//   of a template), no `Reflect`, no member name built from strings (`o[\`a${b}\`]`, `o["a" + b]`).
// - A `new` names a host, a name imported unaliased, a class of the same file, or a global
//   constructor from GLOBAL_NEW that the file does not redeclare; nothing else (#149, N4).
// - A class `extends` only a name imported unaliased, never a host, an expression or a local
//   binding (#151 review, N4).
// - A checked `new` has an object literal whose keys are plain identifiers; spreads only before
//   `webPreferences`, written once and out in full.
// - `webPreferences` is `secureWebPreferences(...)`, or `{ ...secureWebPreferences(...), k: v }`
//   with each `k` from EXTRA_KEYS.
// - `secureWebPreferences` is the unaliased import from src/main/web-preferences.ts; no other
//   binding of that name exists anywhere (web-preferences.ts declares it once).
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { EXTRA_KEYS } from "../../src/main/web-preferences.ts";

const HOSTS = new Set(["BrowserWindow", "BrowserView", "WebContentsView"]);
const SECURE = "secureWebPreferences";
/** Static methods that only find existing windows; called directly, never passed on. */
const STATIC_CALLS = new Set(["getFocusedWindow", "getAllWindows", "fromWebContents", "fromId"]);
export { EXTRA_KEYS };
/** Built-in constructors the sources may call `new` on (by their global name only). */
const GLOBAL_NEW = new Set(["Date", "Error", "Map", "Set", "RegExp", "TextEncoder", "TextDecoder", "URL", "Intl.Collator", "AbortController", "Promise", "WeakMap", "WeakSet", "Uint8Array", "TypeError", "RangeError"]);
const FORBIDDEN_TEXT = /constructor/;

export interface Found {
  readonly problems: string[];
  /** The checked constructor calls. */
  readonly windows: number;
}

export const isTypePosition = (n: ts.Node): boolean => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    // `extends BrowserWindow` makes a constructor under another name.
    if (ts.isHeritageClause(p) || ts.isExpressionWithTypeArguments(p)) return false;
    if (ts.isTypeNode(p)) return true;
    if (ts.isStatement(p) || ts.isExpression(p)) return false;
  }
  return false;
};
const plainName = (n: ts.PropertyName): string | null => (ts.isIdentifier(n) ? n.text : null);
/** A string built at run time: a template with substitutions, or `+` with a string in it. */
export const builtString = (e: ts.Expression): boolean => {
  if (ts.isParenthesizedExpression(e)) return builtString(e.expression);
  if (ts.isTemplateExpression(e)) return true;
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const strings = (x: ts.Expression): boolean => ts.isStringLiteralLike(x) || builtString(x);
    return strings(e.left) || strings(e.right);
  }
  return false;
};
const newName = (e: ts.Expression): string | null => {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ts.isIdentifier(e.name)) return `${e.expression.text}.${e.name.text}`;
  return null;
};

/** Names a `new` may use: unaliased named imports, and the classes and other bindings of the file. */
function bindings(sf: ts.SourceFile): { imported: Set<string>; classes: Set<string>; declared: Set<string> } {
  const imported = new Set<string>();
  const classes = new Set<string>();
  const declared = new Set<string>();
  const names = (b: ts.BindingName): void => {
    if (ts.isIdentifier(b)) declared.add(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) names(el.name);
  };
  const walk = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) && !n.propertyName && !n.isTypeOnly) imported.add(n.name.text);
    else if (ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) if (n.name) declared.add(n.name.text);
    if (ts.isClassDeclaration(n) && n.name) classes.add(n.name.text);
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) names(n.name);
    if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n)) && n.name) declared.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return { imported, classes, declared };
}

function checkWebPreferences(v: ts.Expression, isSecure: (e: ts.Expression) => boolean): string[] {
  if (isSecure(v)) return [];
  if (!ts.isObjectLiteralExpression(v)) return ["webPreferences is not secureWebPreferences(...)"];
  const [first, ...rest] = v.properties;
  const out: string[] = [];
  if (!first || !ts.isSpreadAssignment(first) || !isSecure(first.expression)) out.push("webPreferences does not start with ...secureWebPreferences(...)");
  for (const p of rest) {
    const key = ts.isPropertyAssignment(p) ? plainName(p.name) : null;
    if (key === null || !EXTRA_KEYS.has(key)) out.push(`webPreferences adds ${key ?? ts.SyntaxKind[p.kind]}, not in EXTRA_KEYS`);
  }
  return out;
}

function checkOptions(call: ts.NewExpression, isSecure: (e: ts.Expression) => boolean): string[] {
  const opts = call.arguments?.length === 1 ? call.arguments[0] : undefined;
  if (!opts || !ts.isObjectLiteralExpression(opts)) return ["the options are not one object literal"];
  const out: string[] = [];
  let wp: ts.PropertyAssignment | null = null;
  for (const p of opts.properties) {
    if (ts.isSpreadAssignment(p)) {
      if (wp) out.push("a spread after webPreferences");
      continue;
    }
    if (!ts.isPropertyAssignment(p)) {
      out.push(`a ${ts.SyntaxKind[p.kind]} in the options`);
      continue;
    }
    const key = plainName(p.name);
    if (key === null) out.push(`an option key that is not a plain name: ${p.name.getText()}`);
    else if (key === "webPreferences") {
      if (wp) out.push("webPreferences twice");
      wp = p;
    }
  }
  if (!wp) return [...out, "no webPreferences"];
  return [...out, ...checkWebPreferences(wp.initializer, isSecure)];
}

/** Checks one source file; `file` is its absolute path (to resolve imports). */
export function checkSource(text: string, file: string): Found {
  const kind = /\.(c|m)?jsx?$/.test(file) ? ts.ScriptKind.JS : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const problems: string[] = [];
  const say = (n: ts.Node, what: string): void => void problems.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${what}`);
  const isPrefsFile = /[\\/]src[\\/]main[\\/]web-preferences\.ts$/.test(file);
  let secureImported = false;
  const checked = new Set<ts.Node>();
  let windows = 0;
  const known = bindings(sf);

  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const from = n.moduleSpecifier.text;
      const clause = n.importClause;
      if (from === "electron" && clause && !clause.isTypeOnly && (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)))) say(n, "a default or namespace import of electron");
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const s of clause.namedBindings.elements) {
          const imported = (s.propertyName ?? s.name).text;
          if (HOSTS.has(imported) && s.propertyName) say(s, `${imported} imported under another name`);
          if (s.name.text === SECURE || imported === SECURE) {
            const real = !s.propertyName && from.startsWith(".") && /[\\/]src[\\/]main[\\/]web-preferences\.ts$/.test(resolve(dirname(file), from));
            if (real) secureImported = true;
            else say(s, `${SECURE} that is not the unaliased import from main/web-preferences.ts`);
          }
        }
      }
    }
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) say(n, "a dynamic import");
    if (ts.isImportEqualsDeclaration(n)) say(n, "an import = require(...)");
    if (ts.isElementAccessExpression(n) && builtString(n.argumentExpression)) say(n, "a member name built from strings");
    if ((ts.isClassDeclaration(n) || ts.isClassExpression(n)) && n.heritageClauses) {
      for (const t of n.heritageClauses.filter((h) => h.token === ts.SyntaxKind.ExtendsKeyword).flatMap((h) => h.types)) {
        const e = t.expression;
        const imported = ts.isIdentifier(e) && !HOSTS.has(e.text) && known.imported.has(e.text) && !known.declared.has(e.text) && !known.classes.has(e.text);
        if (!imported) say(t, `a class that extends ${t.expression.getText()}, not a name imported unaliased`);
      }
    }
    if (ts.isNewExpression(n)) {
      const e = n.expression;
      const name = newName(e);
      if (ts.isIdentifier(e) && HOSTS.has(e.text)) {
        windows++;
        for (const p of checkOptions(n, (x) => ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === SECURE && x.arguments.length === 1)) say(n, p);
      } else if (name === null) say(n, "a new of something other than a name");
      else {
        const head = name.split(".")[0]!;
        const global = GLOBAL_NEW.has(name) && !known.declared.has(head) && !known.imported.has(head) && !known.classes.has(head);
        const own = ts.isIdentifier(e) && (known.imported.has(name) || known.classes.has(name)) && !known.declared.has(name);
        if (!global && !own) say(n, `a new of ${name}, not an import, a class of this file or an allowed global`);
      }
    }
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      if (n.text === "require" && !isTypePosition(n)) say(n, "require");
      if ((n.text === "constructor" || n.text === "Reflect") && !isTypePosition(n)) say(n, `${n.text}`);
      if (HOSTS.has(n.text) && !checked.has(n) && !isTypePosition(n)) {
        const imported = ts.isImportSpecifier(parent) && !parent.propertyName && parent.name === n;
        const finder = ts.isPropertyAccessExpression(parent) && parent.expression === n && STATIC_CALLS.has(parent.name.text) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
        if (!imported && !finder) say(n, `${n.text} used other than in new, an import or a type`);
      }
      if (n.text === SECURE) {
        const call = ts.isCallExpression(parent) && parent.expression === n;
        const importName = ts.isImportSpecifier(parent);
        const definition = isPrefsFile && ts.isFunctionDeclaration(parent) && parent.name === n;
        if (!call && !importName && !definition) say(n, `${SECURE} bound or used other than as the import's call`);
      }
    }
    if (ts.isStringLiteralLike(n) && HOSTS.has(n.text)) say(n, `a string naming ${n.text}`);
    if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && FORBIDDEN_TEXT.test(n.text)) say(n, "a string with constructor");
    ts.forEachChild(n, visit);
  };
  // `new` callees first, so the identifier check knows which references are checked.
  const collect = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && HOSTS.has(n.expression.text)) checked.add(n.expression);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  visit(sf);
  if (windows > 0 && !secureImported) problems.push(`${file}: a window without the import of ${SECURE}`);
  return { problems, windows };
}
