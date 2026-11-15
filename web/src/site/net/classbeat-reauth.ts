// Starting a re-authentication at classbeat (ADR 0010, sections 2 and 5): one script request, with
// the purpose only and no return entry (section 6), whose answer is classbeat's authorize address.
// The page then goes there by a top-level navigation; nothing about the flow is kept or logged
// (the binding cookie is the backend's, and the page never reads it).
import { afterReauthStart, REAUTH_BODY } from "../core/classbeat-start-model.ts";
import type { StartNext } from "../core/classbeat-start-model.ts";
import { call } from "./api.ts";

/** Starts the flow; on `go`, the caller navigates to `to`. */
export async function startReauth(): Promise<StartNext> {
  return afterReauthStart(await call("POST", "sign-in/classbeat/start", REAUTH_BODY));
}
