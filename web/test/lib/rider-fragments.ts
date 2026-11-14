// The table of fragments the rider page's address is checked against, by the pure rule
// (unit/rider-address.test.ts) and on the real page (spec/rider-address.test.ts).

/** A control code, as the companion page's QR code carries it after the join code. */
export const CTRL = "MNPQ-RSTV";

/** [fragment, the join code read, the address kept]. */
export const FRAGMENTS: ReadonlyArray<readonly [string, string | null, string]> = [
  ["#KXPD-RMTB", "KXPD-RMTB", "/j#KXPD-RMTB"],
  ["#kxpd rmtb", "KXPD-RMTB", "/j#KXPD-RMTB"],
  ["#KXPDRMTB", "KXPD-RMTB", "/j#KXPD-RMTB"],
  ["#KXPD%2DRMTB", "KXPD-RMTB", "/j#KXPD-RMTB"],
  [`#KXPD-RMTB.${CTRL}`, "KXPD-RMTB", "/j#KXPD-RMTB"],
  [`#KXPD-RMTB.${CTRL}.extra`, "KXPD-RMTB", "/j#KXPD-RMTB"],
  [`#KXPD-RMTB%2E${CTRL}`, "KXPD-RMTB", "/j#KXPD-RMTB"],
  ["#KXPD-RMTB.", "KXPD-RMTB", "/j#KXPD-RMTB"],
  [`#.${CTRL}`, null, "/j"],
  ["#BCDF-GHJK.KXPD-RMTB.", "BCDF-GHJK", "/j#BCDF-GHJK"], // the first part is the join code; nothing after it stays
  ["", null, "/j"],
  ["#", null, "/j"],
  ["#junk", null, "/j"],
  ["#KXPD-RMTA", null, "/j"], // A is not in the alphabet
  ["#KXPD-RMT", null, "/j"],
  ["#KXPD-RMTBB", null, "/j"],
  ["#%E0%A4%A", null, "/j"], // not decodable
  ["#?from=qr", null, "/j"],
  ["#KXPD-RMTB?from=qr", null, "/j"],
  ["#<script>", null, "/j"],
  [`#KXPD-RMTB.${"X".repeat(40)}`, null, "/j"], // longer than any fragment the page is given
  ["KXPD-RMTB", "KXPD-RMTB", "/j#KXPD-RMTB"], // without its `#`
];
