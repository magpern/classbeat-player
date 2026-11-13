// Starts the built application under Playwright's Electron support. Needs a display (xvfb-run on
// headless Linux). The headless-only Chromium flags are passed HERE, never set by the app itself.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron } from "playwright-core";
import type { ElectronApplication, Page } from "playwright-core";

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface LaunchOptions {
  /** Extra switches for the app, before the app's folder. */
  readonly args?: readonly string[];
  /** Extra environment for the app. */
  readonly env?: Readonly<Record<string, string>>;
  /** The user-data folder; a new temporary one when not given. */
  readonly userData?: string;
  /**
   * The page the window shows when the test starts. The app starts on the class list; the older
   * tests are about the presenter, so by default the window is taken to the presenter page the way
   * the shell does it (loadFile in the main process). "list" leaves it where the app put it.
   */
  readonly page?: "presenter" | "list";
}

export async function launch(opts: LaunchOptions = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), "player-e2e-"));
  const app = await _electron.launch({
    executablePath: electronPath as unknown as string,
    // CI runs as a user without the Chromium sandbox helper; software GL under xvfb.
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", `--user-data-dir=${userData}`, ...(opts.args ?? []), APP_DIR],
    cwd: APP_DIR,
    ...(opts.env ? { env: { ...process.env, ...opts.env } as Record<string, string> } : {}),
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  if ((opts.page ?? "presenter") === "presenter") {
    await app.evaluate(async ({ app: electron, BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0]!.loadFile(`${electron.getAppPath()}/dist/presenter.html`);
    });
    await page.waitForFunction(() => location.pathname.endsWith("/presenter.html"));
    await page.waitForLoadState("domcontentloaded");
  }
  return { app, page };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
