// Every asset the class needs, loaded before Start is offered (ADR 0008, section 2): the room
// screen's stylesheet and the four faces of the design system. From Start until the class ends the
// page sends no request, so nothing may still be on its way then.
//
// The page's own stylesheets are all linked in index.html, so they are fetched with the page; the
// room's one is held back with `media="not all"` until a class is open (page-mode.ts) and is only
// waited for here. The faces load on first use unless asked for: this asks for each of them.

/** The faces the screens set text in (system.md, Type). */
const FACES = ['600 1em "Big Shoulders Display"', '800 1em "Big Shoulders Display"', '400 1em "Atkinson Hyperlegible"', '700 1em "Atkinson Hyperlegible"'];

function sheetLoaded(link: HTMLLinkElement | null): Promise<void> {
  if (link === null || link.sheet !== null) return Promise.resolve();
  return new Promise((done) => {
    link.addEventListener("load", () => done(), { once: true });
    link.addEventListener("error", () => done(), { once: true });
  });
}

/** Resolves when the room stylesheet and every face are in; a face that cannot load does not hold the class back. */
export async function loadAssets(): Promise<void> {
  const fonts = document.fonts;
  await Promise.all([
    sheetLoaded(document.querySelector<HTMLLinkElement>("link#css-room")),
    ...FACES.map((f) => fonts.load(f).catch(() => [])),
  ]);
  await fonts.ready;
}
