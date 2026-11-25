// The property paths of a declared type, read with the TypeScript compiler, so inherited members (`extends`),
// quoted keys, intersections and named nested types (BeatAnchor, SongMoment ...) count like any other, and an index
// signature or a method member is reported as a path of its own (it can never match a pinned list).
import { fileURLToPath } from "node:url";
import ts from "typescript";

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: [],
};

/** `leaves` are paths whose type is not walked into (a schema type the test pins by name instead). */
export function shapePaths(rel: string, name: string, leaves: readonly string[] = []): string[] {
  const file = fileURLToPath(new URL(rel, import.meta.url));
  const program = ts.createProgram([file], OPTIONS);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`no source ${rel}`);
  let decl: ts.Declaration | undefined;
  ts.forEachChild(source, (n) => { if ((ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) && n.name.text === name) decl = n; });
  if (decl === undefined) throw new Error(`${name} is not declared in ${rel}`);
  const out = new Set<string>();
  const seen: ts.Type[] = [];
  const walk = (type: ts.Type, path: string): void => {
    const plain = checker.getNonNullableType(type);
    if (plain.isUnion()) { plain.types.forEach((t) => walk(t, path)); return; }
    if (plain.isIntersection()) { plain.types.forEach((t) => walk(t, path)); return; }
    if (checker.isArrayType(plain) || checker.isTupleType(plain)) { checker.getTypeArguments(plain as ts.TypeReference).forEach((t) => walk(t, `${path}[]`)); return; }
    if (!(plain.flags & ts.TypeFlags.Object) || leaves.includes(path)) return;
    if (seen.includes(plain) && path.split(".").length > 6) throw new Error(`${path} recurses`);
    for (const info of checker.getIndexInfosOfType(plain)) out.add(`${path}{index signature: ${checker.typeToString(info.keyType)}}`);
    for (const prop of checker.getPropertiesOfType(plain)) {
      const t = checker.getTypeOfSymbol(prop);
      const at = path === "" ? prop.name : `${path}.${prop.name}`;
      if (t.getCallSignatures().length > 0 || (prop.flags & ts.SymbolFlags.Method) !== 0) { out.add(`${at}()`); continue; }
      out.add(at);
      walk(t, at);
    }
    seen.push(plain);
  };
  walk(checker.getTypeAtLocation((decl as ts.InterfaceDeclaration).name), "");
  return [...out].sort();
}
