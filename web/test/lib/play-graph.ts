// The modules a source file reaches, read from its syntax tree (ADR 0008, section 4): every module
// named by an import, a bare import, `export … from`, `import x = require`, a dynamic `import()`, a
// `require()` and an `import("…")` type, followed through the relative ones. Type-only imports count:
// a file the page only takes types from is still a file it depends on. A module named by anything
// but a string literal is reported, never followed.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

export interface Reach {
  /** Every file reached, as absolute paths, the entry included. */
  readonly files: ReadonlySet<string>;
  /** Module names that are not relative paths (a package), by the file that names them. */
  readonly bare: readonly (readonly [file: string, name: string])[];
  /** Places where a module is named by something that is not a string literal. */
  readonly computed: readonly string[];
}

/** The module specifiers a source names, with `null` for one that is not a string literal. */
export function specifiersOf(fileName: string, source: string): (string | null)[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: (string | null)[] = [];
  const lit = (e: ts.Node | undefined): string | null => (e && ts.isStringLiteralLike(e) ? e.text : null);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) out.push(lit(n.moduleSpecifier));
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) out.push(lit(n.moduleSpecifier));
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) out.push(lit(n.moduleReference.expression));
    else if (ts.isImportTypeNode(n)) out.push(ts.isLiteralTypeNode(n.argument) ? lit(n.argument.literal) : null);
    else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) out.push(lit(n.arguments[0]));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Follows the relative modules from `entry`; `.css` and other assets are not read. */
export function reach(entry: string): Reach {
  const files = new Set<string>();
  const bare: [string, string][] = [];
  const computed: string[] = [];
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx|mts|cts)$/.test(file) || !existsSync(file)) continue;
    for (const spec of specifiersOf(file, readFileSync(file, "utf8"))) {
      if (spec === null) computed.push(file);
      else if (spec.startsWith(".")) queue.push(resolve(join(dirname(file), spec)));
      else bare.push([file, spec]);
    }
  }
  return { files, bare, computed };
}
