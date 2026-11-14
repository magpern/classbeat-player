# 0006. The sign-in link carries its return entry

Status: Proposed

## Context

The companion sends a signed-out instructor to `/sign-in#return=control[.XXXX-XXXX]`. The site
keeps that return entry in memory only (#263, #274). A passkey sign-in in the same tab then
returns to `/control`. A sign-in by **email link** does not: the link opens in a new tab,
which has no return entry, so it lands on `/classes`. This was noted in the review of #274 and
is carried in `docs/status.md`.

The first fix (issue #329, first version) saved the return entry in `localStorage`. It cannot
be built: the site's guards forbid every `Storage` call on the sign-in pages and after any
sign-in ("the way back is kept in memory only": `site-page-security.test.ts`,
`site-sign-in-flows.test.ts`). A pull request never weakens a guard, so the decision moves the
entry somewhere the guards already allow: the mailed link's fragment, which the page reads into
memory as it reads the token.

ADR 0002, section 4 (email link, steps 4 and 5) and section 1 (principle 3: no token or code in a
URL path or query string) apply. Rule 14 applies: a class code only names a session and gives
no control.

## Decision

This ADR **amends ADR 0002, section 4 (email link), steps 1, 2, 4 and 5**. Inline "amended
by ADR 0006" notes mark each place there. Every other part of ADR 0002 stands.

1. **The request (amends steps 1 and 2).** `POST /api/site/sign-in/link` takes an optional
   `return_to` beside `email`.
   - It is accepted only if it matches `^control(\.[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4})?$`
     exactly. The alphabet is `code_policy.ALPHABET`, and the code is upper case with its
     hyphen. The lenient `normalise_code` is not used, so no case folding, no missing hyphen
     and no spaces are allowed.
   - A missing field and JSON `null` both mean no return entry.
   - Any other value answers `422` with `invalid_return`. That includes an empty string and a
     value that is not a string (the framework's own `422`).
   - **Order:** the per-address limit comes first, which is the first call in step 2 and
     answers `429`. Then `email` is checked as today (`422 invalid_email`), then `return_to`
     (`422 invalid_return`).
   - Neither `422` makes the second call (`auth_request_login`). Both depend only on the
     input, never on the email or the account.
   - So the answers of step 1 still tell nothing about the address. The new `422` is one more
     input error, like `invalid_email`.
2. **Nothing is stored for it.** The value is not written to `login_links`, the audit events, the
   rate-limit counters or the logs. Log redaction already masks class codes. A test asserts that
   no log line for the request holds the class code that was sent.
3. **The mail (amends step 4).** Without `return_to`, the link is unchanged:
   `https://<site>/sign-in#<token>`. With a valid `return_to`, it is
   `https://<site>/sign-in#<token>&return=<return_to>`. The text of the mail is unchanged.
4. **The page (amends step 5).** Let `raw` be the fragment without its `#`. The site reads it by
   this rule, in this order:
   1. If `raw` starts with `cbp_ml` (as `fragmentOf` checks today), its first 50 characters must be a link token: `cbp_ml_`
      followed by 43 base64url characters, as `LINK_TOKEN` checks today.
      - If they are not, the fragment is **broken**, as a cut-short link is today.
      - If the token is the whole of `raw`, it is a token with no return entry, as today.
      - If the token is followed by the literal `&return=`, the rest goes to the existing
        `returnEntryOf`. A result that is not null is held in memory as the way back. A null
        result is ignored: the token still signs in, and the page goes to the default page.
      - Anything else after the 50 characters makes the fragment broken.
      - Base64url has no `&`, so the token and the return part cannot run into each other.
   2. Otherwise the fragment is read as today. `#return=control[.CODE]` with no token is the
      existing companion entry (#263) and is unchanged. Any other fragment is ignored.

   The whole fragment leaves the address bar at once (`history.replaceState`), as today.
   The return entry is kept in memory only. If the link is then refused (expired, used,
   unknown or another browser), the entry stays in memory for that tab. A sign-in in that tab
   by a new link or a passkey still returns there, which is safe by rule 14.
5. **The site's request.** When the rider asks for an email link, the site sends `return_to`
   **only** if the tab holds a return entry that came from a sign-in fragment through
   `returnEntryOf`. It sends it as the entry name and code, `control` or
   `control.XXXX-XXXX`, never as a path. Any other way back held in memory is never sent:
   `/pair?code=…`, `/classes` or any other site path from `returnPathOf` stays a local
   navigation. A test asserts that asking for a link from `/pair` sends no `return_to`, and
   no pairing code in any form.
6. **What stays the same.** The browser binding, the 15 minutes, single use, the answers of
   step 6, the limits of section 10, and the guards that keep the site from using storage.

Lanes: the backend lane builds steps 1–3, and the screens lane builds steps 4–5 against its
fake site. `schema/site-api/v1` describes only `/me` today, and the sign-in requests have never
been in it. This ADR keeps that precedent, so no contract change is needed. When the sign-in
requests are described in `schema/`, `return_to` goes with them. The backend and screens pull
requests may merge in either order: until both have merged, the field is simply never sent, or
never put in a link.

## Alternatives

- **`localStorage`, with expiry and a re-check on reading** (#329, first version). Rejected:
  it needs the site's no-storage guards narrowed, and the way back would outlive the tab in
  the browser's storage.
- **Asking the original tab over `BroadcastChannel`.** Rejected: it fails once that tab is
  closed, and the site's trap would need a new sink for it.
- **The return entry stored with the `login_links` row.** Rejected: it puts a class code into
  the database for 15 minutes with no gain over the fragment, and the completion answer would
  have to carry it back.
- **Accepting the gap.** Rejected: an instructor who signs in by mail on the handlebar loses
  the companion, which is the case the return entry exists for.

## Consequences

- An email sign-in from the companion returns to `/control`, with the class code when one was
  given.
- The class code now reaches the backend, in the body of the link request. Until now the
  companion entry kept it out of every request (#263). By rule 14 it gives no control. It is
  checked, put into the mail link and not kept (decision 2).
- A class code can now appear in a sign-in mail, sent to the address the requester typed. By
  rule 14 it gives no control. Someone who types another person's email and a code sends them
  a link that works only in the requester's browser (ADR 0002 section 4, step 6), so nothing is
  gained.
- The request body gains one optional field, and `fragmentOf` gains one form. The old form keeps
  working, so links already sent stay valid.

Status becomes Accepted when a Reviewer passes this ADR's pull request.
