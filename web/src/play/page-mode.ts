// The page is one of two things: a page of the website (the picker and the states around it) or the
// room screen. Each has its own stylesheet, and only the one in use applies, because the room's
// rules (full-screen black stage, its own buttons) and the website's (text, plates, buttons) share
// names. Both are linked in index.html and fetched with the page; this only switches which applies.

export type Mode = "page" | "room";

const SHEET: Readonly<Record<Mode, string>> = { page: "link#css-page", room: "link#css-room" };

export function setMode(mode: Mode): void {
  for (const m of ["page", "room"] as const) {
    const link = document.querySelector<HTMLLinkElement>(SHEET[m]);
    if (link) link.media = m === mode ? "all" : "not all";
  }
  document.body.classList.toggle("play", mode === "room");
}
