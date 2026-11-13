// The checker behind shell-guard-static.test.ts (#151 review, N3, N5, N6): the shell's guards are
// set in src/main/hardening.ts and nowhere else can replace or remove them. Read from the
// TypeScript syntax tree; allowlists:
//
// - A RESERVED name (the window-open handler, the session's permission, request, protocol, preload
//   and spell-checker setters) is written only in hardening.ts. Elsewhere it may appear only in a
//   type, as the name of a local declaration or of a key an interface defines, or as a reference to
//   a local of that name; never as a member, an import or export, an object destructuring, a key
//   of an object literal or a class (#154 review, N-4) or a string. `protocol` may also be read as a
//   member that is only compared (`url.protocol === "https:"`, never `||` or `??`).
// - A REMOVAL name (`off`, `removeListener`, `removeAllListeners`) follows the same rule in every
//   file, hardening.ts included: nothing removes the `web-contents-created` listener or a
//   contents' own guards.
//
// A member name built from strings (`o["off" + x]`) is refused by window-prefs-check.ts, which
// reads the same files; a key built from strings (`{ ["off" + x]: f }`) is refused here.
import ts from "typescript";
import { builtString, isTypePosition } from "./window-prefs-check.ts";

/** Names only hardening.ts may write. */
export const RESERVED: ReadonlySet<string> = new Set([
  "setWindowOpenHandler",
  "setPermissionRequestHandler",
  "setPermissionCheckHandler",
  "setDevicePermissionHandler",
  "setDisplayMediaRequestHandler",
  "setBluetoothPairingHandler",
  "setUSBProtectedClassesHandler",
  "setCertificateVerifyProc",
  "webRequest",
  "protocol",
  "registerPreloadScript",
  "unregisterPreloadScript",
  "setPreloads",
  "setSpellCheckerEnabled",
  "setSpellCheckerLanguages",
  "setSpellCheckerDictionaryDownloadURL",
]);
/** Names no file may write. */
export const REMOVAL: ReadonlySet<string> = new Set(["off", "removeListener", "removeAllListeners"]);

export interface ShellFound {
  readonly problems: string[];
  /** The reserved names written in this file (hardening.ts: the check is not vacuous). */
  readonly reserved: string[];
}

const COMPARE = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

/** Names the file declares itself (not by import): a reference to one of them is to a local. */
function locals(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const names = (b: ts.BindingName): void => {
    if (ts.isIdentifier(b)) out.add(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) names(el.name);
  };
  const walk = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) names(n.name);
    if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) out.add(n.name.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** The identifier names a declaration of its own, or a key an interface defines (never a value's key). */
function declares(n: ts.Identifier): boolean {
  const p = n.parent;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)) && p.name === n) return true;
  if (ts.isBindingElement(p) && p.name === n && ts.isArrayBindingPattern(p.parent)) return true;
  return (ts.isMethodSignature(p) || ts.isPropertySignature(p)) && p.name === n;
}

/**
 * The identifier is a key of a value: of an object literal (`{ off: f }`, `{ off }`, `{ off() {} }`,
 * `{ [off]: f }`) or a class member. Such a value can be copied onto a contents or the app
 * (`Object.assign(proto, { setWindowOpenHandler: noop })`, #154 review, N-4), so it is refused.
 */
function valueKey(n: ts.Identifier): boolean {
  const p = n.parent as ts.Node & { name?: ts.Node };
  if (ts.isComputedPropertyName(p)) return true;
  // Kinds, not parents: a class's methods and accessors are these kinds too. A class field is no
  // declaration (`declares`), so it is refused as well.
  return ts.isObjectLiteralElementLike(p) && !ts.isSpreadAssignment(p) && p.name === n;
}

/** The identifier is an expression on its own (a reference), not a name inside another node. */
function reference(n: ts.Identifier): boolean {
  const p = n.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
  if (ts.isShorthandPropertyAssignment(p)) return true;
  return p.name !== n && p.propertyName !== n && !ts.isQualifiedName(p);
}

/** `x.protocol` (or `x?.protocol`) whose only use is a comparison. */
function compared(n: ts.Identifier): boolean {
  const p = n.parent;
  if (!ts.isPropertyAccessExpression(p) || p.name !== n) return false;
  let e: ts.Node = p;
  while (ts.isParenthesizedExpression(e.parent)) e = e.parent;
  return ts.isBinaryExpression(e.parent) && COMPARE.has(e.parent.operatorToken.kind);
}

/** Checks one source file; `isHardening` is true for src/main/hardening.ts only. */
export function checkShellGuards(text: string, file: string, isHardening: boolean): ShellFound {
  const kind = /\.(c|m)?jsx?$/.test(file) ? ts.ScriptKind.JS : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const problems: string[] = [];
  const reserved: string[] = [];
  const say = (n: ts.Node, what: string): void => void problems.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}: ${what}`);
  const local = locals(sf);
  const guarded = (name: string): boolean => REMOVAL.has(name) || (RESERVED.has(name) && !isHardening);

  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && (RESERVED.has(n.text) || REMOVAL.has(n.text)) && !isTypePosition(n)) {
      const allowed = !valueKey(n) && (declares(n) || (reference(n) && local.has(n.text)) || (n.text === "protocol" && compared(n)));
      if (guarded(n.text) && !allowed) say(n, `${n.text} ${REMOVAL.has(n.text) ? "removes a listener" : "is set only in hardening.ts"}`);
      if (RESERVED.has(n.text) && !allowed) reserved.push(n.text);
    }
    if (ts.isStringLiteralLike(n) && guarded(n.text) && !isTypePosition(n)) say(n, `a string naming ${n.text}`);
    if (ts.isComputedPropertyName(n) && builtString(n.expression)) say(n, "a key built from strings");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { problems, reserved };
}
