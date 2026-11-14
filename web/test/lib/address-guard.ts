// What changes the page's address (rule 14; ADR 0007, section 5), read from a source file's syntax
// tree like core-purity.ts rather than with a pattern (#374). The rider page may only read the
// address and replace the current history entry in place. So in any file of it:
// - `location` (as a name, or as `window.location`, `document.location`, `x["location"]`) is only
//   ever the object of a property read of `pathname`, `hash`, `href`, `origin` or `search`, and that
//   read is never an assignment target (`=`, `+=`, `||=`, `++`, `delete`, a destructuring target,
//   a `for … in` variable). Any other use (an alias, an argument, a call such as `assign`, a
//   computed name) is reported;
// - `history` is only ever the object of a `replaceState` call; and the names `pushState` and
//   `History` do not appear at all.
// `replaceStateCalls` lists those calls, so the caller can pin their exact text.
import ts from "typescript";

const READ = new Set(["pathname", "hash", "href", "origin", "search"]);
/** Names that reach the global object; they are not themselves an address, but nothing may alias them. */
const GLOBALS = new Set(["window", "self", "globalThis", "top", "parent", "frames"]);

const text = (n: ts.Node, sf: ts.SourceFile): string => n.getText(sf);

/** The name a member or element access reads, or null when it is computed. */
function memberName(n: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n)) {
    const a = n.argumentExpression;
    return ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) ? a.text : null;
  }
  return null;
}
const isMember = (n: ts.Node): n is ts.PropertyAccessExpression | ts.ElementAccessExpression => ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n);

/** The node with parentheses, `as`, `satisfies` and `!` around it stripped, upward. */
function outer(n: ts.Node): ts.Node {
  let c = n;
  while (c.parent && (ts.isParenthesizedExpression(c.parent) || ts.isNonNullExpression(c.parent) || ts.isAsExpression(c.parent) || ts.isSatisfiesExpression(c.parent) || ts.isTypeAssertionExpression(c.parent))) c = c.parent;
  return c;
}

const ASSIGN = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether this expression is written to: the target of an assignment, an update, a delete or a destructuring. */
function isWritten(n: ts.Node): boolean {
  const c = outer(n);
  const p = c.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p) && ASSIGN.has(p.operatorToken.kind)) return p.left === c;
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if (ts.isDeleteExpression(p)) return true;
  if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === c) return true;
  // Inside a destructuring assignment: `[location.hash] = x`, `({ a: location.hash } = x)`.
  if (ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) return isWritten(p);
  if (ts.isPropertyAssignment(p) && p.initializer === c) return isWritten(p.parent);
  if (ts.isShorthandPropertyAssignment(p)) return isWritten(p.parent);
  return false;
}

export interface AddressUse {
  readonly problems: string[];
  /** The text of each `history.replaceState(…)` call, in order. */
  readonly replaceStateCalls: string[];
}

/** What a source file does to the address that it must not, and its `history.replaceState` calls. */
export function addressUse(fileName: string, source: string): AddressUse {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  const calls: string[] = [];
  const at = (n: ts.Node): string => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const flag = (n: ts.Node, why: string): void => void problems.push(`${why} (${at(n)}: ${text(n.parent && isMember(n.parent) ? n.parent : n, sf).slice(0, 60)})`);

  /** `n` is a reference to the address (`location`) or to the history (`history`): check its use. */
  const reference = (n: ts.Node, what: "location" | "history"): void => {
    const o = outer(n);
    const p = o.parent;
    if (!p || !isMember(p) || p.expression !== o) return flag(n, `${what} used as a value, aliased or passed on`);
    const name = memberName(p);
    if (name === null) return flag(n, `${what} read by a computed name`);
    if (what === "location") {
      if (!READ.has(name)) return flag(n, `location.${name}`);
      if (isWritten(p)) flag(n, `location.${name} written`);
      return;
    }
    // history: only a `replaceState` call.
    const call = outer(p).parent;
    if (name !== "replaceState" || !call || !ts.isCallExpression(call) || outer(p) !== call.expression) return flag(n, `history.${name}`);
    calls.push(text(call, sf));
  };

  // Names the file declares itself (a local `top` is not the window's): any alias of the real
  // object was reported where it was made.
  const own = new Set<string>();
  const declare = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isImportSpecifier(n)) && n.name && ts.isIdentifier(n.name)) own.add(n.name.text);
    ts.forEachChild(n, declare);
  };
  declare(sf);

  const visit = (n: ts.Node): void => {
    // `location` and `history` as bare names, or as a member of anything (`window.location`, `x["history"]`).
    if (ts.isIdentifier(n) && (n.text === "location" || n.text === "history")) {
      const p = n.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === n);
      if (ts.isPropertyAccessExpression(p) && p.name === n) reference(p, n.text);
      else if (!isName && !ts.isShorthandPropertyAssignment(p)) reference(n, n.text);
      else if (ts.isShorthandPropertyAssignment(p)) flag(n, `${n.text} used as a value, aliased or passed on`);
    } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.parent && ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n && (n.text === "location" || n.text === "history")) {
      reference(n.parent, n.text);
    } else if (ts.isIdentifier(n) && GLOBALS.has(n.text) && !own.has(n.text) && !(n.parent && ((ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) || (ts.isPropertyAssignment(n.parent) && n.parent.name === n)))) {
      // `window`, `self`, … may only be read through a literal name: `window.location` is that name's own check.
      const p = outer(n).parent;
      if (!p || !isMember(p) || p.expression !== outer(n)) flag(n, `${n.text} used as a value, aliased or passed on`);
      else if (ts.isElementAccessExpression(p) && memberName(p) === null) flag(n, `${n.text} read by a computed name`);
    } else if (ts.isElementAccessExpression(n) && memberName(n) === null) {
      // `document[name]`, `x[a + b]`: a computed name of an object that could be `document` or `window`.
      const e = n.expression;
      if (ts.isIdentifier(e) && (e.text === "document" || e.text === "History")) flag(n, `${e.text} read by a computed name`);
    }
    if (ts.isIdentifier(n) && (n.text === "pushState" || n.text === "History")) flag(n, `the name ${n.text}`);
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isRegularExpressionLiteral(n)) && /pushState/.test(n.text ?? n.getText(sf))) flag(n, "the name pushState in text");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { problems, replaceStateCalls: calls };
}
