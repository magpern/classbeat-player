// The options-object route to the renderer: a material built from an options object that carries a
// render callback, including one whose key is computed at run time, is refused at build time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Scene, ShaderMaterial } from "three";
import { assertNoRenderCallbacks } from "../src/render-callbacks.ts";
import { SceneRig } from "../src/rig.ts";
import { tokensFromFile } from "../tools/tokens-file.ts";

const CALLBACKS = ["onBeforeRender", "onAfterRender", "onBeforeCompile", "onBeforeShadow", "onAfterShadow"];
const noop = () => undefined;
const sceneWith = (material: object | object[]): Scene => {
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(1, 1), material as MeshBasicMaterial));
  return scene;
};

test("a clean rig, and three's own default callbacks, pass", () => {
  assert.doesNotThrow(() => new SceneRig(tokensFromFile()));
  assert.doesNotThrow(() => assertNoRenderCallbacks(sceneWith(new MeshBasicMaterial({ transparent: true }))));
  assert.doesNotThrow(() => assertNoRenderCallbacks(sceneWith(new ShaderMaterial())));
});

// three's setValues keeps only keys the material already has (onBeforeRender and onBeforeCompile) and
// drops the rest with a warning; the scene must refuse whatever a material really ends up carrying.
const SETVALUES_KEEPS = ["onBeforeRender", "onBeforeCompile"];
const viaOptions = (options: object): MeshBasicMaterial => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return new MeshBasicMaterial(options);
  } finally {
    console.warn = warn;
  }
};

for (const name of CALLBACKS) {
  const key = ["on", ...name.split(/(?=[A-Z])/).slice(1)].join(""); // the same name, built at run time
  test(`${name} in an options object, written plainly or with a key computed at run time: refused, or never kept by three`, () => {
    for (const options of [{ [name]: noop }, Object.fromEntries([[key, noop]])]) {
      const material = viaOptions(options);
      if (SETVALUES_KEEPS.includes(name)) assert.throws(() => assertNoRenderCallbacks(sceneWith(material)), /render callback/);
      else assert.doesNotThrow(() => assertNoRenderCallbacks(sceneWith(material)));
    }
  });
  test(`${name} assigned to a material (alone or in a material array) or to an object is refused`, () => {
    const material = new MeshBasicMaterial();
    Object.assign(material, { [name]: noop });
    assert.throws(() => assertNoRenderCallbacks(sceneWith(material)), /render callback/);
    assert.throws(() => assertNoRenderCallbacks(sceneWith([new MeshBasicMaterial(), material])), /render callback/);
    const holder = new Object3D();
    Object.assign(holder, { [name]: noop });
    assert.throws(() => assertNoRenderCallbacks(new Scene().add(holder)), /render callback/);
  });
}
