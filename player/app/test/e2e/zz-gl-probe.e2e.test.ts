// TEMPORARY probe: which Chromium GL switches give WebGL2 on a runner without a GPU.
import { test } from "node:test";
import { closeApp, launch } from "./launch.ts";

const SETS: string[][] = [
  [],
  ["--enable-unsafe-swiftshader"],
  ["--use-angle=metal"],
  ["--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
  ["--in-process-gpu", "--enable-unsafe-swiftshader"],
  ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-angle=gl"],
  ["--disable-gpu-sandbox", "--enable-unsafe-swiftshader"],
];
for (const set of SETS) {
  test(`probe ${set.join(" ") || "(none)"}`, { timeout: 90_000 }, async () => {
    const { app, page } = await launch({ page: "list", args: ["--test-memory-keychain", ...set] });
    try {
      const r = await page.evaluate(() => {
        const c = document.createElement("canvas");
        return { webgl2: c.getContext("webgl2") !== null, webgl1: document.createElement("canvas").getContext("webgl") !== null };
      });
      const gpu = await app.evaluate(({ app: a }) => (a.getGPUFeatureStatus() as Record<string, string>).webgl);
      console.log(`PROBE ${JSON.stringify(set)} -> ${JSON.stringify(r)} webgl=${gpu}`);
    } finally {
      await closeApp(app);
    }
  });
}
