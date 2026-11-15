// Reflection and class loading get around every name list, so none is allowed. Pure: text in, problem out.
// Fails closed: the names are refused as whole words wherever they appear (a callable reference, a space
// before the parenthesis and a comment all count), and a class object is allowed only in the few shapes
// the real sources use.

const NAMES = /\b(?:get(?:Declared)?(?:Method|Field|Constructor|Class)s?|get[Ee]nclosing\w+|enclosing\w+|newInstance|invoke|forName|callBy|KClass|KFunction|KProperty\w*|MethodHandles?|ClassLoader|methods|fields|constructors|declared\w+)\b|java\.lang\.(?:reflect|invoke)|kotlin\.reflect/;

/** The only places a class object may appear (a positive allowlist; `X::class.java` anywhere else is refused). */
const ALLOWED_USES = [
  /\bgetSystemService\(\s*[\w.]+::class\.java\s*\)/g,
  /\b(?:Intent|ComponentName)\(\s*[\w.]+\s*,\s*[\w.]+::class\.java\s*\)/g,
  /[\w.]+::class\.java\s*\??\.(?:name|simpleName)\b/g,
  /\bjavaClass\s*\??\.(?:name|simpleName)\b/g,
];

const SHADOWED = "(?:Intent|ComponentName|getSystemService)";
/** Type parameters, which may hold `:` and nested `<>` but no statement punctuation. */
const TYPE_PARAMS = "(?:<[^(){};=]*> ?)?";

/**
 * The names the allowed class-object shapes rely on may not be declared, aliased, passed or bound again.
 * Whitespace, line breaks included, is collapsed first, so a break between a keyword and the name hides nothing.
 * An allowlist: after the imports, each use is a call `Name(` or a qualifier `Name.`; anything else
 * (a type, a parameter, a lambda parameter, `val`, `typealias`, a bare reference) is refused. A declaration
 * that is itself a call shape (`fun <T> T.Intent(`, `class Intent(`) is refused by its keyword.
 */
export function shadowProblem(text: string): string | null {
  const flat = text.replace(/\s+/g, " ");
  if (new RegExp(`\\bas ${SHADOWED}\\b`).test(flat)) return "`as Intent`, `as ComponentName` or `as getSystemService` is an import alias or a cast to a name the guard relies on";
  const code = flat.replace(/\b(?:import|package) [\w.*]+(?: as \w+)?/g, " ");
  const declared = [
    `\\b(?:class|interface|object|typealias) ${TYPE_PARAMS}${SHADOWED}\\b`,
    `\\b(?:val|var) ${TYPE_PARAMS}(?:[^(){};=]*\\. ?)?${SHADOWED}\\b`,
    `\\b(?:val|var) ?\\([^)]*\\b${SHADOWED}\\b`,
    `\\bfun [^{};=]*?\\b${SHADOWED} ?\\(`,
  ];
  if (declared.some((d) => new RegExp(d).test(code)) || new RegExp(`\\b${SHADOWED}\\b(?! ?[(.])`).test(code)) return "declares, binds or passes Intent, ComponentName or getSystemService: they may only be called or used as a qualifier";
  return null;
}

export function reflectionProblem(text: string): string | null {
  const shadow = shadowProblem(text);
  if (shadow) return shadow;
  if (NAMES.test(text)) return "uses reflection or class loading";
  const rest = ALLOWED_USES.reduce((t, re) => t.replace(re, " "), text);
  if (/::\s*class\b|\bjavaClass\b/.test(rest)) return "reads a class object other than for its name, getSystemService(X::class.java) or Intent(c, X::class.java)";
  return null;
}
