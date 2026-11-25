// What the Swedebeat sign-in form says when it stays open without a refusal from Swedebeat (issue
// #709): a field was left empty, the shell did not take the details, or the call did not finish.
// Pure: field labels in, words out. Never a value typed in a field.
import type { MixFieldView } from "./view.ts";

export type FormNote =
  | { readonly kind: "missing"; readonly labels: readonly string[] }
  /** The shell answered that it did not take the details: nothing was sent. */
  | { readonly kind: "not_taken" }
  /** The call to the shell failed; what the shell holds is read again. */
  | { readonly kind: "failed" };

/** The note for the fields left empty, in the form's order, or null when every field is filled. */
export function missingNote(fields: readonly MixFieldView[], empty: ReadonlySet<string>): FormNote | null {
  const labels = fields.filter((f) => empty.has(f.id)).map((f) => f.label);
  return labels.length === 0 ? null : { kind: "missing", labels };
}

/** "a", "a and b", "a, b and c". */
const listed = (words: readonly string[]): string => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]!}`);

export function noteWords(note: FormNote): { readonly headline: string; readonly detail: string } {
  switch (note.kind) {
    case "missing":
      return { headline: `Type your ${listed(note.labels.map((l) => l.toLowerCase()))}`, detail: "Every field is needed to connect. Nothing was sent." };
    case "not_taken":
      return { headline: "Those details were not sent", detail: "Type them again. Nothing was kept." };
    case "failed":
      return { headline: "Connecting did not finish", detail: "Type your details again to try once more." };
  }
}
