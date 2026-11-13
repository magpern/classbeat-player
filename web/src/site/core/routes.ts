// The site's addresses (docs/design/site.md, "Pages and their addresses"). Pure: no I/O.
// Which page an address shows, and which addresses a sign-in may return to.

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
