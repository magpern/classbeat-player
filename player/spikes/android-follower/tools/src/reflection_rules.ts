// Reflection and class loading get around every name list, so none is allowed. Pure: text in, problem out.
// An allowlist where the code allows one: a class object may be read only for its name, or handed straight
// to a call as an argument (`getSystemService(X::class.java)`, `Intent(this, X::class.java)`).

/** Reflection API names, refused wherever they appear (a class object bound to a variable gets here too). */
const API = /Class\.forName|java\.lang\.reflect|kotlin\.reflect|\.getMethods?\(|\.getDeclared\w+\(|\.getFields?\(|\.getConstructors?\(|\bgetClass\b|\bMethodHandles?\b|ClassLoader|\.invoke\s*\(|\b(?:methods|declaredMethods|fields|declaredFields|constructors|declaredConstructors)\b/;

/** `javaClass` and `::class.java` not followed by `.name`/`.simpleName`; `::class.java` may also end an argument. */
const JAVA_CLASS = /\bjavaClass\b(?!\s*\??\.(?:name|simpleName)\b)|::class\.java(?!\s*\??\.(?:name|simpleName)\b)(?!\s*[,)])/;

export function reflectionProblem(text: string): string | null {
  if (API.test(text)) return "uses reflection or class loading";
  if (JAVA_CLASS.test(text)) return "reads a class object other than for its name or as a call argument";
  return null;
}
