// What a signed-in page that has content of its own gives the page loader (signed-in.ts): how it
// reads, how it shows what it read, and the one refusal it answers itself.
import type { Answer } from "../core/answer.ts";

export interface View {
  /** The words beside the working circle while the first read is out. */
  readonly loading: string;
  read(): Promise<Answer>;
  /** Draws an ok answer's body into `main`, h1 first. */
  show(main: HTMLElement, body: unknown): void;
  /** A 4xx the page answers itself (a class that is not there); true when it drew it. */
  refused(main: HTMLElement, answer: Extract<Answer, { kind: "refused" }>): boolean;
}
