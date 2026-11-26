// A class whose `music.source` is a value this player does not know (a later minor of the class
// format added it, ADR 0017 section 1) is kept and listed as needing a newer player. The class
// schema refuses the value, and its rules that depend on the source (a song list for every source
// but `none`) refuse the rest of the class with it. This module builds the schema that does not
// look at the source, so every other rule still holds. Pure.
import { checkDocument } from "classformat/src/index.ts";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const KNOWN = ["spotify", "swedebeat", "none"];
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** True for a non-empty string that is not one of the sources this player knows. */
export function hasUnknownSource(doc: Record<string, unknown>): boolean {
  const source = isObject(doc.music) ? doc.music.source : undefined;
  return typeof source === "string" && source !== "" && !KNOWN.includes(source);
}

/** The class schema with `music.source` any non-empty string and the rules that read it removed. */
function sourceFreeSchema(classSchema: Json): Json {
  const copy = structuredClone(classSchema);
  const walk = (node: Json): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    const props = node.properties;
    if (isObject(props) && isObject(props.source) && Array.isArray(props.source.enum)) props.source = { type: "string", minLength: 1 };
    if (Array.isArray(node.allOf)) node.allOf = node.allOf.filter((rule: Json) => !JSON.stringify(rule?.if ?? null).includes('"source"'));
    Object.values(node).forEach(walk);
  };
  walk(copy);
  return copy;
}

/** The violations of a document read for listing, leaving its unknown music source aside. */
export function violationsLeavingSourceAside(classSchema: unknown, doc: Record<string, unknown>): readonly (readonly [string, string])[] {
  return checkDocument(sourceFreeSchema(classSchema), doc, "reader");
}
