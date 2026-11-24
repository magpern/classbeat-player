// Instructor mode's class list on fakes (issue #630), as the room screen is on fakes (fake-room.ts):
// made-up classes, each opening the one fake room. The synced list comes with the instructor's
// account (ADR 0011 sections 4 and 8).

export interface ClassRow {
  readonly title: string;
  readonly facts: string;
}

export const FAKE_CLASSES: readonly ClassRow[] = [
  { title: "Tempo builder", facts: "45 min · 11 songs" },
  { title: "Hill repeats", facts: "50 min · 12 songs" },
  { title: "Friday recovery ride", facts: "30 min · 8 songs" },
];
