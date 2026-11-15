// The options-object route to the renderer (#556): a three.js options object, a changed prototype or a
// subclass can give an object or material a callback that three calls with the live renderer. The guard
// (guard/render-callbacks.ts) checks what each object and material does, and the rig runs it when built.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Scene, ShaderMaterial } from "three";
import * as guardModule from "../guard/render-callbacks.ts";
import { assertNoRenderCallbacks } from "../guard/render-callbacks.ts";
import { SceneRig } from "../src/rig.ts";
import { RENDER_DIR, tokensFromFile } from "../tools/tokens-file.ts";

const CALLBACKS = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"];
const noop = () => undefined;
const REFUSED = /render callback|prototype/;
const quietly = <T>(build: () => T): T => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return build();
  } finally {
    console.warn = warn;
  }
};
const viaOptions = (options: object): MeshBasicMaterial => quietly(() => new MeshBasicMaterial(options));
const sceneWith = (material: object | object[]): Scene => new Scene().add(new Mesh(new PlaneGeometry(1, 1), material as MeshBasicMaterial));
const runtimeKey = (parts: string[]): string => parts.join(""); // a key that only exists at run time
const fromEntries = (key: string, value: unknown): object => Object.fromEntries([[key, value]]);
/** A material that really carries `fn` as onBeforeCompile, built through an options object. */
const carrying = (): MeshBasicMaterial => viaOptions({ onBeforeCompile: noop });

test("a clean rig, and three's own default callbacks, pass; the defaults are three's real functions", () => {
  assert.doesNotThrow(() => new SceneRig(tokensFromFile()));
  assert.doesNotThrow(() => assertNoRenderCallbacks(sceneWith(new MeshBasicMaterial({ transparent: true }))));
  assert.doesNotThrow(() => assertNoRenderCallbacks(sceneWith(new ShaderMaterial())));
  assert.doesNotThrow(() => assertNoRenderCallbacks(new Scene().add(new Group().add(new Object3D()))));
  for (const name of ["onBeforeRender", "onAfterRender", "onBeforeShadow", "onAfterShadow"]) assert.equal(typeof (Object3D.prototype as unknown as Record<string, unknown>)[name], "function", name);
  for (const name of ["onBeforeRender", "onBeforeCompile"]) assert.equal(typeof (MeshBasicMaterial.prototype as unknown as Record<string, unknown>)[name], "function", name); // each class has only its own callbacks, the rest read undefined
});

test("prototype allowlist: a swapped prototype that is a clean three.js instance changes no callback, so only the prototype check refuses it", () => {
  const read = (o: object, name: string) => (o as unknown as Record<string, unknown>)[name];
  const material = new MeshBasicMaterial();
  Object.setPrototypeOf(material, new MeshBasicMaterial());
  for (const name of CALLBACKS) assert.equal(read(material, name), read(MeshBasicMaterial.prototype, name), name); // each callback still reads as three's own
  assert.throws(() => assertNoRenderCallbacks(sceneWith(material)), /prototype/);
  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  Object.setPrototypeOf(mesh, new Mesh());
  assert.throws(() => assertNoRenderCallbacks(new Scene().add(mesh)), /prototype/);
  const viaKey = viaOptions(fromEntries(runtimeKey(["__pro", "to__"]), new MeshBasicMaterial())); // the same swap, through an options object
  assert.throws(() => assertNoRenderCallbacks(sceneWith(viaKey)), /prototype/);
});

test("DEFAULTS is not exported: the module's only export is assertNoRenderCallbacks", () => {
  assert.deepEqual(Object.keys(guardModule), ["assertNoRenderCallbacks"]);
});

// three's setValues keeps only keys the material already has (onBeforeRender and onBeforeCompile) and drops the rest.
for (const name of CALLBACKS) {
  test(`${name}: through an options object (plain or with a key built at run time) it is refused or never kept; assigned, it is refused`, () => {
    for (const options of [fromEntries(name, noop), fromEntries(runtimeKey(["on", ...name.split(/(?=[A-Z])/).slice(1)]), noop)]) {
      const material = viaOptions(options);
      if (name === "onBeforeRender" || name === "onBeforeCompile") assert.throws(() => assertNoRenderCallbacks(sceneWith(material)), REFUSED);
      else assert.doesNotThrow(() => assertNoRenderCallbacks(sceneWith(material)));
    }
    const material = new MeshBasicMaterial();
    Object.assign(material, fromEntries(name, noop));
    assert.throws(() => assertNoRenderCallbacks(sceneWith(material)), REFUSED);
    assert.throws(() => assertNoRenderCallbacks(sceneWith([new MeshBasicMaterial(), material])), REFUSED);
    const holder = new Object3D();
    Object.assign(holder, fromEntries(name, noop));
    assert.throws(() => assertNoRenderCallbacks(new Scene().add(holder)), REFUSED);
  });
}

test("route: a __proto__ key in an options object (built with Object.fromEntries) swaps the prototype and is refused", () => {
  const material = viaOptions(fromEntries(runtimeKey(["__pro", "to__"]), carrying()));
  assert.equal(material.onBeforeCompile, (Object.getPrototypeOf(material) as MeshBasicMaterial).onBeforeCompile); // the callback does arrive
  assert.throws(() => assertNoRenderCallbacks(sceneWith(material)), REFUSED);
  const toPlain = viaOptions(fromEntries(runtimeKey(["__pro", "to__"]), { onBeforeCompile: noop, onBeforeRender: noop }));
  assert.throws(() => assertNoRenderCallbacks(sceneWith(toPlain)), REFUSED);
});

test("route: setValues called on a class prototype changes every later instance, and is refused", () => {
  const proto = MeshBasicMaterial.prototype;
  try {
    quietly(() => proto.setValues(fromEntries(runtimeKey(["onBefore", "Compile"]), noop)));
    assert.throws(() => assertNoRenderCallbacks(sceneWith(new MeshBasicMaterial())), REFUSED);
  } finally {
    Reflect.deleteProperty(proto, "onBeforeCompile");
  }
  // The rig's own material is a ShaderMaterial (its one fullscreen pass): the same route on that class's prototype is refused when the rig is built.
  const shaderProto = ShaderMaterial.prototype;
  try {
    quietly(() => shaderProto.setValues(fromEntries(runtimeKey(["onBefore", "Compile"]), noop)));
    assert.throws(() => new SceneRig(tokensFromFile()), REFUSED);
  } finally {
    Reflect.deleteProperty(shaderProto, "onBeforeCompile");
  }
  assert.doesNotThrow(() => new SceneRig(tokensFromFile()));
});

test("route: a subclass method is refused, on a material and on an object", () => {
  class SubMaterial extends MeshBasicMaterial { override onBeforeCompile(): void {} }
  class SubMesh extends Mesh { override onBeforeRender(): void {} }
  assert.throws(() => assertNoRenderCallbacks(sceneWith(new SubMaterial())), REFUSED);
  assert.throws(() => assertNoRenderCallbacks(new Scene().add(new SubMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()))), REFUSED);
});

test("route: scene.overrideMaterial, customDepthMaterial and customDistanceMaterial are walked", () => {
  const scene = sceneWith(new MeshBasicMaterial());
  scene.overrideMaterial = carrying();
  assert.throws(() => assertNoRenderCallbacks(scene), REFUSED);
  for (const field of ["customDepthMaterial", "customDistanceMaterial"] as const) {
    const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
    mesh[field] = carrying();
    assert.throws(() => assertNoRenderCallbacks(new Scene().add(mesh)), REFUSED, field);
  }
  const holder = Object.assign(new Object3D(), { someNewMaterialField: [new MeshBasicMaterial(), carrying()] });
  assert.throws(() => assertNoRenderCallbacks(new Scene().add(holder)), REFUSED);
});

test("wiring: SceneRig runs the guard when it is built (a poisoned class makes the constructor throw)", () => {
  const proto = Mesh.prototype as unknown as Record<string, unknown>;
  try {
    proto.onAfterRender = noop;
    assert.throws(() => new SceneRig(tokensFromFile()), REFUSED);
  } finally {
    Reflect.deleteProperty(proto, "onAfterRender");
  }
});

test("order: the guard is imported before anything that builds a scene, in the entry module and in the rig", () => {
  const firstImport = (file: string) => /^\s*import[^;]*from\s*"([^"]+)"|^\s*import\s*"([^"]+)"/m.exec(readFileSync(join(RENDER_DIR, file), "utf8").replace(/^\/\/.*$/gm, ""));
  const index = firstImport("src/index.ts");
  assert.equal(index?.[2], "../guard/render-callbacks.ts");
  assert.equal(firstImport("src/rig.ts")?.[1], "../guard/render-callbacks.ts");
});
