// The hardening settings of every window, kept free of Electron imports so a unit test can check
// them. The e2e test reads the same values back from the running windows.
import { MIX_SCHEME, playIdOf } from "../core/mix/scheme-policy.ts";
import { LOCAL_SCHEME, localPlayIdOf } from "../core/music-files/local-scheme-policy.ts";

/**
 * The presenter page's Content Security Policy; presenter.html carries it as its first meta tag.
 * Style comes only from the application's own style sheet (presenter.css, bundled into dist/; the
 * request filter below confines 'self' to the application's folder): no inline style, no style
 * attribute, no other origin (#682). Fonts stay off: the page names only the system's faces.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
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

/** The class list page's policy: the presenter's, and the application's own fonts. */
export const LIST_CSP = CSP.replace("font-src 'none'", "font-src 'self'");

/**
 * The room screen's policy (room.html): the class list's, and media from `cbp-mix:` and `cbp-local:`
 * only, for the <audio> that plays a cached mix (ADR 0013 section 5) and the two that play the
 * instructor's own files (ADR 0017 section 3; both schemes are registered without the privilege
 * that bypasses a CSP, so this is the only page that can load them). The room screen's style sheet and fonts
 * are the application's own files; it sets no inline style (only through the CSSOM) and runs no
 * inline script.
 */
export const ROOM_CSP = LIST_CSP.replace("media-src 'none'", `media-src ${MIX_SCHEME}: ${LOCAL_SCHEME}:`);

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

/** Whether `id` is a live play of the renderer `webContentsId` (main/mix/plays.ts, main/local/local-plays.ts). */
export type LivePlay = (id: string, webContentsId: number) => boolean;

const liveFor = (id: string | null, webContentsId: number | undefined, live: LivePlay | undefined): boolean => id !== null && live !== undefined && typeof webContentsId === "number" && live(id, webContentsId) === true;

/**
 * Exactly three kinds of request load; everything else (http, https, ws, data, other files, ...) is
 * cancelled. The application's own files, from anywhere. A `cbp-mix:` play URL, only from the
 * renderer the play is bound to (the room window) and only while that play is live. A `cbp-local:`
 * play URL the same way, checked against the local plays only: an id of one scheme is never a
 * play of the other.
 */
export function isAllowedRequest(url: string, appDirUrl: string, webContentsId?: number, livePlay?: LivePlay, liveLocal?: LivePlay): boolean {
  if (url.startsWith(appDirUrl)) return true;
  return liveFor(playIdOf(url), webContentsId, livePlay) || liveFor(localPlayIdOf(url), webContentsId, liveLocal);
}
