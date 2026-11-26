// Writes a property list as XML, for the planted files of the self-test (issue #894): strings,
// integers, booleans, arrays and dictionaries, which is all the planted files hold.
import type { Json } from "./allowlists.ts";

const escape = (s: string): string => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function value(v: Json): string {
  if (typeof v === "string") return `<string>${escape(v)}</string>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (typeof v === "number" && Number.isInteger(v)) return `<integer>${v}</integer>`;
  if (Array.isArray(v)) return `<array>${v.map(value).join("")}</array>`;
  if (v !== null && typeof v === "object") return `<dict>${Object.entries(v).map(([k, x]) => `<key>${escape(k)}</key>${value(x)}`).join("")}</dict>`;
  throw new Error(`a property list cannot hold ${JSON.stringify(v)}`);
}

export const plistXml = (v: Json): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${value(v)}</plist>\n`;
