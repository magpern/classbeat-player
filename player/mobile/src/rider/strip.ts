// Step 1's mode strip (docs/design/app-modes.md): the lead line for the way into instructor mode,
// the key that asks native code for the switch, and the "Still in rider mode" plate when the
// screen lock was not confirmed. A switch replaces this page; any other end leaves rider mode as it
// was. The plate goes when the user types or presses anything ("States").
import { strip } from "../modes/view.ts";
import { parseAnswer, parseWay, RIDER } from "../modes/words.ts";
import type { Way } from "../modes/words.ts";
import { notice } from "./pages.ts";

/** The two native intents the strip uses (bridge.ts). */
export interface StripIntents {
  instructorWay(): Promise<unknown>;
  askInstructorMode(): Promise<unknown>;
}

export class ModeStrip {
  private way: Way | null = null;
  private notConfirmed = false;
  private asking = false;
  private readonly intents: StripIntents;
  private readonly changed: () => void;

  constructor(intents: StripIntents, changed: () => void) {
    this.intents = intents;
    this.changed = changed;
    intents.instructorWay().then(
      (reply) => {
        this.way = parseWay(reply);
        changed();
      },
      () => undefined,
    );
    for (const type of ["keydown", "pointerdown"]) document.addEventListener(type, () => this.dropPlate(), { capture: true });
  }

  /** What step 1 shows of the strip, so the page is drawn again when it changes. */
  get key(): string {
    return JSON.stringify([this.way, this.notConfirmed]);
  }

  plates(): HTMLElement[] {
    return this.notConfirmed ? [notice(RIDER.notConfirmed.head, RIDER.notConfirmed.detail)] : [];
  }

  nav(): HTMLElement {
    const s = strip(RIDER.key, () => void this.ask());
    if (this.way) {
      s.lead.textContent = RIDER.lead[this.way];
      s.lead.hidden = false;
    }
    return s.nav;
  }

  private async ask(): Promise<void> {
    if (this.asking) return;
    this.asking = true;
    this.dropPlate();
    try {
      if (parseAnswer(await this.intents.askInstructorMode()) === "notConfirmed") {
        this.notConfirmed = true;
        this.changed();
      }
    } catch {
      // Refused: nothing changed.
    } finally {
      this.asking = false;
    }
  }

  private dropPlate(): void {
    if (!this.notConfirmed) return;
    this.notConfirmed = false;
    this.changed();
  }
}
