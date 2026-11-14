// Which class the address names (docs/adr/0008-the-player-as-a-web-app.md, section 2). Pure.
//
// The class id is carried in the fragment, `/play#<class id>`, so no server sees it in a request
// line. The id names a class and grants nothing: the API still checks the account. An id that is
// not a UUID in its canonical lowercase form, as `GET /api/site/classes` gives it, is ignored, and
// the page shows the class picker.

const CLASS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The class id of an address fragment (`#<id>`), or null: anything else, in any other form, is no class. */
export function classIdOf(hash: string): string | null {
  return hash.startsWith("#") && CLASS_ID.test(hash.slice(1)) ? hash.slice(1) : null;
}

/** The address a class opens at. */
export const classAddress = (id: string): string => `/play#${id}`;

/** The picker's address: no fragment. */
export const PICKER_ADDRESS = "/play";

/** Where the person signs in; the way back to /play comes with the site's return entries (issue #396). */
export const SIGN_IN_ADDRESS = "/sign-in";
