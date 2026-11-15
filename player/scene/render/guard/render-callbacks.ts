// The run-time half of closing the three.js options-object route to the renderer (#556). A three.js
// options object can carry a callback that three later calls with the live renderer (`onBeforeCompile`
// and the others). Lint closes the spellings it can see; this closes what it cannot (a key built at run
// time, `__proto__` through `Object.fromEntries`, a changed prototype). It lives outside src/ because it
// must name the callbacks and the prototypes, which the src/ fences ban.
//
// It checks what each object and material DOES, never what it owns: for each of the five callback names,
// the value read through the whole prototype chain must be three's own default, captured when this module
// loads (so a later change cannot move the baseline), and the object's prototype must be the prototype of
// one of the three.js classes src/ may use. A supplied callback, a subclass method, a swapped `__proto__`
// and a prototype changed through `setValues` all fail one or the other.
//
// It runs once, when the rig is built, never per frame. Whatever is added to the scene or given a new
// material after that needs the same check. Import this module before any module that builds a scene
// (`src/index.ts` and `src/rig.ts` do, first), so the defaults are captured before anything can change them.
//
// The capture is eager and does NOT depend on import order alone. ES modules run depth-first, so with
// `src/renderer.ts` as the entry (as demo/main.ts uses it) the model, the loop, the bursts, the light
// calculations and the lookup run before rig.ts reaches this module. That is safe because nothing in
// src/ can reach a prototype, so nothing there can move a default: lint bans `prototype`, `__proto__`,
// `constructor`, the callback names (member, literal key and destructured), `Object` reflection and
// subclasses (eslint.config.js, src/ fences), and src/ may import only three.js by allowlisted names, its
// siblings, the model and this file's one export. guard/ itself is fenced the same way, so it cannot
// import tools/. Letting src/ reach a prototype would be a reviewed change of those fences, and this
// module would then have to be the first import of every entry. test/guard-fence.test.ts loads the
// renderer.ts entry and shows no default moved.

import { Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, Object3D, Scene, ShaderMaterial } from "three";

const NAMES = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"] as const;
type Bag = Readonly<Record<string, unknown>>;
/** What `callbacksOf` reads, each by a literal member, in the order of NAMES. No key is built at run time anywhere here (the guard/ lint fence allows none). */
interface Callbacks { readonly onBeforeRender?: unknown; readonly onAfterRender?: unknown; readonly onBeforeCompile?: unknown; readonly onBeforeShadow?: unknown; readonly onAfterShadow?: unknown }
type Reads = readonly [unknown, unknown, unknown, unknown, unknown];
const callbacksOf = (o: object): Reads => {
  const c = o as Callbacks;
  return Object.freeze([c.onBeforeRender, c.onAfterRender, c.onBeforeCompile, c.onBeforeShadow, c.onAfterShadow] as const);
};
/** three's own defaults, read from a plain object and a plain material when this module loads. Not exported: a test compares against three's own prototypes. */
const DEFAULTS = Object.freeze({ object: callbacksOf(Object3D.prototype), material: callbacksOf(MeshBasicMaterial.prototype) });

const OBJECT_PROTOTYPES: readonly object[] = Object.freeze([Object3D, Scene, Mesh, InstancedMesh, Group].map((c) => c.prototype as object));
const MATERIAL_PROTOTYPES: readonly object[] = Object.freeze([MeshBasicMaterial, ShaderMaterial].map((c) => c.prototype as object));

function refuseUnlessDefault(item: object, kind: "object" | "material"): void {
  const prototypes = kind === "object" ? OBJECT_PROTOTYPES : MATERIAL_PROTOTYPES;
  if (!prototypes.includes(Object.getPrototypeOf(item) as object)) throw new Error(`a scene ${kind} has a prototype that is not a three.js class src/ may use`);
  const defaults = kind === "object" ? DEFAULTS.object : DEFAULTS.material;
  const found = callbacksOf(item);
  NAMES.forEach((name, i) => {
    if (found.at(i) !== defaults.at(i)) throw new Error(`a scene ${kind} carries the render callback ${name}`);
  });
}

/** The materials an object holds, by whatever field: every own value that is a material or an array of them. */
function materialsOf(object: object): Material[] {
  return Object.values(object).flatMap((value: unknown) => (Array.isArray(value) ? value : [value])).filter((v): v is Material => v instanceof Material || (typeof v === "object" && v !== null && (v as Bag).isMaterial === true));
}

/** Throws if `root`, any object below it or any material any of them holds does something other than three's defaults. */
export function assertNoRenderCallbacks(root: Object3D): void {
  root.traverse((object) => {
    refuseUnlessDefault(object, "object");
    for (const material of materialsOf(object)) refuseUnlessDefault(material, "material");
  });
}
