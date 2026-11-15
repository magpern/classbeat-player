// The scene's one fullscreen pass (scene.md "Colour: two hues, never a mix", S5), as in the mock-up: every
// light is analytic and added in LINEAR light, as a luminance in the token it carries, so every pixel is
// `a x token + w x white` and nothing blends two tokens. Per pixel three luminance accumulators are kept: the
// current token's, the next token's (the anticipation) and white's. The token with the larger share owns the
// pixel (a tie goes to the current): its colour is that token scaled to the two tokens' summed luminance, plus
// the white. A hue-preserving tone map acts on luminance (a channel that would pass 1 moves toward white at the
// same luminance), the text cap is a scale of the colour in linear light, and the sRGB encoding is the last step.
// A source changes token by a flag, in one frame, at constant luminance (the flag moves no luminance). Text only:
// strings and the numbers they are built from; nothing here reads a clock or the page.

import { COMB, COMB_HALF_WIDTH } from "./light-calc.ts";
import { BURST_SHADOW, BURST_SHADOW_DEPTH, FADE, GROW, MAX_BOXES } from "./text-mask-calc.ts";

export const BEAMS = 22;
/** A wall dot: full inside this share of its radius, nothing at the edge (the mock-up's smoothstep(.3, .1, r)). */
export const DOT_INNER = 0.33;
export const DOT_OUTER = 1;
const f = (n: number): string => n.toFixed(4);

export const VERTEX = `varying vec2 vUv;
void main() {
  vUv = position.xy * 2.0;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

export const FRAGMENT = `precision highp float;
varying vec2 vUv;
uniform float uAspect;
uniform float uTanH;
uniform float uTime;
uniform vec3 uTokA;          // the current token, linear light
uniform vec3 uTokB;          // the next token, linear light
uniform float uMaster;       // lights down (paused, before the start), the song-change dim
uniform float uAmb;          // the haze's ambient glow, a luminance
uniform float uHazeDetail;   // 3 octaves at High, 2 below
uniform float uCrossX;       // the cross's front, a share of the width from the left; 2 when there is none
uniform float uWipe;         // the anticipation's wipe, 0 to 1
uniform float uStill;        // 1 in the still rig: the anticipation is one frame
uniform float uWallOn;
uniform float uWallLevel;
uniform float uWallMode;     // 0 a slow wave, 1 a chase, 2 a chase both ways
uniform float uChase;        // the chase's step
uniform float uBurst;        // white luminance of the burst
uniform float uLensW;        // the white share of a lens: 0.5 at rest, up to 0.75 in the lens flash
uniform int uN;
uniform vec3 uBO[${BEAMS}];
uniform vec3 uBD[${BEAMS}];
uniform float uBI[${BEAMS}]; // beam luminance
uniform float uBL[${BEAMS}]; // lens luminance
uniform float uBF[${BEAMS}]; // 0 the current token, 1 the next
uniform float uBS[${BEAMS}]; // spread
uniform int uBoxN;
uniform vec3 uBoxA[${MAX_BOXES}]; // l, b
uniform vec3 uBoxB[${MAX_BOXES}]; // r, t
uniform float uCap;
uniform float uMaskOn;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), q = fract(p), u = q * q * (3.0 - 2.0 * q);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    if (i == 2 && uHazeDetail < 2.5) break;
    v += a * noise(p); p *= 2.03; a *= 0.5;
  }
  return v;
}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 encode(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
float wallDot(float col, float row) {
  float wave = 0.18 + 0.12 * sin(col * 0.35 + row * 0.5 + uTime * 0.6);
  if (uStill > 0.5) return 0.2;
  if (uWallMode < 0.5) return wave;
  // The chase is a comb that travels, a lit dot every ${COMB} columns and one column a beat: any region holds the same number of them.
  float head = mod(uChase, ${COMB}.0);
  float d = abs(mod(mod(col - head, ${COMB}.0) + ${COMB}.0 * 1.5, ${COMB}.0) - ${COMB}.0 / 2.0);
  if (uWallMode > 1.5) d = min(d, abs(mod(mod(55.0 - col - head, ${COMB}.0) + ${COMB}.0 * 1.5, ${COMB}.0) - ${COMB}.0 / 2.0));
  return wave + 0.6 * max(0.0, 1.0 - d / ${COMB_HALF_WIDTH.toFixed(1)});
}

void main() {
  vec2 uv = vUv;
  float sx = uv.x * 0.5 + 0.5;
  // The text boxes: w is the cap's weight (the box grown by 1.2 vh, faded over 3 vh); shadow a wider, rounded one for the burst.
  float x = sx * uAspect, y = uv.y * 0.5 + 0.5, w = 0.0, shadow = 0.0;
  for (int j = 0; j < ${MAX_BOXES}; j++) {
    if (j >= uBoxN) break;
    float dd = max(max(uBoxA[j].x - x, x - uBoxB[j].x), max(uBoxA[j].y - y, y - uBoxB[j].y));
    w = max(w, 1.0 - smoothstep(${f(GROW)}, ${f(GROW + FADE)}, dd));
    float de = length(max(vec2(max(uBoxA[j].x - x, x - uBoxB[j].x), max(uBoxA[j].y - y, y - uBoxB[j].y)), 0.0));
    float s = 1.0 - smoothstep(0.0, ${f(BURST_SHADOW)}, de);
    shadow = 1.0 - (1.0 - shadow) * (1.0 - s * s); // a union that is smooth where two boxes meet
  }
  vec3 R = normalize(vec3(uv.x * uAspect * uTanH, uv.y * uTanH, -1.0));
  vec3 L = vec3(0.0); // luminance: the current token, the next token, white

  // Haze: the zone's ambient glow, in the current token, switched per pixel as the cross's front passes.
  float fb = fbm(uv * vec2(uAspect, 1.0) * 1.3 + vec2(uTime * 0.025, -uTime * 0.017));
  float hz = 0.15 + 2.2 * fb * fb;
  float haze = uAmb * uMaster * hz * (0.15 + 0.85 * smoothstep(-0.6, 1.0, uv.y));
  if (sx >= uCrossX) L.y += haze; else L.x += haze;

  // The LED wall: dots at depth 26, one token per dot (the anticipation's wipe, then the cross's front).
  if (uWallOn > 0.5) {
    vec3 P = R * (26.0 / -R.z);
    float c = P.x / 0.72 + 27.5, r = (P.y - 1.0) / 0.78 + 6.5;
    float col = floor(c + 0.5), row = floor(r + 0.5);
    if (col >= 0.0 && col <= 55.0 && row >= 0.0 && row <= 13.0) {
      vec2 off = vec2((c - col) * 0.72, (r - row) * 0.78) / 0.25;
      float fall = 1.0 - smoothstep(${f(DOT_INNER)}, ${f(DOT_OUTER)}, length(off));
      float v = wallDot(col, row) * uWallLevel * uMaster * fall;
      float t = col / 55.0;
      float share = ((col - 27.5) * 0.72 / (26.0 * uTanH * uAspect)) * 0.5 + 0.5;
      bool next = (uWipe > 0.0 && (uStill > 0.5 || t >= 1.0 - uWipe)) || share >= uCrossX;
      if (next) L.y += v; else L.x += v;
    }
  }

  // The beams and their lenses.
  for (int i = 0; i < ${BEAMS}; i++) {
    if (i >= uN) break;
    vec3 O = uBO[i], D = uBD[i], w0 = -O;
    float b = dot(R, D), d = dot(R, w0), e = dot(D, w0);
    float den = max(1e-4, 1.0 - b * b);
    float sc = max((b * e - d) / den, 0.0);
    float tc = clamp((e - b * d) / den, 0.0, 45.0);
    float dist = length(w0 + sc * R - tc * D);
    float rad = 0.12 + tc * uBS[i];
    float I = 2.4 * exp(-dist * dist / (rad * rad)) / (0.35 + rad * 2.0);
    I *= clamp(0.3 / sqrt(den), 0.3, 2.2) * exp(-tc * 0.03);
    float beam = I * uBI[i] * (0.45 + 0.75 * hz);
    float s2 = max(dot(R, O), 0.1);
    float dl = length(R * s2 - O) / s2;
    float fc = max(0.0, dot(D, normalize(-O)));
    fc = 0.12 + 0.88 * fc * fc * fc;
    float lens = uBL[i] * fc * (exp(-dl * dl * 12000.0) * 3.0 + 0.0005 / (dl * dl + 0.0005) * 0.3);
    // The lens is half white, half its token.
    if (uBF[i] > 0.5) L.y += beam + 0.5 * lens; else L.x += beam + 0.5 * lens;
    L.z += uLensW * lens;
  }
  // The burst is held back round the text by a soft shadow (rounded, wide), so the dark under the text is a penumbra and not a slab.
  L.z += uBurst * (1.0 - ${f(BURST_SHADOW_DEPTH)} * shadow * uMaskOn);

  // Ownership: the token with the larger share owns the pixel and shows the other's light in its hue.
  float own = L.y > L.x ? 1.0 : 0.0;
  vec3 tok = own > 0.5 ? uTokB : uTokA;
  float total = L.x + L.y + L.z;
  vec3 col3 = tok * ((L.x + L.y) / lum(tok)) + vec3(L.z);
  // A tone map on luminance; a channel over 1 moves toward white at the same luminance.
  if (total > 1e-6) {
    float mapped = 1.0 - exp(-1.3 * total);
    col3 *= mapped / total;
    float m = max(col3.r, max(col3.g, col3.b));
    if (m > 1.0) col3 = vec3(mapped) + (col3 - vec3(mapped)) * ((1.0 - mapped) / (m - mapped));
  }
  // The dark-under-text rule: the colour scaled so its luminance is at most the cap, in linear light.
  float Y = lum(col3);
  if (Y > uCap) col3 *= mix(1.0, uCap / Y, w * uMaskOn);
  gl_FragColor = vec4(encode(col3), 1.0);
}`;
