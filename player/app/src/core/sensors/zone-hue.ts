// The zone hues of the design tokens (renderer/design/tokens.css, --zone-1 to --zone-7). The only
// hue on the sensor panel is a gauge's band, which stands for the planned zone (rule 7); a test
// keeps this table equal to the tokens.
export const ZONE_HUES: Readonly<Record<number, string>> = {
  1: "#6fa8ff",
  2: "#22d3c5",
  3: "#81b250",
  4: "#ffe626",
  5: "#ff8940",
  6: "#ff6680",
  7: "#bb8cff",
};
