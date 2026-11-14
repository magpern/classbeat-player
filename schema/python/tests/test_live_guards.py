"""Rule guards of the live contract (ADR 0005 section 7; AGENTS.md section 6).

- Rule 2: the companion's `command` action set is exactly the table of ADR 0005 section 4,
  `nudge` moves exactly +-5000 ms (JUMP_MS), and no property name, enum or const value in
  `schema/live/` holds a word of `schema/live/guard/equipment-words.txt`.
- Rule 13 and ADR 0005 sections 3 and 4: what the server delivers to a controller holds no word
  of `schema/live/guard/rider-words.txt` or `schema/live/guard/credential-words.txt`; the control
  code goes to the host only; the phone's `command` has no `slot`.
- Rules 13 and 14, ADR 0007 section 6: exactly `welcome` (its own rider schema), `host_status`,
  `rider_state` and `ended` reach a rider, and none holds a word of
  `schema/live/guard/rider-bound-words.txt` or `credential-words.txt`; a rider sends `hello`
  only, to the server; `rider_state` holds exactly ADR 0007's fields; the join body is exactly
  `session` and `nickname`; the new join code goes to the host only.
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
# Every entry routed to a rider, in full (ADR 0007 section 2): type, schema, from, to.
TO_RIDER = {
    ("welcome", "welcome-rider.schema.json", ("server",), ("rider",)),
    ("host_status", "host-status.schema.json", ("server",), ("controller", "rider")),
    ("rider_state", "rider-state.schema.json", ("host",), ("rider",)),
    ("ended", "ended.schema.json", ("server",), ("host", "controller", "rider")),
}
TO_RIDER_TYPES = {"welcome", "host_status", "rider_state", "ended"}

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
    for file in (
        "equipment-words.txt",
        "rider-words.txt",
        "rider-bound-words.txt",
        "credential-words.txt",
    ):
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


OPENINGS: list[tuple[str, Any]] = [
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
    ("a string without maxLength", lambda d: d["properties"].update(extra={"type": "string"})),
    (
        "a pattern-only string without maxLength",
        lambda d: d["properties"].update(extra={"type": "string", "pattern": "^a+$"}),
    ),
]


@pytest.mark.parametrize(("label", "mutate"), OPENINGS)
def test_the_closed_shape_check_refuses_every_opening(label: str, mutate: Any) -> None:
    doc = schema("ack")
    assert problems(doc) == []
    mutate(doc)
    assert problems(doc) != [], label


# The same labels, in the same order, are pinned in ts/test/live.test.ts: a check dropped from
# one suite fails there.
OPENING_LABELS = [
    "A: a property that accepts anything",
    "B: patternProperties",
    "C: an object subschema without a type",
    "a boolean property schema",
    "a described-only property",
    "unevaluatedProperties",
    "dependentSchemas",
    "prefixItems",
    "additionalProperties true",
    "additionalProperties a schema",
    "an object without additionalProperties",
    "a nested open object",
    "an untyped anyOf branch",
    "allOf",
    "oneOf",
    "a type outside the set",
    "an array without items",
    "an array of anything",
    "a remote $ref",
    "patternProperties inside a condition",
    "a boolean condition",
    "a string without maxLength",
    "a pattern-only string without maxLength",
]


def test_the_closed_shape_check_covers_the_same_23_openings_as_the_ts_suite() -> None:
    assert len(OPENINGS) == 23
    assert [label for label, _ in OPENINGS] == OPENING_LABELS


def _fixed_width(pattern: str) -> int | None:
    """The one length every match of `pattern` has, or None when it varies (stdlib parser)."""
    lo, hi = re._parser.parse(pattern).getwidth()  # type: ignore[attr-defined]  # pyright: ignore
    return lo if lo == hi else None


def _strings_with_a_pattern(node: Any, where: str = "") -> Iterator[tuple[str, dict[str, Any]]]:
    if isinstance(node, dict):
        if isinstance(node.get("pattern"), str):
            yield where, node
        for key, value in node.items():
            yield from _strings_with_a_pattern(value, f"{where}/{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            yield from _strings_with_a_pattern(value, f"{where}/{i}")


def test_max_length_equals_the_length_a_fixed_length_pattern_gives() -> None:
    checked = 0
    for name in names():
        for where, node in _strings_with_a_pattern(schema(name)):
            width = _fixed_width(node["pattern"])
            if width is not None:
                assert node.get("maxLength") == width, (name, where)
                checked += 1
    # Every pattern in schema/live/v1 is fixed-length today (ts/test/live.test.ts pins the same 23).
    assert checked == 23


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
    # The exact pin of ADR 0007 section 6 (it replaces "nothing reaches a rider"): the entries
    # routed to a rider are these four, in full, and a rider sends `hello` only, to the server.
    to_rider = [e for e in ws_entries() if "rider" in e["to"]]
    assert {
        (e["type"], e["schema"], tuple(e["from"]), tuple(e["to"])) for e in to_rider
    } == TO_RIDER
    assert len(to_rider) == len(TO_RIDER)
    assert {e["type"] for e in to_rider} == TO_RIDER_TYPES
    from_rider = [e for e in ws_entries() if "rider" in e["from"]]
    assert [(e["type"], e["schema"], e["to"]) for e in from_rider] == [
        ("hello", "hello.schema.json", ["server"])
    ]
    # Nothing from a rider reaches a rider or a controller (ADR 0007 section 6; it must hold
    # unchanged when PL9 adds readings to the host).
    for entry in ws_entries():
        if "rider" in entry["from"]:
            assert not {"rider", "controller"} & set(entry["to"]), entry


def test_a_riders_welcome_is_its_own_schema_and_the_other_never_says_rider() -> None:
    welcomes = {e["schema"]: e["to"] for e in ws_entries() if e["type"] == "welcome"}
    assert welcomes == {
        "welcome.schema.json": ["host", "controller"],
        "welcome-rider.schema.json": ["rider"],
    }
    assert hits(schema("welcome"), {"rider"}) == []
    assert schema("welcome")["properties"]["role"]["enum"] == ["host", "controller"]
    rider = schema("welcome-rider")
    assert rider["properties"]["role"] == {"type": "string", "const": "rider"}
    assert set(rider["properties"]) == {"v", "type", "role", "hostConnected"}
    assert set(rider["required"]) == set(rider["properties"])


def _rider_bound(message: str) -> list[dict[str, Any]]:
    """Every entry of `message` delivered to a rider; never empty (no skip, no single unpack)."""
    entries = [e for e in ws_entries() if e["type"] == message and "rider" in e["to"]]
    assert entries, message
    return entries


def test_rider_bound_words_are_the_rider_words_but_rider_and_ftp() -> None:
    assert words("rider-bound-words.txt") == words("rider-words.txt") - {"rider", "ftp"}
    assert {"rider", "ftp"} <= words("rider-words.txt")


@pytest.mark.parametrize("message", sorted(TO_RIDER_TYPES))
def test_what_reaches_a_rider_has_no_rider_bound_word(message: str) -> None:
    for entry in _rider_bound(message):
        assert hits(schema_of(entry), words("rider-bound-words.txt")) == [], entry["schema"]


@pytest.mark.parametrize("message", sorted(TO_RIDER_TYPES))
def test_what_reaches_a_rider_has_no_token_code_account_or_device(message: str) -> None:
    for entry in _rider_bound(message):
        assert hits(schema_of(entry), words("credential-words.txt")) == [], entry["schema"]


def test_the_two_exempt_words_appear_only_where_adr_0007_uses_them() -> None:
    # Against the full rider-words.txt: `rider` only as the rider welcome's role and the
    # message's own type, `ftp` only as the FTP test's kind and in `ftpPct`.
    found = {
        entry["schema"]: hits(schema_of(entry), words("rider-words.txt"))
        for entry in ws_entries()
        if "rider" in entry["to"]
    }
    assert {s: h for s, h in found.items() if h} == {
        "welcome-rider.schema.json": ["rider"],
        "rider-state.schema.json": ["ftp", "ftpPct", "rider_state"],
    }


def _shape(node: dict[str, Any]) -> dict[str, Any]:
    """The property names at each level of `rider_state`, as a nested dict (`$ref`s followed)."""
    defs = schema("rider-state")["$defs"]

    def resolve(n: dict[str, Any]) -> dict[str, Any]:
        if "$ref" in n:
            return resolve(defs[n["$ref"].removeprefix("#/$defs/")])
        if "anyOf" in n:
            (obj,) = [b for b in n["anyOf"] if "properties" in b or "$ref" in b]
            return resolve(obj)
        if n.get("type") == "array":
            return resolve(n["items"])
        return n

    out: dict[str, Any] = {}
    for name, sub in node["properties"].items():
        if "anyOf" in sub and all("properties" not in b and "$ref" not in b for b in sub["anyOf"]):
            out[name] = None
            continue
        target = resolve(sub)
        out[name] = _shape(target) if "properties" in target else None
    return out


def test_rider_state_holds_exactly_adr_0007s_fields() -> None:
    effort = {"ftpPct": None, "hrmaxPct": None, "rpe": None}
    zone = {"number": None, "name": None, "effort": effort}
    assert _shape(schema("rider-state")) == {
        "v": None,
        "type": None,
        "run": None,
        "seq": None,
        "status": None,
        "classMs": None,
        "lengthMs": None,
        "classRemainingMs": None,
        "now": {
            "index": None,
            "zone": zone,
            "position": None,
            "test": {"kind": None, "minutes": None},
            "remainingMs": None,
        },
        "next": {"startMs": None, "lengthMs": None, "zone": zone, "position": None},
    }
    doc = schema("rider-state")
    assert set(doc["required"]) == set(doc["properties"])
    assert doc["properties"]["next"]["maxItems"] == 3
    # No cue, no song, no link state, no allowed actions anywhere in it.
    names_in = set(property_names(doc))
    assert not names_in & {"cue", "nextSong", "song", "link", "allowed", "announcement"}


def test_rider_state_comes_from_the_host_and_goes_to_riders_only() -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == "rider_state"]
    assert entry["from"] == ["host"]
    assert entry["to"] == ["rider"]


def test_the_join_body_is_exactly_the_code_and_a_nickname() -> None:
    (route,) = [r for r in routing()["http"] if r["route"] == "POST /api/live/join"]
    assert route["credential"] == "none"
    assert route["body"] == "join-request.schema.json"
    assert route["answer"] == "join-answer.schema.json"
    body = schema("join-request")
    assert set(body["properties"]) == {"session", "nickname"}
    assert set(body["required"]) == {"session", "nickname"}
    assert body["additionalProperties"] is False
    assert set(property_names(body)) == {"session", "nickname"}
    answer = schema("join-answer")
    assert set(property_names(answer)) == {"riderToken"}
    assert answer["properties"]["riderToken"]["pattern"].startswith("^cbp_rdr_")


def test_what_a_host_hears_of_riders_goes_to_the_host_only() -> None:
    for kind in ("rider_joined", "rider_left", "lock_state", "join_code"):
        (entry,) = [e for e in ws_entries() if e["type"] == kind]
        assert (entry["from"], entry["to"]) == (["server"], ["host"]), kind
    for kind in ("drop_rider", "lock", "new_join_code"):
        (entry,) = [e for e in ws_entries() if e["type"] == kind]
        assert (entry["from"], entry["to"]) == (["host"], ["server"]), kind


def test_companion_state_goes_to_controllers_only() -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == "companion_state"]
    assert entry["from"] == ["host"]
    assert entry["to"] == ["controller"]


def test_the_control_code_goes_to_the_host_only() -> None:
    (entry,) = [e for e in ws_entries() if e["type"] == "control_code"]
    assert entry["from"] == ["server"]
    assert entry["to"] == ["host"]
    # The new join code (ADR 0007 section 3) goes to the host only, too.
    (entry,) = [e for e in ws_entries() if e["type"] == "join_code"]
    assert entry["from"] == ["server"]
    assert entry["to"] == ["host"]
    # No other WebSocket message carries a code or a token, except the hello that signs in. The
    # three exempt messages carry exactly one such field each, and only that one.
    credential = words("credential-words.txt")
    exempt = {"control_code": ["code"], "join_code": ["code"], "hello": ["token"]}
    for other in ws_entries():
        props = set(property_names(schema_of(other)))
        found = sorted(p for p in props if set(split_words(p)) & credential)
        assert found == exempt.get(other["type"], []), other["type"]
    assert {e["type"] for e in ws_entries()} >= set(exempt)


def test_phone_command_has_no_slot_and_the_forwarded_one_has_it() -> None:
    phone = schema("command")
    assert "slot" not in set(property_names(phone))
    assert phone["additionalProperties"] is False
    forwarded = schema("command-forwarded")
    assert "slot" in forwarded["required"]
    assert set(forwarded["properties"]) - set(phone["properties"]) == {"slot"}


def test_ack_carries_no_slot() -> None:
    assert "slot" not in set(property_names(schema("ack")))


def _controller_bound(message: str) -> list[dict[str, Any]]:
    """Every entry of `message` delivered to a controller; never empty (no skip, no single unpack:
    `welcome` has two entries, and only the one routed to a controller is checked here, while
    every entry routed to a controller is)."""
    entries = [e for e in ws_entries() if e["type"] == message and "controller" in e["to"]]
    assert entries, message
    return entries


def test_every_entry_routed_to_a_controller_is_checked() -> None:
    checked = [e for m in sorted(TO_CONTROLLER) for e in _controller_bound(m)]
    every = [e for e in ws_entries() if "controller" in e["to"]]
    assert sorted(map(str, checked)) == sorted(map(str, every))


@pytest.mark.parametrize("message", sorted(TO_CONTROLLER))
def test_what_reaches_a_controller_has_no_rider_word(message: str) -> None:
    for entry in _controller_bound(message):
        assert hits(schema_of(entry), words("rider-words.txt")) == [], entry["schema"]


@pytest.mark.parametrize("message", sorted(TO_CONTROLLER))
def test_what_reaches_a_controller_has_no_token_code_account_or_device(message: str) -> None:
    for entry in _controller_bound(message):
        assert hits(schema_of(entry), words("credential-words.txt")) == [], entry["schema"]


def test_http_errors_are_the_closed_enum() -> None:
    codes = set(schema("error")["properties"]["error"]["enum"])
    for route in routing()["http"]:
        assert set(route["errors"]) <= codes, route["route"]
    by_route = {r["route"]: set(r["errors"]) for r in routing()["http"]}
    # Every failure of the cookie route is one answer: it tells nothing about the session.
    assert by_route["POST /api/live/controller"] & {"invalid_code", "controllers_full"} == set()
    assert "cannot_control" not in by_route["POST /api/live/control"]
    # The routing table lists only the answers a route gives: the cookie route never answers 429.
    assert by_route["POST /api/live/controller"] == {
        "invalid_request",
        "body_too_large",
        "cannot_control",
        "internal_error",
    }
    # Every failure of a join is one answer (ADR 0002 section 8): it tells nothing about who is
    # there, and `cannot_join` is the join route's answer only.
    assert (
        by_route["POST /api/live/join"]
        & {
            "invalid_code",
            "controllers_full",
            "sessions_full",
            "cannot_control",
        }
        == set()
    )
    assert [r for r, codes in by_route.items() if "cannot_join" in codes] == ["POST /api/live/join"]
    assert by_route == ROUTE_ERRORS


# The error set of each route, pinned in full (ts/test/live.test.ts pins the same table).
ROUTE_ERRORS: dict[str, set[str]] = {
    "POST /api/live/sessions": {
        "body_too_large",
        "invalid_token",
        "token_unknown",
        "token_expired",
        "token_revoked",
        "sessions_full",
        "too_many_requests",
        "internal_error",
    },
    "POST /api/live/controller": {
        "invalid_request",
        "body_too_large",
        "cannot_control",
        "internal_error",
    },
    "POST /api/live/control": {
        "invalid_request",
        "body_too_large",
        "invalid_code",
        "controllers_full",
        "too_many_requests",
        "internal_error",
    },
    "POST /api/live/join": {
        "invalid_request",
        "body_too_large",
        "cannot_join",
        "too_many_requests",
        "internal_error",
    },
}
