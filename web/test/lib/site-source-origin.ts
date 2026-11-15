// The linked app's own site in the website checks (ADR 0002, section 7): one of the two other
// origins a page may go to (classbeat, below, is the other), and only by a top-level navigation
// after an approval. The fake (site-fake.ts)
// cancels that navigation, as the browser does for a 204 or a blocked one, so the page stays (the
// "blocked" case "Back to <name>" is for), and records it in `left`. Any other request to it is
// aborted and recorded in `external`, as for every other origin. Its own module so the state
// tables can name it without importing the fake.
export const SOURCE_ORIGIN = "https://source.test";

// classbeat itself (ADR 0010, sections 2 and 5): "Confirm with classbeat" goes there by a top-level
// navigation to the authorize address the start answered. The fake cancels that navigation too,
// records it in `toClassbeat`, and the page stays; any other request to it is aborted and recorded
// in `external`, as for every other origin.
export const CLASSBEAT_ORIGIN = "https://classbeat.test";
