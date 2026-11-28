// Starts the built application under Playwright's Electron support. Needs a display (xvfb-run on
// headless Linux). The headless-only Chromium flags are passed HERE, never set by the app itself.
import { mkdtempSync, writeFileSync } from "node:fs";
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

/** Rejects with a clear message when `work` does not settle in time (a start that hangs must fail, never wait). */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`e2e: ${what} did not happen within ${ms} ms`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Waits until the page's document has been parsed, by asking the page, not by Playwright's load-state bookkeeping. `waitForLoadState`
 * answers from the lifecycle events Playwright saw for the frame; the shell navigates the window itself (loadFile in the main process),
 * and on Windows CI that left it waiting the whole 30 s for an event it had already missed although the page was loaded (seen in
 * `web preferences of the live window`, which then failed every test after it). The document's own state cannot be missed. The poll is
 * on a timer, not on animation frames, which a window that is not shown does not run.
 */
export function documentParsed(page: Page, ms = 30_000): Promise<unknown> {
  return page.waitForFunction(() => document.readyState !== "loading", undefined, { polling: 100, timeout: ms });
}

/**
 * Closes the app and makes sure its process is gone: a polite close first, the kill after a limit.
 * A process left behind keeps the test runner alive, which is what turned one failed start into a
 * hang that only a manual cancel ended.
 */
export async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const child = app.process();
  try {
    await within(app.close(), 15_000, "the app closing");
  } catch {
    // Fall through to the kill.
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

/**
 * The update checker never reaches the network in a test (ADR 0014 section 6): automatic checks off,
 * and a feed override that no fetch accepts, so even Check now ends in "could not check" with no
 * request. A test that wrote its own settings file keeps it.
 */
function noUpdateChecks(userData: string): void {
  try {
    writeFileSync(join(userData, "update-settings.json"), `${JSON.stringify({ automaticChecks: false, prereleases: false, feed: "" })}\n`, { flag: "wx" });
  } catch {
    // Already there.
  }
}

export async function launch(opts: LaunchOptions = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), "player-e2e-"));
  noUpdateChecks(userData);
  let app: ElectronApplication | undefined;
  try {
    app = await within(
      _electron.launch({
        executablePath: electronPath as unknown as string,
        // CI runs as a user without the Chromium sandbox helper; software GL under xvfb.
        args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", `--user-data-dir=${userData}`, ...(opts.args ?? []), APP_DIR],
        cwd: APP_DIR,
        ...(opts.env ? { env: { ...process.env, ...opts.env } as Record<string, string> } : {}),
      }),
      60_000,
      "the app starting",
    );
    // A live window: it exists and its page has loaded before any test looks at it.
    const page = await within(app.firstWindow(), 60_000, "the first window opening");
    await within(documentParsed(page), 35_000, "the first window loading");
    if (page.isClosed()) throw new Error("e2e: the first window closed before the test started");
    // The app's own first load (the class list, started by the shell with loadFile) must be over:
    // Playwright's firstWindow and "domcontentloaded" can be answered by the window's blank first
    // page, and a loadFile started now would abort the shell's, which Electron reports as the
    // rejection (-3, ERR_ABORTED) of the NEW load. Seen on Windows CI (#571).
    await within(
      app.evaluate(async ({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0]!.webContents;
        while (wc.isLoading() || !wc.getURL().endsWith("/dist/classlist.html")) {
          await new Promise<void>((resolve) => {
            wc.once("did-stop-loading", () => resolve());
            setTimeout(() => resolve(), 200);
          });
        }
      }),
      30_000,
      "the class list's first load finishing",
    );
    if ((opts.page ?? "presenter") === "presenter") {
      await within(
        app.evaluate(async ({ app: electron, BrowserWindow }) => {
          await BrowserWindow.getAllWindows()[0]!.loadFile(`${electron.getAppPath()}/dist/presenter.html`);
        }),
        30_000,
        "the presenter page loading",
      );
      await within(page.waitForFunction(() => location.pathname.endsWith("/presenter.html")), 30_000, "the presenter page showing");
      await documentParsed(page);
    }
    return { app, page };
  } catch (error) {
    // Never leave a half-started app behind: it would keep the process alive after the failure.
    await closeApp(app);
    throw new Error(`e2e: the app did not start with a live window: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
