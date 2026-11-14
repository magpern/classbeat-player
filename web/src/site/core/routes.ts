// The site's addresses (docs/design/site.md, "Pages and their addresses"). Pure: no I/O.
// Which page an address shows, and which addresses a sign-in may return to: a signed-in page of
// the site, or one entry of the fixed table of other pages served beside it (the companion).

export type Nav = "classes" | "devices" | "account";

/** A page that needs a session. `load` is the route it reads first (under /api/site/). */
export interface SignedInPage {
  readonly kind: "signed-in";
  readonly title: string;
  readonly nav: Nav;
  readonly load: string;
}

export type Page =
  | { readonly kind: "sign-in" }
  | { readonly kind: "redirect"; readonly to: string }
  | SignedInPage
  | { readonly kind: "not-found" };

const CLASS_ID = /^\/classes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ACCOUNT: Readonly<Record<string, readonly [string, string]>> = {
  sessions: ["Account", "sessions"],
  passkeys: ["Account", "passkeys"],
  links: ["Account", "source-links"],
  data: ["Account", "sessions"],
};

const signedIn = (title: string, nav: Nav, load: string): SignedInPage => ({ kind: "signed-in", title, nav, load });

/** The page for a path. Only the exact addresses of the table are pages; anything else is "not found". */
export function pageOf(path: string): Page {
  if (path === "/sign-in") return { kind: "sign-in" };
  if (path === "/") return { kind: "redirect", to: "/classes" };
  if (path === "/account") return { kind: "redirect", to: "/account/sessions" };
  if (path === "/classes") return signedIn("Classes", "classes", "classes");
  const cls = CLASS_ID.exec(path);
  if (cls) return signedIn("Class details", "classes", `classes/${cls[1]}`);
  if (path === "/devices") return signedIn("Devices", "devices", "devices");
  if (path === "/pair") return signedIn("Pair a device", "devices", "sessions");
  if (path === "/link/source") return signedIn("Connect an app", "account", "sessions");
  const acct = /^\/account\/([a-z]+)$/.exec(path);
  if (acct && Object.hasOwn(ACCOUNT, acct[1])) {
    const [title, load] = ACCOUNT[acct[1]];
    return signedIn(title, "account", load);
  }
  return { kind: "not-found" };
}

// The two pages whose query is kept on the way back (the app and the source open them with one).
const KEEPS_QUERY = new Set(["/pair", "/link/source"]);

/**
 * Where a sign-in may return to, from the address of the page that asked: a signed-in page of
 * this site, as a path, or null. Never an address from anywhere else (no open redirect): the
 * result always starts with a single "/" and names a page of the table above.
 */
export function returnPathOf(path: string, search: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  const page = pageOf(path);
  if (page.kind !== "signed-in") return null;
  if (!KEEPS_QUERY.has(path) || search === "" || search === "?") return path;
  return search.startsWith("?") && !/[\\#\s]/.test(search) ? `${path}${search}` : path;
}

/**
 * The other pages served beside the site that a sign-in may return to, by name (issue #263).
 * Only these: a sign-in address names an entry of this table, never an address.
 */
export type ReturnEntry = "control";
// `satisfies` makes a missing or an extra entry a type error.
export const RETURN_ENTRIES = { control: "/control" } as const satisfies Record<ReturnEntry, string>;

/** The web player page (ADR 0008, section 3): served beside the site, so only a full page load goes there. */
export const PLAY_PATH = "/play";
/** A class id as the site's list gives it: a canonical lower-case uuid (ADR 0008, section 2). Never folded or trimmed. */
const CLASS_ID_ENTRY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A class (join) code exactly as the companion shows it (ADR 0002's alphabet, `XXXX-XXXX`). */
const JOIN_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
const RETURN_FRAGMENT = /^#?return=([a-z]+)(?:\.(.*))?$/;

/**
 * The sign-in address that returns to `entry` afterwards. The entry goes in the fragment, which
 * the browser never sends to a server; for the companion it may carry the class code, which only
 * names the session and gives no control (rule 14). Nothing else goes with it: never a control
 * code, a token or an address. A class code that is not one exactly is left out.
 */
export function signInAddressFor(entry: ReturnEntry, join: string | null): string {
  return join !== null && JOIN_CODE.test(join) ? `/sign-in#return=${entry}.${join}` : `/sign-in#return=${entry}`;
}

/** The class id of a class details page's load route (`classes/<id>`), or null for any other route or id. */
export function classIdOfPage(load: string): string | null {
  const id = load.startsWith("classes/") ? load.slice("classes/".length) : "";
  return CLASS_ID_ENTRY.test(id) ? id : null;
}

/** The sign-in address that returns to the web player page, to one class when `classId` is a canonical id; any other value is left out. */
export function playSignInAddress(classId: string | null): string {
  return classId !== null && CLASS_ID_ENTRY.test(classId) ? `/sign-in#return=play.${classId}` : "/sign-in#return=play";
}

/**
 * The address a sign-in fragment asks to return to, or null. Only an entry of the table, with a
 * class code for the companion and nothing else, or `play` with a class id (ADR 0008, section 3);
 * anything other than exactly that is null, and the sign-in then goes to the default page. The
 * result is `/control`, `/control#XXXX-XXXX`, `/play` or `/play#<class id>`.
 */
export function returnEntryOf(hash: string): string | null {
  const m = RETURN_FRAGMENT.exec(hash);
  if (!m) return null;
  if (m[1] === "play") return m[2] === undefined ? PLAY_PATH : CLASS_ID_ENTRY.test(m[2]) ? `${PLAY_PATH}#${m[2]}` : null;
  if (!Object.hasOwn(RETURN_ENTRIES, m[1])) return null;
  const path = RETURN_ENTRIES[m[1] as ReturnEntry];
  if (m[2] === undefined) return path;
  return JOIN_CODE.test(m[2]) ? `${path}#${m[2]}` : null;
}

/** A way back named by a sign-in fragment: the address to load, and the entry as the site sends it. */
export interface EntryBack {
  readonly path: string;
  /** `control`, `control.XXXX-XXXX`, `play` or `play.<class id>` (ADR 0006, decision 5): never a path. */
  readonly field: string;
}

/**
 * The way back a fragment `return=<entry>` names, or null. Only what `returnEntryOf` accepts, so
 * the entry is then exactly a name of the table, with a class code for the companion.
 */
export function entryBackOf(hash: string): EntryBack | null {
  const path = returnEntryOf(hash);
  return path === null ? null : { path, field: hash.replace(/^#?return=/, "") };
}
