"""Rule guards of the live contract (ADR 0005 section 7; AGENTS.md section 6).

- Rule 2: the companion's `command` action set is exactly the table of ADR 0005 section 4,
  `nudge` moves exactly +-5000 ms (JUMP_MS), and no property name, enum or const value in
  `schema/live/` holds a word of `schema/live/guard/equipment-words.txt`.
- Rule 13 and ADR 0005 sections 3 and 4: what the server delivers to a controller holds no word
  of `schema/live/guard/rider-words.txt` or `schema/live/guard/credential-words.txt`; the control
  code goes to the host only; the phone's `command` has no `slot`.
- Every object in every live schema is closed.

Changing an expected list here is a rule-sensitive pull request.
"""

from __future__ import annotations

import itertools
import re
from collections.abc import Iterator
from typing import Any

import pytest
from live_shape import problems
from live_vectors import LIVE, load, names, routing, schema, validator, words

ACTIONS = ["start", "pause", "resume", "skip", "nudge", "undo_resync"]
JUMP_MS = 5000
TO_CONTROLLER = {"welcome", "host_status", "companion_state", "ack", "ended"}
FROM_CONTROLLER = {"hello", "command"}

_SEPARATORS = re.compile(r"[\s_\-./:]+")
_CASE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def split_words(name: str) -> list[str]:
    """Whole words of a name: split at `_`, `-`, spaces and case changes, lower-cased."""
    return [w.lower() for part in _SEPARATORS.split(name) for w in _CASE.split(part) if w]


def terms(node: Any) -> Iterator[str]:
    """Every property name, `$defs` key, `required` entry, enum and const string in a schema."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("properties", "$defs") and isinstance(value, dict):
                yield from value
            elif key in ("required", "enum") and isinstance(value, list):
                yield from (v for v in value if isinstance(v, str))
            elif key == "const" and isinstance(value, str):
                yield value
            yield from terms(value)
    elif isinstance(node, list):
        for item in node:
            yield from terms(item)


def hits(node: Any, forbidden: set[str]) -> list[str]:
    return sorted({t for t in terms(node) if set(split_words(t)) & forbidden})


def property_names(node: Any) -> Iterator[str]:
    """Every property name at any depth, conditions included."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "properties" and isinstance(value, dict):
                yield from value
            yield from property_names(value)
    elif isinstance(node, list):
        for item in node:
            yield from property_names(item)


def ws_entries() -> list[dict[str, Any]]:
    return routing()["messages"]


def schema_of(entry: dict[str, Any]) -> dict[str, Any]:
    return schema(entry["schema"].removesuffix(".schema.json"))


# ---- the word splitter itself --------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("targetPower", ["target", "power"]),
        ("set_resistance", ["set", "resistance"]),
        ("ERG-mode", ["erg", "mode"]),
        ("riderCount", ["rider", "count"]),
        ("classRemainingMs", ["class", "remaining", "ms"]),
        ("FTMSControl", ["ftms", "control"]),
        ("off the list", ["off", "the", "list"]),
    ],
)
def test_names_split_into_whole_words(name: str, expected: list[str]) -> None:
    assert split_words(name) == expected


def test_whole_words_only() -> None:
    # "leveled" or "powered" would not be "level" or "power"; "targetPower" is.
    assert hits({"properties": {"powered": {}}}, {"power"}) == []
    assert hits({"properties": {"targetPower": {}}}, {"power"}) == ["targetPower"]
    assert hits({"enum": ["set_resistance"]}, {"resistance"}) == ["set_resistance"]


def test_guard_word_files_hold_the_words_adr_0005_names() -> None:
    equipment = words("equipment-words.txt")
    for word in ("resistance", "incline", "brake", "speed", "power", "gear", "level", "erg"):
        assert word in equipment
    for word in ("target", "slope", "watts"):
        assert word in equipment
    assert {"nickname", "reading", "rider", "presence", "count"} <= words("rider-words.txt")
    assert {"token", "code", "account", "device"} <= words("credential-words.txt")
    for file in ("equipment-words.txt", "rider-words.txt", "credential-words.txt"):
        for word in words(file):
            assert split_words(word) == [word], (file, word)


# ---- rule 2: the command set and no equipment words ----------------------------------------


@pytest.mark.parametrize("name", ["command", "command-forwarded"])
def test_command_action_enum_is_exactly_the_adr_table(name: str) -> None:
    action = schema(name)["properties"]["action"]
    assert action["type"] == "string"
    assert action["enum"] == ACTIONS


def test_companion_state_allowed_lists_only_the_adr_actions() -> None:
    allowed = schema("companion-state")["properties"]["allowed"]
    assert allowed["items"]["enum"] == ACTIONS
    assert allowed["uniqueItems"] is True


@pytest.mark.parametrize("name", ["command", "command-forwarded"])
def test_nudge_moves_exactly_jump_ms(name: str) -> None:
    assert schema(name)["properties"]["deltaMs"]["enum"] == [JUMP_MS, -JUMP_MS]
    check = validator(name)
    base: dict[str, Any] = {
        "v": 1,
        "type": "command",
        "id": "dGFwLTAwMDAwMDAwMDAwMQ",
        "run": "Q2xhc3NSdW4tMDAwMDAwMQ",
        "basis": 3,
    }
    if name == "command-forwarded":
        base["slot"] = 1
    deltas: list[int | None] = [None, JUMP_MS, -JUMP_MS, 1000, 10000, -10000, 0]
    for action, delta in itertools.product(ACTIONS + ["previous", "jump"], deltas):
        doc = {**base, "action": action}
        if delta is not None:
            doc["deltaMs"] = delta
        ok = action in ACTIONS and (
            (action == "nudge" and delta in (JUMP_MS, -JUMP_MS))
            or (action != "nudge" and delta is None)
        )
        assert check.is_valid(doc) is ok, (action, delta)


def test_no_live_schema_holds_an_equipment_word() -> None:
    forbidden = words("equipment-words.txt")
    found = {name: hits(schema(name), forbidden) for name in names()}
    assert {name: h for name, h in found.items() if h} == {}
    for entry in routing()["messages"]:
        assert not set(split_words(entry["type"])) & forbidden, entry["type"]
    for route in routing()["http"]:
        for code in route["errors"]:
            assert not set(split_words(code)) & forbidden, code
    # Every JSON file under schema/live/ (examples aside, which hold refused shapes on purpose).
    for path in sorted(LIVE.rglob("*.json")):
        if "examples" not in path.parts:
            assert hits(load(path), forbidden) == [], path


# ---- closed objects --------------------------------------------------------------------------


@pytest.mark.parametrize("name", names())
def test_every_live_schema_is_closed(name: str) -> None:
    assert problems(schema(name)) == []


_TYPED_OBJECT = {"type": "object", "additionalProperties": False, "properties": {}}


@pytest.mark.parametrize(
    ("label", "mutate"),
    [
        # The reviewer's mutations A to C of PR #176.
        ("A: a property that accepts anything", lambda d: d["properties"].update(meta={})),
        ("B: patternProperties", lambda d: d.update(patternProperties={"^x": {}})),
        (
            "C: an object subschema without a type",
            lambda d: d["properties"].update(extra={"properties": {"x": {}}}),
        ),
        ("a boolean property schema", lambda d: d["properties"].update(extra=True)),
        ("a described-only property", lambda d: d["properties"].update(extra={"title": "x"})),
        ("unevaluatedProperties", lambda d: d.update(unevaluatedProperties=False)),
        ("dependentSchemas", lambda d: d.update(dependentSchemas={"v": {}})),
        (
            "prefixItems",
            lambda d: d["properties"].update(
                extra={
                    "type": "array",
                    "maxItems": 1,
                    "prefixItems": [{}],
                    "items": {"type": "null"},
                }
            ),
        ),
        ("additionalProperties true", lambda d: d.update(additionalProperties=True)),
        ("additionalProperties a schema", lambda d: d.update(additionalProperties={})),
        ("an object without additionalProperties", lambda d: d.pop("additionalProperties")),
        (
            "a nested open object",
            lambda d: d["properties"].update(
                extra={"type": "object", "properties": {"x": {"type": "string"}}}
            ),
        ),
        (
            "an untyped anyOf branch",
            lambda d: d["properties"].update(extra={"anyOf": [{"type": "null"}, {}]}),
        ),
        ("allOf", lambda d: d.update(allOf=[_TYPED_OBJECT])),
        ("oneOf", lambda d: d["properties"].update(extra={"oneOf": [{"type": "null"}]})),
        ("a type outside the set", lambda d: d["properties"].update(extra={"type": "number"})),
        (
            "an array without items",
            lambda d: d["properties"].update(extra={"type": "array", "maxItems": 1}),
        ),
        (
            "an array of anything",
            lambda d: d["properties"].update(extra={"type": "array", "maxItems": 1, "items": {}}),
        ),
        ("a remote $ref", lambda d: d["properties"].update(extra={"$ref": "other.schema.json"})),
        (
            "patternProperties inside a condition",
            lambda d: d.update({"if": {"patternProperties": {"^x": {}}}}),
        ),
        ("a boolean condition", lambda d: d.update({"not": False})),
    ],
)
def test_the_closed_shape_check_refuses_every_opening(label: str, mutate: Any) -> None:
    doc = schema("ack")
    assert problems(doc) == []
    mutate(doc)
    assert problems(doc) != [], label


# ---- rule 13, ADR 0005 sections 3 and 4: what reaches a controller ---------------------------


def test_routing_lists_every_websocket_schema_once_with_its_type() -> None:
    http = routing()["http"]
    http_schemas = {e["body"] for e in http if e["body"]} | {e["answer"] for e in http}
    http_schemas.add(routing()["errorSchema"])
    ws = [e["schema"] for e in ws_entries()]
    assert len(ws) == len(set(ws))
    assert sorted(ws + sorted(http_schemas)) == sorted(f"{n}.schema.json" for n in names())
    for entry in ws_entries():
        assert schema_of(entry)["properties"]["type"]["const"] == entry["type"]
        assert schema_of(entry)["properties"]["v"]["const"] == 1


def test_what_a_controller_receives_and_sends_is_pinned() -> None:
    to_ctl = {e["type"] for e in ws_entries() if "controller" in e["to"]}
    from_ctl = {e["type"] for e in ws_entries() if "controller" in e["from"]}
    assert to_ctl == TO_CONTROLLER
    assert from_ctl == FROM_CONTROLLER
    for entry in ws_entries():
        if "controller" in entry["from"]:
            assert entry["to"] == ["server"], entry


def test_no_message_reaches_a_rider_and_a_rider_sends_only_hello() -> None:
    for entry in ws_entries():
        assert "rider" not in entry["to"], entry
        if "rider" in entry["from"]:
            assert entry["type"] == "hello", entry


def test_companion_state_goes_to_controllers_only() -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == "companion_state"]
    assert entry["from"] == ["host"]
    assert entry["to"] == ["controller"]


def test_the_control_code_goes_to_the_host_only() -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == "control_code"]
    assert entry["from"] == ["server"]
    assert entry["to"] == ["host"]
    # No other WebSocket message carries a code or a token, except the hello that signs in.
    credential = words("credential-words.txt")
    for other in ws_entries():
        if other["type"] in ("control_code", "hello"):
            continue
        props = set(property_names(schema_of(other)))
        assert not [p for p in props if set(split_words(p)) & credential], other["type"]


def test_phone_command_has_no_slot_and_the_forwarded_one_has_it() -> None:
    phone = schema("command")
    assert "slot" not in set(property_names(phone))
    assert phone["additionalProperties"] is False
    forwarded = schema("command-forwarded")
    assert "slot" in forwarded["required"]
    assert set(forwarded["properties"]) - set(phone["properties"]) == {"slot"}


def test_ack_carries_no_slot() -> None:
    assert "slot" not in set(property_names(schema("ack")))


@pytest.mark.parametrize("message", sorted(TO_CONTROLLER))
def test_what_reaches_a_controller_has_no_rider_word(message: str) -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == message]
    assert hits(schema_of(entry), words("rider-words.txt")) == []


@pytest.mark.parametrize("message", sorted(TO_CONTROLLER))
def test_what_reaches_a_controller_has_no_token_code_account_or_device(message: str) -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == message]
    assert hits(schema_of(entry), words("credential-words.txt")) == []


def test_http_errors_are_the_closed_enum() -> None:
    codes = set(schema("error")["properties"]["error"]["enum"])
    for route in routing()["http"]:
        assert set(route["errors"]) <= codes, route["route"]
    by_route = {r["route"]: set(r["errors"]) for r in routing()["http"]}
    # Every failure of the cookie route is one answer: it tells nothing about the session.
    assert by_route["POST /api/live/controller"] & {"invalid_code", "controllers_full"} == set()
    assert "cannot_control" not in by_route["POST /api/live/control"]
