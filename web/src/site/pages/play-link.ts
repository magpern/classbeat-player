// The "Play on this device" link of a class's details page (ADR 0008, section 3): `/play#<class id>`.
// The class id is in the fragment, so no server sees it in a request line. Only a canonical id gets a link.
import { PLAY_PATH, classIdOfPage } from "../core/routes.ts";
import { buttons } from "../ui/kit.ts";
import { linkButton } from "./errors.ts";

export const PLAY_LINK_TEXT = "Play on this device";

/** The link for the page that loaded `load` (`classes/<id>`), or null when that is not one class. */
export function playLink(load: string): HTMLElement | null {
  const id = classIdOfPage(load);
  return id === null ? null : buttons(linkButton(PLAY_LINK_TEXT, `${PLAY_PATH}#${id}`));
}
