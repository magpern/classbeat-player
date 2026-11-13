// The browser APIs that turn a string into markup. The site sets text only through textContent
// (src/site/ui/dom.ts); the render guards look for these in its sources and its built bundle.
export const MARKUP: readonly RegExp[] = [
  /\binnerHTML\b/,
  /\bouterHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\bdocument\s*\.\s*write(ln)?\b/,
  /\bcreateContextualFragment\b/,
  /\bDOMParser\b/,
  /\bsetHTML(Unsafe)?\b/,
  /\bparseHTML(Unsafe)?\b/,
  /\bsrcdoc\b/,
  // Pasting markup into an editable part, a response parsed as a document, an XSLT transform (#307).
  /\bexecCommand\b/,
  /\bresponseXML\b/,
  /\bresponseType\s*=\s*["'`]document\b/,
  /\bXSLTProcessor\b/,
  /\btransformTo(Fragment|Document)\b/,
];
