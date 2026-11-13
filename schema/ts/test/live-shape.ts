// The closed-shape check of the live contract (ADR 0005 section 7: every live schema is closed).
// The same allowlist as python/tests/live_shape.py; that file's docstring lists the rules.
// problems(schema) lists every place a schema could let through a value it does not spell out.

const TYPES = new Set(["object", "array", "string", "integer", "boolean", "null"]);
const ANNOTATIONS = ["$schema", "$id", "title", "description"];
const CONSTRAINTS = [
  "type",
  "const",
  "enum",
  "required",
  "additionalProperties",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
];
const NARROWING = ["if", "then", "else", "not"];
const SHAPE = new Set([...ANNOTATIONS, ...CONSTRAINTS, ...NARROWING, "properties", "items", "$defs", "anyOf", "$ref"]);
const CONDITION = new Set([...ANNOTATIONS, ...CONSTRAINTS, ...NARROWING, "properties", "anyOf", "contains"]);

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => v !== null && typeof v === "object" && !Array.isArray(v);

function typesOf(node: Node): Set<string> | null {
  const t = node.type;
  if (typeof t === "string") return new Set([t]);
  if (Array.isArray(t) && t.length > 0 && t.every((x) => typeof x === "string")) return new Set(t as string[]);
  return null;
}

export function problems(root: unknown): string[] {
  const out: string[] = [];
  const defs = isNode(root) && isNode(root.$defs) ? root.$defs : {};

  const keywords = (node: unknown, path: string, allowed: Set<string>): node is Node => {
    if (!isNode(node)) {
      out.push(`${path}: a schema must be an object, not ${JSON.stringify(node)}`);
      return false;
    }
    const extra = Object.keys(node).filter((k) => !allowed.has(k)).sort();
    if (extra.length > 0) out.push(`${path}: keywords not allowed here: ${extra.join(", ")}`);
    if ("additionalProperties" in node && node.additionalProperties !== false) {
      out.push(`${path}: additionalProperties must be false`);
    }
    return true;
  };

  const condition = (node: unknown, path: string): void => {
    if (!keywords(node, path, CONDITION)) return;
    for (const [name, sub] of Object.entries(isNode(node.properties) ? node.properties : {})) {
      condition(sub, `${path}/properties/${name}`);
    }
    (Array.isArray(node.anyOf) ? node.anyOf : []).forEach((sub, i) => condition(sub, `${path}/anyOf/${i}`));
    for (const key of [...NARROWING, "contains"]) if (key in node) condition(node[key], `${path}/${key}`);
  };

  const shape = (node: unknown, path: string): void => {
    if (!keywords(node, path, SHAPE)) return;
    const types = typesOf(node);
    if ("type" in node && (types === null || [...types].some((t) => !TYPES.has(t)))) {
      out.push(`${path}: type must be one or more of ${[...TYPES].sort().join(", ")}`);
    }
    const ref = node.$ref;
    if (ref !== undefined) {
      if (!(typeof ref === "string" && ref.startsWith("#/$defs/") && ref.slice(8) in defs)) {
        out.push(`${path}: $ref must name an entry of the root's $defs`);
      }
      if (Object.keys(node).some((k) => k !== "$ref" && !ANNOTATIONS.includes(k))) out.push(`${path}: a $ref stands alone`);
    }
    let branches: unknown[] | null = null;
    if ("anyOf" in node) {
      if (Array.isArray(node.anyOf) && node.anyOf.length > 0) branches = node.anyOf;
      else out.push(`${path}: anyOf must be a non-empty list`);
    }
    const typed = types !== null || "const" in node || "enum" in node || ref !== undefined;
    if (!typed && branches === null) out.push(`${path}: untyped: give a type, a const, an enum, a $ref or an anyOf`);
    if (branches !== null && (types !== null || "properties" in node)) out.push(`${path}: anyOf stands for the whole shape here`);
    const objectish = "properties" in node || (types !== null && types.has("object"));
    if (objectish) {
      if (types === null || !types.has("object")) out.push(`${path}: has properties but its type does not allow object`);
      if (node.additionalProperties !== false) out.push(`${path}: an object must have additionalProperties false`);
      if (!isNode(node.properties)) out.push(`${path}: an object must list its properties`);
    }
    if (types !== null && types.has("array")) {
      if (!("items" in node)) out.push(`${path}: an array must have items`);
      if (!("maxItems" in node)) out.push(`${path}: an array must have maxItems`);
    } else if ("items" in node) {
      out.push(`${path}: items on a shape that is not an array`);
    }
    for (const [name, sub] of Object.entries(isNode(node.properties) ? node.properties : {})) {
      shape(sub, `${path}/properties/${name}`);
    }
    if ("items" in node) shape(node.items, `${path}/items`);
    for (const [name, sub] of Object.entries(isNode(node.$defs) ? node.$defs : {})) {
      if (path !== "#") out.push(`${path}: $defs only at the root`);
      shape(sub, `${path}/$defs/${name}`);
    }
    (branches ?? []).forEach((sub, i) => shape(sub, `${path}/anyOf/${i}`));
    for (const key of NARROWING) if (key in node) condition(node[key], `${path}/${key}`);
  };

  shape(root, "#");
  const rootTypes = isNode(root) ? typesOf(root) : null;
  if (rootTypes === null || rootTypes.size !== 1 || !rootTypes.has("object")) out.push("#: the root must be an object");
  return out;
}
