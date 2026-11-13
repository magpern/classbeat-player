"""The closed-shape check of the live contract (ADR 0005 section 7: every live schema is closed).

An allowlist, not a blocklist. `problems(schema)` lists every place where a live schema could
let a value through that its author did not spell out:

- a schema is a JSON object (never the boolean schemas `true` or `false`) and uses only the
  keywords in `SHAPE` (where a value is described) or `CONDITION` (inside `if`, `then`, `else`,
  `not`, `contains`, which only narrow); `patternProperties`, `unevaluated*`, `dependent*`,
  `prefixItems`, `additionalItems`, `allOf`, `oneOf` and every other keyword are refused;
- every shape is typed: a `type` from `TYPES`, a `const`, an `enum`, a local `$ref` to an entry
  of the root's `$defs`, or an `anyOf` whose branches are all typed (an empty `{}` is not);
- a shape that has `properties`, or whose `type` allows `object`, has `type` allowing `object`,
  `properties`, and `additionalProperties` exactly `false`;
- a shape whose `type` allows `array` has `items` (a typed shape) and `maxItems`.

The Python and TypeScript suites implement the same check (`ts/test/live-shape.ts`).
"""

from __future__ import annotations

from typing import Any

TYPES = frozenset({"object", "array", "string", "integer", "boolean", "null"})
ANNOTATIONS = frozenset({"$schema", "$id", "title", "description"})
CONSTRAINTS = frozenset(
    {
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
    }
)
NARROWING = frozenset({"if", "then", "else", "not"})
SHAPE = ANNOTATIONS | CONSTRAINTS | NARROWING | {"properties", "items", "$defs", "anyOf", "$ref"}
CONDITION = ANNOTATIONS | CONSTRAINTS | NARROWING | {"properties", "anyOf", "contains"}


def _types(node: dict[str, Any]) -> set[str] | None:
    t = node.get("type")
    if isinstance(t, str):
        return {t}
    if isinstance(t, list) and t and all(isinstance(x, str) for x in t):
        return set(t)
    return None


def problems(root: Any) -> list[str]:
    out: list[str] = []
    defs = root.get("$defs", {}) if isinstance(root, dict) else {}

    def keywords(node: Any, path: str, allowed: frozenset[str] | set[str]) -> bool:
        if not isinstance(node, dict):
            out.append(f"{path}: a schema must be an object, not {node!r}")
            return False
        extra = sorted(set(node) - set(allowed))
        if extra:
            out.append(f"{path}: keywords not allowed here: {extra}")
        if "additionalProperties" in node and node["additionalProperties"] is not False:
            out.append(f"{path}: additionalProperties must be false")
        return True

    def condition(node: Any, path: str) -> None:
        if not keywords(node, path, CONDITION):
            return
        for name, sub in (node.get("properties") or {}).items():
            condition(sub, f"{path}/properties/{name}")
        for i, sub in enumerate(node.get("anyOf") or []):
            condition(sub, f"{path}/anyOf/{i}")
        for key in ("if", "then", "else", "not", "contains"):
            if key in node:
                condition(node[key], f"{path}/{key}")

    def shape(node: Any, path: str, allowed: frozenset[str] | set[str] = SHAPE) -> None:
        if not keywords(node, path, allowed):
            return
        types = _types(node)
        if "type" in node and (types is None or not types <= TYPES):
            out.append(f"{path}: type must be one or more of {sorted(TYPES)}")
        ref = node.get("$ref")
        if ref is not None:
            if not (isinstance(ref, str) and ref.startswith("#/$defs/") and ref[8:] in defs):
                out.append(f"{path}: $ref must name an entry of the root's $defs")
            if set(node) - ANNOTATIONS - {"$ref"}:
                out.append(f"{path}: a $ref stands alone")
        branches = node.get("anyOf")
        if branches is not None and not (isinstance(branches, list) and branches):
            out.append(f"{path}: anyOf must be a non-empty list")
            branches = None
        typed = types is not None or "const" in node or "enum" in node or ref is not None
        if not typed and branches is None:
            out.append(f"{path}: untyped: give a type, a const, an enum, a $ref or an anyOf")
        if branches is not None and (types is not None or "properties" in node):
            out.append(f"{path}: anyOf stands for the whole shape here")
        objectish = "properties" in node or (types is not None and "object" in types)
        if objectish:
            if types is None or "object" not in types:
                out.append(f"{path}: has properties but its type does not allow object")
            if node.get("additionalProperties") is not False:
                out.append(f"{path}: an object must have additionalProperties false")
            if not isinstance(node.get("properties"), dict):
                out.append(f"{path}: an object must list its properties")
        if types is not None and "array" in types:
            if "items" not in node:
                out.append(f"{path}: an array must have items")
            if "maxItems" not in node:
                out.append(f"{path}: an array must have maxItems")
        elif "items" in node:
            out.append(f"{path}: items on a shape that is not an array")
        for name, sub in (node.get("properties") or {}).items():
            shape(sub, f"{path}/properties/{name}")
        if "items" in node:
            shape(node["items"], f"{path}/items")
        for name, sub in (node.get("$defs") or {}).items():
            if path != "#":
                out.append(f"{path}: $defs only at the root")
            shape(sub, f"{path}/$defs/{name}")
        for i, sub in enumerate(branches or []):
            shape(sub, f"{path}/anyOf/{i}")
        for key in NARROWING:
            if key in node:
                condition(node[key], f"{path}/{key}")

    shape(root, "#")
    if isinstance(root, dict) and _types(root) != {"object"}:
        out.append("#: the root must be an object")
    return out
