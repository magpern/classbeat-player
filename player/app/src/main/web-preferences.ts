// The hardening settings of every window, kept free of Electron imports so a unit test can check
// them. The e2e test reads the same values back from the running windows.

/** The presenter page's Content Security Policy; presenter.html carries it as its first meta tag. */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The class list page's policy: the presenter's, and the page's own style sheet and fonts. */
export const LIST_CSP = CSP.replace("style-src 'none'", "style-src 'self'").replace("font-src 'none'", "font-src 'self'");

/**
 * The room screen's policy (room.html): the class list's. The room screen's style sheet and fonts
 * are the application's own files; it sets no inline style (only through the CSSOM) and runs no
 * inline script.
 */
export const ROOM_CSP = LIST_CSP;

export interface SecureWebPreferences {
  readonly preload: string;
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly nodeIntegration: false;
  readonly nodeIntegrationInWorker: false;
  readonly nodeIntegrationInSubFrames: false;
  readonly webSecurity: true;
  readonly allowRunningInsecureContent: false;
  readonly webviewTag: false;
  readonly experimentalFeatures: false;
  readonly enableBlinkFeatures: "";
  readonly navigateOnDragDrop: false;
  readonly spellcheck: false;
  readonly safeDialogs: true;
}

export function secureWebPreferences(preload: string): SecureWebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    enableBlinkFeatures: "",
    navigateOnDragDrop: false,
    spellcheck: false,
    safeDialogs: true,
  };
}

/** Keys a window may add after `...secureWebPreferences(...)` (test/unit/window-prefs-check.ts). */
export const EXTRA_KEYS: ReadonlySet<string> = new Set(["backgroundThrottling"]);

/**
 * The hardening keys Electron reports back for a live renderer (`getLastWebPreferences`): every key
 * of `secureWebPreferences` except `preload`, `navigateOnDragDrop` and `spellcheck`, which it does
 * not report. The static check covers all three; `looseExtras` checks the preload and the spell
 * checker at run time, and hardening.ts refuses every navigation, a drop's too.
 */
export const REPORTED_KEYS = [
  "contextIsolation",
  "sandbox",
  "nodeIntegration",
  "nodeIntegrationInWorker",
  "nodeIntegrationInSubFrames",
  "webSecurity",
  "allowRunningInsecureContent",
  "webviewTag",
  "experimentalFeatures",
  "enableBlinkFeatures",
  "safeDialogs",
] as const satisfies readonly (keyof SecureWebPreferences)[];

/**
 * What is loose about a new renderer (hardening.ts refuses it when this is not empty): each
 * reported hardening key whose value differs from `secureWebPreferences`, and "session" when it is
 * not on the hardened default session. Names only, never values.
 */
export function looseKeys(reported: Readonly<Record<string, unknown>> | null, onDefaultSession: boolean): string[] {
  const want = secureWebPreferences("") as unknown as Record<string, unknown>;
  const out: string[] = reported === null ? ["webPreferences"] : REPORTED_KEYS.filter((k) => reported[k] !== want[k]);
  if (!onDefaultSession) out.push("session");
  return out;
}

/** What the runtime guard sees of a renderer beyond its reported preferences (N2 of #151's review). */
export interface RendererExtras {
  /** The renderer's own preload as Electron holds it (`_getPreloadScript()`), or undefined when it cannot say. */
  readonly preload: unknown;
  /** How many preload scripts the renderer's session adds to every page. */
  readonly sessionPreloads: number;
  /** Whether the renderer's session has the spell checker on. */
  readonly spellChecker: boolean;
}

/**
 * The keys Electron does not report, checked another way: the preload is exactly one of `allowed`
 * (a frame preload, compared as written), the session adds no preload of its own and its spell
 * checker is off (hardening.ts turns it off). Anything it cannot read counts as loose.
 */
export function looseExtras(seen: RendererExtras, allowed: readonly string[]): string[] {
  const out: string[] = [];
  const p = seen.preload as { filePath?: unknown; type?: unknown } | null | undefined;
  const path = typeof p === "object" && p !== null && p.type === "frame" ? p.filePath : undefined;
  if (typeof path !== "string" || !allowed.includes(path)) out.push("preload");
  if (seen.sessionPreloads !== 0) out.push("sessionPreloads");
  if (seen.spellChecker !== false) out.push("spellcheck");
  return out;
}

/** Only the application's own files may load. Everything else (http, https, ws, data, ...) is cancelled. */
export function isAllowedRequest(url: string, appDirUrl: string): boolean {
  return url.startsWith(appDirUrl);
}
