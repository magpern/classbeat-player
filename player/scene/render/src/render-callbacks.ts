// A three.js options object can carry a callback that three later calls with the live renderer
// (`new MeshBasicMaterial({ onBeforeCompile })`, or the same built with `Object.fromEntries` and a key
// computed at run time): `setValues` assigns it. Lint cannot see a key built at run time, so this
// closes the route after the scene is built: three declares its render callbacks on the prototype
// (default no-ops), so a callback that a caller supplied is an OWN property of the object or the
// material. The build refuses any object or material that carries one. It runs once when the rig is
// built, never per frame. (The names are in the pattern, as text, not as member accesses, which src/
// bans.)

const RENDER_CALLBACK = /^(onBeforeRender|onAfterRender|onBeforeCompile|onBeforeShadow|onAfterShadow)$/;

/** The objects the check walks: a three.js object with children, and, for a mesh, its material(s). */
interface Walkable {
  traverse(visit: (object: object) => void): void;
}

function ownCallback(subject: object): string | undefined {
  return Object.keys(subject).find((key) => RENDER_CALLBACK.test(key));
}

/** Throws if `root`, any object below it or any material of those carries its own render callback. */
export function assertNoRenderCallbacks(root: Walkable): void {
  root.traverse((object) => {
    const name = ownCallback(object);
    if (name !== undefined) throw new Error(`a scene object carries the render callback ${name}`);
    const { material } = object as { material?: object | readonly object[] };
    if (material === undefined) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      const found = ownCallback(m as object);
      if (found !== undefined) throw new Error(`a scene material carries the render callback ${found}`);
    }
  });
}
