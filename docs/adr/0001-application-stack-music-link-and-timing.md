# 0001. Application stack, music link and timing model

Status: Accepted (2026-11-12), by the Orchestrator under the frozen plan. It records plan
sections 4, 6, 8, 9 and 12; it decides nothing the plan does not say.

## Context

The player shows a class made in classbeat in step with music that plays somewhere else
(plan section 4). It must run on macOS and Windows, Linux if it comes cheaply, look good in 3D,
and later serve phones from the same code (plan sections 7 and 8). Spotify's audio cannot be
played inside our application and must never be downloaded (plan section 3). Swedebeat playback
is a later phase with its own ADR (plan section 12, PL11).

## Decision

### Application stack

- **Platform: web technology (TypeScript).** On computers it ships inside **Electron**, which
  brings the same browser engine to Windows, macOS and Linux and has Bluetooth built in. Phones
  get a web page; there is no phone app of our own.
- **The shell owns everything that is not drawing:** sign-in, class selection, sync, the class
  clock, following the music, Bluetooth. A scene only draws what the shell tells it.
- **Two screens side by side:** the plain 2D screen (always there, the phone's view and the
  fallback for weak computers), built first, and the 3D scene.
- **The 3D scene is a replaceable part.** Godot 4 is the leading candidate, web 3D (Babylon.js
  or three.js) the alternative. **Spike 2** decides, on the integrated application and before
  phase PL6 starts. It builds the same rough light-show scene in web 3D and in Godot (as its own
  program and as a web export) on a throwaway harness (a minimal shell with a presenter window,
  a fake class clock and a stub 2D screen, deleted after the trial), and shows for each: the
  look and frame rate on a studio-class computer; full screen on a second display while the
  presenter window keeps the keyboard; large text readable at room distance, still right after
  a resize or a display change; recovery to the plain 2D screen within 2 s when the scene is
  killed, with the class clock unaffected; how well agents can build it and check its pictures.
  A transparent shell window laid over Godot's is not used.
- **Pure core.** The class clock and the music-link state machine are pure modules (no I/O),
  tested with a fake link, so they run in CI with no Spotify, no operating-system access and no
  network.

### Music link: follow, never depend

- **Option A, first version:** follow the Spotify desktop app through the operating system:
  Spotify's AppleScript interface on macOS, the system media session on Windows, MPRIS on Linux
  (best effort).
- **Option D, always available:** the manual clock: Start with the music, nudge earlier or
  later. It is the only mode for Swedebeat and soundless classes at first, and the fallback
  whenever following fails.
- **Not used:** playing Spotify inside the player (option C, which includes the Web Playback
  SDK). The Spotify Web API (option B) is not part of the first version; it is only an optional
  extra for the beta circle.
- The class clock runs inside the player and never stops because a connection dropped. The
  music link corrects it.
- **The player never downloads, stores or plays Spotify's audio.** It holds no Spotify token.
- Start, pause and next go through the same local interface and the media keys.
- Songs are matched by title, artist and length, in the class's order; Spotify ids are used only
  where the operating system gives them.
- **One interface, one module per follower** (macOS, Windows, Linux, manual, fake), so replacing
  a follower is one module.

### Timing model

1. **Each song owns a window of class time**, from its own start to the next song's start. The
   class format states the crossfade the class was designed for (9 s today): a 180 s song
   followed by another owns 171 s.
2. **While song k plays at position p, class time is the song's start plus p, never beyond the
   end of its window.** If the song plays past its window, the clock **holds** at the window's
   end.
3. **The incoming song owns the overlap.** From the moment the next song is reported, class time
   is that song's start plus its position; if it arrives early the clock **jumps forward** over
   the rest of the previous window.
4. **While locked, the clock never moves backwards by itself.** It moves backwards only when the
   instructor seeks or goes to an earlier song, and then intervals replay on purpose. Backward
   corrections smaller than the measuring error are smoothed out, not applied.
5. **Locking again goes to where the music is, in either direction,** within 3 s of fresh
   readings of a class song after coasting or being off the list, without waiting for a
   confirmation. A correction of **more than 5 s** either way is announced on the instructor's
   screen and the companion ("resynced, 30 s back") with a one-touch undo that returns to the
   manual clock at the earlier place.
6. **The last interval under a song is elastic.** During a hold it stays on screen with its cue;
   its countdown is the time until the next song is expected, from the song's length and the
   crossfade measured so far (the planned one before the first song change). A forward jump ends
   it early and the next interval starts with its cue as usual.
7. **Totals follow the measurement.** Time left is the remaining windows plus the hold expected
   at each remaining song change. The measured crossfade is shown beside the planned one, and
   the player says when they differ.
8. **Positions carry their own time.** A reading is extrapolated from the moment the system last
   updated it (Windows gives that moment explicitly); a stale reading is never treated as
   current.

### Link states

| State | When | The class clock |
|---|---|---|
| Locked | A class song is playing and readings are fresh | Follows the music |
| Paused | The music app reports pause | Stops |
| Coasting | Readings stopped or went stale; the music app closed or restarted | Runs on by itself, marked on screen; on fresh readings goes to where the music is, either direction |
| Off the list | Something not in the class plays (another song, an advert, another app) | Runs on by itself, marked on screen; the instructor can pause or pick the place |
| Ambiguous | The same recording occurs twice and the order does not settle which | Stays on the occurrence nearest the current class time; the instructor can pick the other |
| Manual | No link, or the instructor chose it | Start, pause and nudge by hand |

### Two accuracy targets

- **Interval timing:** the clock within about 1 s of the music.
- **Beat effects:** within 50 ms. If this target fails, the scene pulses at the song's tempo
  without claiming to hit each beat, and bursts are tied to interval changes. Passing the first
  target does not prove the second.

### Spike 1 pass criteria (fixed here)

A throwaway follower logs readings against a reference recording of the same playback, on macOS
and Windows, for a full class at crossfade off, 5 s and 9 s.

| What | Passes when |
|---|---|
| Interval timing | The class clock is within 1 s of the music for at least 95 % of the class, and never more than 2 s off for longer than 5 s |
| Song changes | Every change is detected within 1 s, at each crossfade setting, and the clock never moves backwards |
| Pause and resume, seek, next and previous | Locked again within 3 s, at the right place |
| The same recording twice in one class | The right occurrence is chosen from the order; a cold start on such a song is reported as ambiguous, not guessed silently |
| A song that is not in the class; an advert; another app playing | Reported as off the list within 3 s; the clock keeps running; locks again on return |
| The music app closed and restarted; readings going stale | Coasting is entered within 3 s and left within 3 s of fresh readings; no stale reading is ever applied as current |
| Readings lost while the music is paused for 30 s, then restored | The clock coasts, then goes back to the music's place within 3 s of fresh readings, announces the correction, and the undo works |
| Readings lost while the music keeps playing for 30 s, then restored | The clock is within the interval target on return, with no announcement |
| An hour of play | No drift beyond the interval target |
| Beat effects (measured separately) | A flash on the beat is within 50 ms of the audible beat for at least 90 % of beats; if not, beat effects fall back to tempo-only and the plan is otherwise unchanged |

**If interval timing fails** on Windows or macOS, the first version ships with the manual clock
and option B for the beta circle, and the rest of the plan is unchanged.

## Alternatives

- **A game engine as the whole application** (Godot, Unity, Unreal): strong at the scene, weak
  at sign-in, forms, the website and phones, which would need web code beside it anyway. Unreal
  is excluded: probably MOWL's engine and the heaviest to build.
- **Tauri instead of Electron:** a much smaller download. Kept as the alternative.
- **Spotify Web API (B):** 5 named users per app in Development Mode, Premium required, accuracy
  of a few seconds by polling. Only an optional extra for the beta circle.
- **Playing Spotify in the player (C):** the Web Playback SDK needs Widevine, which stock
  Electron lacks, and is not open to our use. Rejected.

## Consequences

- No Spotify token in the player, so nothing expires mid-class and there is no rate limit.
- The local interfaces are not contracts: a Spotify or system update can break a follower. The
  manual clock is the guaranteed fallback and each follower is one replaceable module.
- Linux following is best effort, with the manual clock if it fails.
- If Godot wins spike 2, the application carries a second runtime with its own build pipeline on
  three systems, and the scene does not run on phones, which keep the 2D view.
- Spike 1 (PL0) decides whether the music design stands before PL5; spike 2 decides the scene
  technology before PL6.
