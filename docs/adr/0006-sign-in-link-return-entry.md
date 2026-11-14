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

1. **The request.** `POST /api/site/sign-in/link` takes an optional `return_to` beside `email`.
   It is accepted only if it is exactly `control` or `control.` followed by a class code in
   the code alphabet (`code_policy.ALPHABET`, `XXXX-XXXX`), at most 20 characters. Any other
   value, including an empty string, answers `422` with `invalid_return`. That check comes
   after the per-address limit and before the email is looked at, and it does not depend on
   the email or the account. So the answers of ADR 0002 section 4, step 1 still tell nothing
   about the address. A missing or `null` `return_to` behaves exactly as today.
2. **Nothing is stored for it.** The value is not written to `login_links`, the audit events, the
   rate-limit counters or the logs. Log redaction already masks class codes, and a test
   asserts that no log line for the request holds the value.
3. **The mail.** With a valid `return_to`, the link is
   `https://<site>/sign-in#<token>&return=<return_to>`. Without one it is unchanged:
   `https://<site>/sign-in#<token>`. The text of the mail is unchanged. The token and the
   entry are both in the fragment, which the browser never sends to a server.
4. **The page.** The site reads a fragment of exactly `<token>` or
   `<token>&return=<entry>[.<code>]`.
   - The token part is checked as today.
   - The return part is checked with the existing `returnEntryOf`. Only an entry of
     `RETURN_ENTRIES` is used, and a class code only if it matches exactly.
   - A return part that fails is ignored. The token still signs in, and the page goes to the
     default page.
   - A fragment with anything else after the token is "broken", as a cut-short token is today.
   - The whole fragment leaves the address bar at once (`history.replaceState`), as today.
   - The return entry is kept in memory only.
5. **The site's request.** When the rider asks for an email link and a return entry is held in
   memory, the site sends it as `return_to`. Otherwise it sends none.
6. **What stays the same.** The browser binding, the 15 minutes, single use, the answers, the
   limits and the guards that keep the site from using storage.

Lanes: the backend lane builds steps 1–3, and the screens lane builds steps 4–5 against its
fake site. The request body is not in `schema/` today, so no contract change is needed. If the
site API description is added to `schema/` later, `return_to` goes with it.

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
- A class code can now appear in a sign-in mail, sent to the address the requester typed. By
  rule 14 it gives no control. Someone who types another person's email and a code sends them
  a link that works only in the requester's browser (ADR 0002 section 4, step 6), so nothing is
  gained.
- The request body gains one optional field, and `fragmentOf` gains one form. The old form keeps
  working, so links already sent stay valid.

Status becomes Accepted when a Reviewer passes this ADR's pull request.
