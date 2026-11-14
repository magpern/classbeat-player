// The linked app's own site in the website checks (ADR 0002, section 7): the one other origin a
// page may go to, and only by a top-level navigation after an approval. The fake (site-fake.ts)
// cancels that navigation, as the browser does for a 204 or a blocked one, so the page stays (the
// "blocked" case "Back to <name>" is for), and records it in `left`. Any other request to it is
// aborted and recorded in `external`, as for every other origin. Its own module so the state
// tables can name it without importing the fake.
export const SOURCE_ORIGIN = "https://source.test";
