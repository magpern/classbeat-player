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

import { Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, Object3D, Scene, ShaderMaterial } from "three";

const NAMES = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"] as const;
type Bag = Readonly<Record<string, unknown>>;

const defaultsOf = (prototype: object): Bag => Object.freeze(Object.fromEntries(NAMES.map((name) => [name, (prototype as Bag)[name]])));
/** three's own defaults, as read from a plain object and a plain material when this module loads. */
export const DEFAULTS = Object.freeze({ object: defaultsOf(Object3D.prototype), material: defaultsOf(MeshBasicMaterial.prototype) });

const OBJECT_PROTOTYPES: readonly object[] = Object.freeze([Object3D, Scene, Mesh, InstancedMesh, Group].map((c) => c.prototype as object));
const MATERIAL_PROTOTYPES: readonly object[] = Object.freeze([MeshBasicMaterial, ShaderMaterial].map((c) => c.prototype as object));

function refuseUnlessDefault(item: object, kind: "object" | "material"): void {
  const prototypes = kind === "object" ? OBJECT_PROTOTYPES : MATERIAL_PROTOTYPES;
  if (!prototypes.includes(Object.getPrototypeOf(item) as object)) throw new Error(`a scene ${kind} has a prototype that is not a three.js class src/ may use`);
  const defaults = DEFAULTS[kind];
  for (const name of NAMES) {
    if ((item as Bag)[name] !== defaults[name]) throw new Error(`a scene ${kind} carries the render callback ${name}`);
  }
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
