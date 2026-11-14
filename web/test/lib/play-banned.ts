// The APIs the web player page must not name (ADR 0008, section 6), read from a module's syntax
// tree: no audio, no music read, no sensor, no socket, no storage, no service worker. The page plays
// no sound (rule 3), follows no music, keeps nothing in the browser and sends nothing while a class
// runs. A name is banned wherever it is written: as a value, as a member (`navigator.mediaSession`),
// as a string key (`navigator["mediaSession"]`) or as the name of an element made by name.
import ts from "typescript";

/** The banned names of ADR 0008, section 6: media elements and APIs, the three navigator members, sockets, storage and service workers. */
export const BANNED = new Set([
  "HTMLMediaElement", "HTMLAudioElement", "HTMLVideoElement", "Audio", "AudioContext", "webkitAudioContext", "MediaSource", "MediaStream", "MediaRecorder",
  "mediaSession", "mediaDevices", "bluetooth",
  "WebSocket", "EventSource", "localStorage", "sessionStorage", "indexedDB", "caches", "serviceWorker",
]);

/** Elements that play or record: made by name, even through a helper, they are banned. */
const ELEMENTS = /^(audio|video)$/i;
/** Markup for one of them, in a string. */
const MARKUP = /<\s*(audio|video)\b/i;

/** Is this identifier the name of a property being declared (`{ caches: 1 }`, `caches: string` in a type), not a use? */
function declaresKey(id: ts.Identifier): boolean {
  const p = id.parent;
  return (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === id;
}

/** The problems of one module's source; empty when it names nothing banned. */
export function bannedApis(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const at = (n: ts.Node): string => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && BANNED.has(n.text) && !declaresKey(n)) out.push(`${n.text} (${at(n)})`);
    else if (ts.isStringLiteralLike(n)) {
      if (BANNED.has(n.text)) out.push(`"${n.text}" (${at(n)})`);
      else if (ELEMENTS.test(n.text) || MARKUP.test(n.text)) out.push(`an ${n.text.trim().replace(/^</, "")} element by name (${at(n)})`);
    } else if (ts.isTemplateExpression(n) && MARKUP.test(n.head.text)) out.push(`an audio or video element in markup (${at(n)})`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
