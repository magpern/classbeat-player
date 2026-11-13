// The sign-in link's token in the address fragment (ADR 0002, section 4, steps 4 and 5). Pure.

/** A link token exactly as the backend makes it: `cbp_ml_` and 43 base64url characters. */
const LINK_TOKEN = /^cbp_ml_[A-Za-z0-9_-]{43}$/;

export type Fragment =
  | { readonly kind: "none" }
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "broken" };

/**
 * What the fragment holds. A fragment that starts like a link token but is not one (a link cut
 * short by a mail program) is "broken": the page says the link cannot be used. Any other
 * fragment is not a link and is ignored.
 */
export function fragmentOf(hash: string): Fragment {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (LINK_TOKEN.test(raw)) return { kind: "token", token: raw };
  return raw.startsWith("cbp_ml") ? { kind: "broken" } : { kind: "none" };
}
