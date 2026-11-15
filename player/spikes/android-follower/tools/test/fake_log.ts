// Builds the recorded fake Android log (test/fixtures/android-fake.jsonl) in the exact line shape the
// Kotlin core writes (see core/src/test/.../LogLinesTest.kt). A deterministic simulation of a phone
// playing the example class: play, pause, seek, Spotify gone, an advert, a song change, then readings
// lost while paused for 34 s with an undo and a relink. Run `node --import tsx test/fake_log.ts` to rewrite the file.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MONO0 = 5_000_000;
const WALL0 = 1_763_000_000_000;
const A = { trackId: "spotify:track:SPIKEEXAMPLE0001", title: "Spike Song A", artist: "Spike Artist", durationMs: 180_000 };
const B = { trackId: "spotify:track:SPIKEEXAMPLE0002", title: "Spike Song B", artist: "Spike Artist", durationMs: 200_000 };
const AD = { trackId: "spotify:ad:1", title: "Advertisement", artist: "Spotify", durationMs: 30_000 };

type Song = typeof A;
interface Sample { song: Song; positionMs: number; state: "playing" | "paused" }

/** What the phone's Spotify session shows at second `t` of the run, or null when there is none. */
function at(t: number): Sample | null {
  const play = (song: Song, pos: number): Sample => ({ song, positionMs: pos * 1000, state: "playing" });
  if (t < 20) return play(A, t);
  if (t < 26) return { song: A, positionMs: 20_000, state: "paused" };
  if (t < 40) return play(A, 20 + (t - 26));
  if (t < 60) return play(A, 100 + (t - 40));
  if (t < 68) return null;
  if (t < 80) return play(A, 120 + (t - 60));
  if (t < 86) return play(AD, t - 80);
  if (t < 117) return play(A, 140 + (t - 86));
  if (t < 150) return play(B, t - 117);
  if (t < 156) return { song: B, positionMs: 33_000, state: "paused" };
  if (t < 190) return null;
  return { song: B, positionMs: 33_000, state: "paused" };
}

export function fakeLog(): string {
  const lines: string[] = [];
  const stamp = (t: number) => `"monoMs":${MONO0 + Math.round(t * 1000)},"wallMs":${WALL0 + Math.round(t * 1000)}`;
  lines.push(`{"t":"meta",${stamp(0)},"event":"start","platform":"android","source":"android-media-session","rate":2,"limitations":[],"device":"Fake Phone","androidSdk":34}`);
  for (let half = 0; half <= 392; half++) {
    const t = half / 2;
    if (t === 10) lines.push(`{"t":"marker",${stamp(t)},"key":"m","classTimeMs":null}`);
    if (t === 15) lines.push(`{"t":"marker",${stamp(t)},"key":"b","classTimeMs":null}`);
    if (t === 192) lines.push(`{"t":"control",${stamp(t)},"key":"undo","decision":null}`);
    if (t === 194) lines.push(`{"t":"control",${stamp(t)},"key":"relink","decision":null}`);
    const sample = at(t);
    let reading = "null";
    if (sample) {
      const polled = MONO0 + Math.round(t * 1000);
      const readAt = polled - 120;
      const pos = sample.positionMs - (sample.state === "playing" ? 120 : 0);
      reading = `{"trackId":"${sample.song.trackId}","title":"${sample.song.title}","artist":"${sample.song.artist}","positionMs":${pos},"durationMs":${sample.song.durationMs},"state":"${sample.state}","readAtMs":${readAt},"polledAtMs":${polled},"source":"android-media-session","app":"com.spotify.music"}`;
    }
    lines.push(`{"t":"reading",${stamp(t)},"reading":${reading}}`);
  }
  lines.push(`{"t":"meta",${stamp(196.5)},"event":"end"}`);
  return lines.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL("./fixtures/android-fake.jsonl", import.meta.url), fakeLog());
}
