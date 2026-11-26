// A class whose `music.source` is a value this player does not know (a later minor of the class
// format added it, ADR 0017 section 1) is kept and listed as needing a newer player. The class
// schema refuses the value, and its rules that depend on the source (a song list for every source
// but `none`) refuse the rest of the class with it. This module builds the schema that does not
// look at the source, so every other rule still holds. Pure.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KNOWN = ["spotify", "swedebeat", "none"];
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** True for a non-empty string that is not one of the sources this player knows. */
export function hasUnknownSource(doc: Record<string, unknown>): boolean {
  const source = isObject(doc.music) ? doc.music.source : undefined;
  return typeof source === "string" && source !== "" && !KNOWN.includes(source);
}

/** True for an `if` that tests exactly `music.source`: `{properties: {music: {properties: {source: ...}}}}`, nothing else. */
function testsOnlyMusicSource(cond: Json): boolean {
  const only = (node: Json, key: string): Json => (isObject(node) && Object.keys(node).length === 1 && isObject(node[key]) ? node[key] : null);
  const music = only(only(cond, "properties"), "music");
  const source = only(only(music, "properties"), "source");
  return source !== null;
}

/** The class schema with `music.source` any non-empty string and the rules that read it removed. */
export function sourceFreeSchema(classSchema: Json): Json {
  const copy = structuredClone(classSchema);
  const walk = (node: Json): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    const props = node.properties;
    if (isObject(props) && isObject(props.source) && Array.isArray(props.source.enum)) props.source = { type: "string", minLength: 1 };
    if (Array.isArray(node.allOf)) node.allOf = node.allOf.filter((rule: Json) => !testsOnlyMusicSource(rule?.if));
    Object.values(node).forEach(walk);
  };
  walk(copy);
  return copy;
}
