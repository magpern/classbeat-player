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

export function reflectionProblem(text: string): string | null {
  if (NAMES.test(text)) return "uses reflection or class loading";
  const rest = ALLOWED_USES.reduce((t, re) => t.replace(re, " "), text);
  if (/::\s*class\b|\bjavaClass\b|\bfun\s+(?:[\w.<>]+\.)?(?:Intent|ComponentName|getSystemService)\b|\b(?:class|interface|object|typealias|as)\s+(?:Intent|ComponentName|getSystemService)\b/.test(rest)) return "reads a class object other than for its name, getSystemService(X::class.java) or Intent(c, X::class.java)";
  return null;
}
