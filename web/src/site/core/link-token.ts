// The sign-in link's token in the address fragment (ADR 0002, section 4, steps 4 and 5, amended
// by ADR 0006, decision 4): the token, alone or followed by the entry to return to. Pure.
import { entryBackOf } from "./routes.ts";
import type { EntryBack } from "./routes.ts";

/** A link token exactly as the backend makes it: `cbp_ml_` and 43 base64url characters. */
const LINK_TOKEN = /^cbp_ml_[A-Za-z0-9_-]{43}$/;
const TOKEN_LENGTH = 50;
const RETURN_PART = "&return=";

export type Fragment =
  | { readonly kind: "none" }
  | { readonly kind: "token"; readonly token: string; readonly back?: EntryBack }
  | { readonly kind: "broken" };

/**
 * What the fragment holds. A fragment that starts like a link token must begin with one (its
 * first 50 characters), followed by nothing or by `&return=` and an entry; anything else (a link
 * cut short by a mail program, or other text after the token) is "broken": the page says the
 * link cannot be used. An entry that `returnEntryOf` does not accept is ignored, and the token
 * still signs in. Base64url has no `&`, so the token and the entry cannot run into each other.
 * Any other fragment is not a link and is ignored here.
 */
export function fragmentOf(hash: string): Fragment {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("cbp_ml")) return { kind: "none" };
  const token = raw.slice(0, TOKEN_LENGTH);
  const rest = raw.slice(TOKEN_LENGTH);
  if (!LINK_TOKEN.test(token)) return { kind: "broken" };
  if (rest === "") return { kind: "token", token };
  if (!rest.startsWith(RETURN_PART)) return { kind: "broken" };
  const back = entryBackOf(`return=${rest.slice(RETURN_PART.length)}`);
  return back === null ? { kind: "token", token } : { kind: "token", token, back };
}
