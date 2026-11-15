// Starting a sign-in or a re-authentication at classbeat (ADR 0010, sections 2 and 5): one script
// request, with the purpose only and no return entry (section 6), whose answer is classbeat's
// authorize address. The page then goes there by a top-level navigation; nothing about the flow is
// kept or logged (the binding cookie is the backend's, and the page never reads it).
import { afterReauthStart, afterSignInStart, REAUTH_BODY, SIGN_IN_BODY } from "../core/classbeat-start-model.ts";
import type { StartNext } from "../core/classbeat-start-model.ts";
import { call } from "./api.ts";

/** Starts a re-authentication of the signed-in account; on `go`, the caller navigates to `to`. */
export async function startReauth(): Promise<StartNext> {
  return afterReauthStart(await call("POST", "sign-in/classbeat/start", REAUTH_BODY));
}

/** Starts a sign-in from the sign-in page; on `go`, the caller navigates to `to`. */
export async function startSignIn(): Promise<StartNext> {
  return afterSignInStart(await call("POST", "sign-in/classbeat/start", SIGN_IN_BODY));
}
