// The named commands the shell can pass on to the music app (ADR 0001: "Start, pause and next go
// through the same local interface"). Pure: names only, never free text. The music app plays its
// own music; nothing here plays, fetches or stores audio (plan section 3, rule 3).

export const TRANSPORT_ACTIONS = ["play", "pause", "next"] as const;
export type TransportAction = (typeof TRANSPORT_ACTIONS)[number];

export const isTransportAction = (v: unknown): v is TransportAction => typeof v === "string" && (TRANSPORT_ACTIONS as readonly string[]).includes(v);

export interface MusicTransport {
  /** Asks the music app; never waits, never throws, and does nothing while not following. */
  send(action: TransportAction): void;
}
