// What makes a module of the companion's core impure (CLAUDE.md, "Pure core first"), read from
// its syntax tree rather than with a pattern: every module it names (import, bare import,
// `export … from`, `import x = require`, dynamic `import()`, `require()`, an `import("…")` type)
// must be on the allowed list, and it may not use `import.meta` or name a DOM or I/O global.
import ts from "typescript";

/** Other core modules, the room's pure formatting, and the contract's generated types. */
const ALLOWED = /^(\.\/[\w-]+\.ts|\.\.\/\.\.\/room\/format\.ts|(\.\.\/){4}schema\/generated\/ts\/[\w-]+\.d\.ts)$/;
/** The rider's core: as the companion's, plus the companion's pure code, shape and answer modules. */
export const RIDER_ALLOWED = /^(\.\/[\w-]+\.ts|\.\.\/\.\.\/room\/format\.ts|\.\.\/\.\.\/companion\/core\/(codes|shape|answer)\.ts|(\.\.\/){4}schema\/generated\/ts\/[\w-]+\.d\.ts)$/;

/** Globals that reach the page, the network, storage, time or the machine. */
export const BANNED_GLOBALS = new Set([
  "globalThis", "self", "window", "document", "frames", "parent", "top", "opener",
  "localStorage", "sessionStorage", "indexedDB", "caches", "cookieStore", "location", "history", "navigator",
  "fetch", "WebSocket", "XMLHttpRequest", "EventSource", "BroadcastChannel", "Worker", "SharedWorker", "postMessage",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback",
  "console", "crypto", "performance", "Date", "process", "require", "module", "eval", "Function",
  "addEventListener", "removeEventListener", "dispatchEvent", "alert", "confirm", "prompt", "open", "close", "print",
  "HTMLElement", "Element", "Node", "Image", "Audio", "Notification", "screen", "visualViewport",
]);

/** Is this identifier a name in a member or key position (`a.fetch`, `{ fetch: 1 }`), not a reference? */
function isMemberName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === id) return true;
  if (ts.isQualifiedName(p) && p.right === id) return true;
  return false;
}

/** The problems of one core module's source; empty when it is pure. */
export function impurities(fileName: string, source: string, allowed: RegExp = ALLOWED): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const named = (spec: ts.Expression | undefined, how: string): void => {
    if (!spec || !ts.isStringLiteral(spec)) out.push(`${how} of a computed module`);
    else if (!allowed.test(spec.text)) out.push(`${how} "${spec.text}"`);
  };
  // Names the module declares itself (variables, parameters, functions, classes, imports): a
  // local `top` or `close` is not the global of that name.
  const own = new Set<string>();
  const declare = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) && n.name && ts.isIdentifier(n.name)) own.add(n.name.text);
    ts.forEachChild(n, declare);
  };
  declare(sf);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) named(n.moduleSpecifier, "import");
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) named(n.moduleSpecifier, "export from");
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) named(n.moduleReference.expression, "import = require");
    else if (ts.isImportTypeNode(n)) {
      const lit = ts.isLiteralTypeNode(n.argument) ? n.argument.literal : undefined;
      named(lit && ts.isStringLiteral(lit) ? lit : undefined, "import type");
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) out.push("dynamic import()");
    else if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword) out.push("import.meta");
    else if (ts.isIdentifier(n) && BANNED_GLOBALS.has(n.text) && !own.has(n.text) && !isMemberName(n)) out.push(`global ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
