# Class player: plan

Status: **Frozen by the owner, 2026-11-12.** Implementation starts with phase PL0. Changes from
now on are made only by the Orchestrator in a docs pull request of its own, and only to record a
decision or a result (an ADR, a spike, the owner's answer); the product rules of section 3 change
only on the owner's word. Section 13 lists what is decided and what is still open.

This is a **new product in its own repository, separate from classbeat**, with its own backend,
accounts and releases. classbeat is where classes are made; it sends a finished class to this
product over an API, the same way it saves a class to Intelligent Cycling (MOWL) today, and keeps
doing that too. Nothing is imported from classbeat's code and nothing here reads classbeat's
database. "classbeat Player" is only a working name (decision 12).

Requirements as given by the owner (2026-11-12):

- Shows the class, the time left, the target effort, cadence and BPM and what comes next.
- The same features as the MOWL player, and clearly different from it.
- No class editing. Classes are made in classbeat and sync to the player.
- A desktop application first: macOS and Windows, Linux if it comes cheaply.
- 3D and visually appealing. HTML5 is one option; a free game engine is welcome if it serves us
  better. Not MOWL's engine.
- Future proof: portable across devices. (A virtual 3D world was considered and is ruled out by
  the product rules in section 3.)
- Possibly a web app on a phone, and phones joining a class the instructor is running.
- The music must keep playing and stay in step: Spotify first, Swedebeat perhaps.
- A backend of its own, for many users.
- Bluetooth is not needed now. Later, optionally, read a bike (and perhaps a treadmill) over the
  standard protocol.

Sources: the classbeat code and ADRs (read 2026-11-12), and desk research of public pages on the
same day. What could not be opened or confirmed is listed in section 14. Nothing here is legal advice.

## 1. Findings in short

1. **It can be built, and classbeat already holds the data.** A classbeat revision has the
   segments and intervals (length, zone, cadence, seated or standing, cue, game, FTP test;
   gradient for running) and each song's start, end and BPM in class time. The player needs no
   new design data: classbeat sends a copy in a published class format (section 5).
2. **The hard part is the music, not the graphics.** No application of ours can play Spotify
   audio itself (section 4). The plan is that the instructor's own Spotify desktop app plays, and
   the player **follows** it by reading the playing track and position from the operating system.
3. **Following can be better than what MOWL does.** MOWL's timeline assumes the playlist plays in
   order with a set crossfade; classbeat's MOWL library measured 1 to 3 s of error at best.
   A player that reads the real position follows pauses, skips and seeks.
   This is the main thing to prove first (section 12, spike 1).
4. **Recommended technology:** a web-technology application on every device (in a desktop
   shell on computers), because it lets a rider's phone join with nothing to install. The room's
   3D scene is a replaceable part: the free Godot engine is the leading candidate for it, with
   web 3D as the alternative, settled by a small trial (sections 8 and 9). For the
   backend, Python with FastAPI and PostgreSQL (section 5).
5. **An own player does not make classbeat independent of MOWL yet.** Class design still reads
   each song's length, BPM and sections through the user's MOWL account. The
   player removes MOWL from the room, not from the design. Section 11.
6. **Spotify in a studio is a terms problem for every player, MOWL's included.** Spotify's own
   terms do not allow playing it publicly from a business. Swedebeat is the licensed route; the
   player could play its mixes itself, given a sanctioned source of the audio (section 4).
7. **The niche is the instructor.** Every product in this field draws for the riders. This one
   is built for the person teaching: it follows them when they improvise, and it puts their cues
   and controls on their own handlebar (section 3).

## 2. What the MOWL player does, and what ours would do

MOWL facts are from the owner's screenshot of its player choice (2026-11-12) and from its help
centre, App Store listing and press releases as shown in search excerpts (the help centre refused
direct reading), so treat the latter as indicative.

| Feature | MOWL | classbeat Player, first version | Later |
|---|---|---|---|
| Class profile as coloured blocks | Yes, along the top | Yes | |
| Current interval: zone, target | Zone colour with %FTP or %HRmax | Zone number, name and colour; RPE; %FTP and %HRmax ranges | |
| Cadence | RPM range | RPM range, or "on the beat" with the song's BPM | |
| Seated or standing | Yes | Yes | |
| Time left in the interval | Yes, a countdown | Yes | |
| Time in the class | Total time and segment time | Time left, elapsed and segment time | |
| Up next | Next interval: intensity, time, %FTP, RPM, position | Next interval and next song | |
| Song now playing, BPM | Not on the screens seen | Yes (title, artist, BPM) | Cover art |
| Coaching cue per interval | No: cues are classbeat's and are never sent to MOWL | Yes | |
| Planned load | Not confirmed | A load score under our own name, and time in zone | Actual against planned, with a sensor |
| Music | Starts and controls the Spotify app; needs Premium and public playlists; also Swedebeat and others | Follows the Spotify desktop app; manual clock for anything else | Swedebeat, own files (section 4) |
| Sensors | Bluetooth LE through each rider's phone | None | The instructor's bike, heart rate; treadmill (section 7) |
| Running classes | RUN Player | No | Phase PL10 |
| Riders' phones join the class | Yes, with a code | No | Yes, by scanning a code, nothing to install (section 7) |
| Group displays (a circle or a bar per rider), games | Yes (commercial licence) | **No, by rule** (section 3) | No |
| Platforms | iOS, Android, Mac, a desktop app | macOS, Windows | Linux; phones and tablets as a web app |

The first version is the instructor's display. Phones joining a live class follow it. Team play,
the 24-rider performance display, games and a virtual world are ruled out by the product rules in
section 3.

## 3. How ours is different, and the rules the player keeps

**What MOWL's screens look like** (the owner's screenshot of MOWL's player choice, 2026-11-12):

- **THE PLAYER:** total time and segment time top left; the class as a row of coloured bars along
  the top; an "up next" strip (intensity dot, time, %FTP, RPM, position); below it **three
  rings**: the %FTP range on the left, a large ring in the zone's colour with the position and
  the interval countdown in the middle, the RPM range on the right.
- **TEAM PLAYER:** the same header, then a grid of one circle per rider (their %FTP, RPM and
  name, filled in a colour, with flames on the highest).
- **PERFORMANCE PLAYER:** the same header, then one bar per rider against a target line.

Functional conventions are free to use: a timeline, a countdown, zone colours, "up next". The
product keeps well clear of everything else that others in this field have made their own.

**Product rules** (owner, 2026-11-12: keep clear, without legal opinions). They apply to every
version and every later feature. A change to one of them is the owner's decision.

*What the player is*

1. **It displays a finished class and nothing more.** It never generates or changes intervals,
   never builds a class from a playlist, and never selects songs.
2. **It is software only**, never coupled to a bike or a machine, and it **never controls
   equipment**: no resistance, incline, brake or speed.
3. **Spotify's music stays in Spotify's own app**: the player never downloads, stores or plays
   it. Audio from a licensed provider that allows it (Swedebeat) may be played by the player,
   fetched from the provider straight to the device. No class audio or video is ever streamed
   from our server, and music is never chosen, stretched or shifted from a measured cadence. The
   song sets the target, never the other way round.

*What the screen shows*

4. **No road, ribbon, track, terrain or world.** Nothing is travelled along, and nothing in a
   scene has a slope, height or shape taken from an interval.
5. **No viewpoint or rider moving through a scene** at a speed or slope taken from sensor data.
   Sensor values are numbers and gauges against the target.
6. **None of MOWL's look:** no ring trio, no grid of rider circles, no bar per rider against a
   target line, and none of its palette, player names, owl, flames or game names.
7. **Colour means the planned intensity zone**, never a measured heart-rate zone.
8. **No hand-position icons** and no "adjust by your heart rate" instructions.
9. **Its own names for load figures.** Not TSS, Training Stress Score, Normalized Power or
   Intensity Factor, which are another company's trademarks.

*Coaching and intelligence*

10. **Cues are text, written when the class is designed.** No spoken coaching generated by AI.
11. **Nothing is generated from a user's past sessions or feedback**, no model is trained on
    users' classes, and intensity is never raised or lowered automatically from performance.
12. **No camera measurement** of a rider.

*Riders in a live class*

13. **Rider data flows one way, from the rider to the instructor.** No ranked list, no
    comparison of riders at the same point of a class, no "ghost" riders from stored data, and no
    other riders' data sent to a rider's phone.
14. **The join code carries a session identifier only.**
15. **No team games.**

**The niche: the instructor's player** (added 2026-11-12 at the owner's request)

On the room's screen MOWL is years ahead, and the rules above close off worlds, group displays
and games. A nicer scene alone is not why a studio changes product. What nobody in this field
serves well is the person teaching, who is also the person who chooses the product.

- **It follows the instructor, not a plan.** Skip a song, replay a chorus, pause for a late
  arrival: the class follows the music, so the instructor can improvise without the screen going
  wrong. This is the music link of section 4, and it stands or falls with spike 1.
- **It counts like an instructor.** Where a song has beat anchors, what is coming is counted in
  bars and beats ("drop in 4 bars", "8 bars left"), not only in seconds. Without anchors it
  counts in seconds.
- **The handlebar companion.** The instructor teaches from a bike, metres from the computer.
  Their phone on the handlebar is a teleprompter and a remote: the coaching cue in large type,
  the next intervals, the next song change, and buttons to start, pause, skip and nudge. It is a
  web page, nothing to install. classbeat already writes the cues, and they are never sent to
  MOWL.
  - It shows and steers the player. It never controls a bike or any equipment (rule 2).
  - Controlling the class needs the instructor's own sign-in or a one-time code shown only on
    the instructor's screen, never the riders' join code (rule 14).
  - It comes before riders' phones in the phases (PL8): one phone, one role, the same live
    session underneath.
- **Open.** The class format is published, so other tools can produce classes for the player and
  no gym is locked in. Recommended: release the player itself as open source as well
  (decision 13). In a field of closed systems that is unusual, and it gives a small product a
  trust it cannot buy.

*Considered and not chosen:* studio lights that follow the zone and the beat. MOWL already
drives studio lighting this way and so does at least one other product, so it would be catching
up, not a niche. It is also ruled out: external hardware such as lighting is not part of this
product (owner, 2026-11-12).

**Our own direction**

- **Own identity:** its own name, design system and zone palette. Whether it shares classbeat's
  look is the owner's choice (decision 12).
- **A light show, not a landscape.** Proposed starting point for the design work (phase PL6,
  reviewed by the owner): the screen is the studio's light rig. An abstract body of light fills
  a dark room, takes the zone's colour and intensity, breathes on the playing song's beat and
  bursts on a drop. The class itself is read from a **score**: a flat strip moving sideways under
  a fixed "now" line, with the songs as clips and the intervals above them, like a track in a
  music editor.
- It uses what a classbeat class carries and MOWL's screens do not show: the beat, the song
  boundaries, the song now playing and the coaching cue.
- **Text stays text.** Numbers and cues are large type over the scene, sized to be read from the
  back of a room, never baked into the picture. The zone is always a number and a name as well
  as a colour. Which part draws that text depends on the scene technology (section 9).
- **Presenter view:** the room sees the scene on the projector while the instructor's own screen
  shows the cue, the next intervals and the controls.
- **Plain mode:** a 2D screen with the same information, for weak studio computers and for
  reduced motion. It is built first and stays as the fallback.

## 4. Music: the deciding question

What the research found:

- **Playing Spotify inside our app is not open to us.** Spotify does offer playback in a browser
  (its Web Playback SDK, for Premium users). But it needs a browser with Widevine, which stock
  Electron lacks; Spotify says it "must not be used in commercial projects" without written
  approval; and it falls under the 5-user developer limit below. Unofficial clients are against
  the terms.
- **The Spotify Web API is a narrow door.** Development Mode allows 5 named users per app and the
  owner must have Premium; the larger quota needs a registered business with 250,000 monthly
  users. The Developer Policy forbids commercial streaming integrations (IV.2), products aimed at
  businesses such as studios (III.10) and synchronising recordings "with any visual media" (III.6;
  whether a workout timeline counts is not settled). Play, pause and seek need the user's Premium.
- **MOWL itself** starts and controls the Spotify app, asks users for a 10 s crossfade, and
  recently shipped a "compatibility update for Spotify changes, so music stays in sync when
  seeking". Staying in step with Spotify is ongoing work for everyone.
- **Swedebeat** shows only phone apps and no public API or SDK. MOWL plays a Swedebeat mix by
  downloading it to a cache, playing while it downloads (the owner, 2026-11-12). classbeat reads
  a mix's audio only for analysis and deletes it.

Options:

| | Option | Works without a Spotify developer app | Accuracy | Verdict |
|---|---|---|---|---|
| A | **Follow the Spotify desktop app through the operating system** (macOS: Spotify's AppleScript interface; Windows: the system media session; Linux: MPRIS) | Yes | To be measured; reported good on macOS and Windows, poor on Linux | **Recommended, first version** |
| B | Follow and control through the Spotify Web API | No: 5 users, non-commercial, Premium | A few seconds, by polling | Only as an optional extra for the beta circle |
| C | Play Spotify inside the player | No | Exact | Rejected: not workable in our shell and not permitted for our use |
| D | **Manual clock:** press Start with the music, nudge earlier or later | Yes | As good as the instructor's timing | **Always available**; the only mode for Swedebeat and soundless classes at first |
| E | **Play a Swedebeat mix ourselves:** download it to a cache on the device, playing while it downloads (below). Also possible later for a gym's own files | Yes | Exact | The intended Swedebeat mode; needs a sanctioned source of the audio, its own ADR and a provider's agreement |

**Recommended design: follow, never depend.**

- The class clock runs inside the player and never stops because a connection dropped.
- A **music link** corrects the clock: when the operating system reports "song k at position p",
  class time becomes the song's `start` plus `p`. A pause pauses the class, a skip or a seek moves
  it. If the link goes quiet the clock runs on by itself and locks again when the link returns.
- Because nothing goes through Spotify's servers, there is no token to expire in the middle of a
  class and no rate limit. The player never downloads, stores or plays any music itself: the
  audio stays inside Spotify's own app. (A playlist the instructor has saved for offline listening
  inside Spotify keeps working without a network.)
- Start, pause and next go through the same local interface (and the keyboard's media keys), so
  the instructor does not have to leave the player.
- Songs are matched by title, artist and length, in the class's order; Spotify's own ids are used
  only where the operating system gives them.

**The timing model** (to be fixed in an ADR in PL0 and proved by spike 1)

- **Each song owns a window of class time**, from its own start to the next song's start. The
  class is designed for a set crossfade (9 s today), so a 180 s song followed by another owns
  171 s, and the class format states that crossfade.
- **While song k plays at position p, class time is the song's start plus p, but never beyond
  the end of its window.** If the song plays on past its window, because the real crossfade is
  shorter than planned or off, the clock **holds** at the window's end.
- **The incoming song owns the overlap.** From the moment the music app reports the next song,
  class time is that song's start plus its position. If it arrives early, because the real
  crossfade is longer than planned, the clock **jumps forward** over the last seconds of the
  previous window.
- **While locked, the clock never moves backwards by itself.** In the example, with crossfade off the clock
  holds at 171 s for nine seconds and then continues from 171 s with the second song: nothing
  repeats and nothing is skipped. It moves backwards only when the instructor seeks or goes to an
  earlier song, and then intervals replay on purpose. Backward corrections smaller than the
  measuring error are smoothed out, not applied.
- **Locking again means going to where the music is, in either direction.** While coasting or
  off the list the clock is only a guess. When fresh readings of a class song return, the music
  is the truth: the clock is set to the song's start plus its position, forwards or backwards,
  within three seconds. Example: readings are lost while the music is paused for 30 s, the
  clock coasts on, and on return it goes back 30 s and those intervals play again with the
  music. The player does not wait for a confirmation, because the instructor is riding. A
  correction of more than five seconds in either direction is announced on the instructor's
  screen and the companion ("resynced, 30 s back") with a one-touch undo that returns to the
  manual clock at the earlier place.
- **The last interval under a song is elastic.** During a hold it stays on screen with its cue,
  and its countdown is the time until the next song is expected, worked out from the song's
  length and the crossfade measured so far (the planned one before the first song change).
  A forward jump ends it early and the next interval starts with its cue as usual.
- **Totals follow the measurement.** Time left in the class is the remaining windows plus the
  hold expected at each remaining song change. The player shows the measured crossfade beside
  the planned one and says when they differ.
- **Positions carry their own time.** A reading says where playback was when the system last
  updated it, not now (Windows gives that moment explicitly), so the player extrapolates from
  the reading's time and never treats a stale reading as current.

**Link states**

| State | When | The class clock |
|---|---|---|
| Locked | A song of the class is playing and readings are fresh | Follows the music |
| Paused | The music app reports pause | Stops |
| Coasting | Readings stopped or went stale; the music app closed or restarted | Runs on by itself, marked on screen. When readings return it goes to where the music is, forwards or backwards |
| Off the list | Something plays that is not in the class (another song, an advert, another app) | Runs on by itself, marked on screen; the instructor can pause or pick the place |
| Ambiguous | The same recording occurs twice in the class and the order does not settle which | Stays on the occurrence nearest the current class time; the instructor can pick the other |
| Manual | No link, or the instructor chose it | Start, pause and nudge by hand |

**Two accuracy targets, kept apart.** Interval timing needs the clock within about a second of
the music. Effects on the beat need a few hundredths of a second, which the local interfaces may
not give. Passing the first does not prove the second. If the beat target fails, the scene pulses
at the song's tempo without claiming to hit each beat, and bursts are tied to interval changes.

**Swedebeat: the player plays the mix itself** (owner, 2026-11-12: download and cache, or play
while downloading, as MOWL does)

- **Why it is the best case technically.** A mix is one long file. When the player plays it, the
  player knows the position exactly, so interval timing and beat effects are exact, there is no
  link to lose, and a cached mix plays with no network. It is also the music a gym may legally
  play in the room.
- **How it would work.** The audio goes from the provider straight to the device, never through
  our backend. It plays while it downloads into a cache on the device. The cache is encrypted,
  tied to the signed-in account, usable only by the player, and removed when the class is removed
  or the account signs out.
- **The open question is the source of the audio, not the playback.** Today the only route
  classbeat knows is through the user's MOWL account, which hands out a short-lived link to the
  mix. Using that would make the player depend on MOWL for every Swedebeat class. The other route
  is Swedebeat's own service, which has no public interface for it.
- **Permission.** Swedebeat's licence is what makes the music legal in the room, and it is given
  through Swedebeat's app and its partners. Playing and caching its audio in our player needs
  Swedebeat's agreement. Without one, the manual clock stays the Swedebeat mode: the mix plays
  from Swedebeat's own app and the instructor starts the player with it.

This still uses the instructor's personal Spotify in a room, which Spotify's terms do not allow for
a business whichever player shows the class. That stays the instructor's and the gym's
responsibility, as it is with MOWL today (section 11).

## 5. The backend, and getting classes into the player

The backend is small on purpose. It keeps accounts, a library of classes and the list of paired
devices. It designs nothing, calls no model, analyses no music, holds no audio and has no Spotify,
MOWL or Swedebeat connection.

**What it does**

- **Accounts.** The product's own accounts, independent of classbeat's. Recommended sign-in: a
  link sent by email plus passkeys, with no passwords to store.
- **Class library.** Each account's classes in the published class format, with a content hash
  and the source they came from.
- **Source API (classes in).** A source such as classbeat sends a class as a **publication**:
  the source's class id, a publication number that the source increases every time it sends that
  class, and the content hash. The backend keeps the highest number it has seen.
  - The same number with the same hash is a repeat: accepted, nothing changes, so a lost answer
    is safe to retry.
  - A lower number is refused as stale, so a delayed retry of an old send can never overwrite a
    newer one. The number is the source's own counter, not classbeat's revision number, because
    a user may deliberately send an older revision again.
  - **Removing a class is a publication too**, with its own number. The backend keeps a marker
    that the class was removed, so every device learns of it, and a late send of older content
    cannot bring the class back.
- **Player API (classes out).** Read-only. A device asks for "everything changed since this
  cursor" and gets changed classes, removals and a new cursor. If the cursor is too old or the
  format version changed, the backend says so and the device does a full resync.
- **A class being played is pinned.** The player takes one complete snapshot when a class starts,
  and sync never changes it underneath. A newer version is shown as available and applies after
  the class.
- **A small website.** Sign in, see the classes, see and revoke devices and linked sources,
  download the application, export or delete the account.

**The class format** is this project's own: one versioned JSON document per class, published as
a JSON Schema in the repository, with the Python and TypeScript types generated from it and
contract tests on both sides. **Each document is a complete snapshot**: everything needed to play
the class offline, with no reference back to the source. It holds:

- the intervals with absolute start times, and the totals (length, planned load, time in zone);
- the songs: title, artist, length, start and end in class time, BPM;
- the music source, the sport and **the crossfade the class was designed for**;
- per song, optionally, **beat anchors**: points in the song where a bar starts, each with its
  tempo, including any correction the instructor applied in classbeat. BPM alone cannot place a
  beat, so without anchors there is no pulse on the beat;
- per song, optionally, **marked moments** (a drop, a breakdown) with their times, used for
  effects only;
- for each optional part, whether it is measured, an estimate or missing.

**When music detail is missing** the class still plays: no anchors means the scene pulses at the
tempo only, no marked moments means bursts follow interval changes, and no song timing at all
means the manual clock. Older classbeat revisions were stored without song timing; classbeat
either refits such a class into a new revision before sending or sends it marked as manual-clock
only. That policy belongs to the classbeat side (phase PL3).

The application can also open a class file from disk, which is how demos, tests and the first
spike run before the backend exists.

**Pairing a device, no password in the app.** The application shows a short code and opens the
website; the signed-in user confirms the code and names the device. The device receives a
read-only token, stored hashed on the server and in the operating system's keychain on the device,
listed and revocable on the website.

**Linking classbeat.** In classbeat the user chooses "Connect player", approves on this product's
website and classbeat receives a source token that can only write that user's classes. classbeat
stores it encrypted like its other connections and gains "Send to player" beside "Save to MOWL".
That part is work in the classbeat repository, planned there once this API exists (phase PL3).

**Offline.** The application keeps its classes and asks only for changes. A studio with no
network still runs the class.

**Deletion and retention.** Deleting a class or an account removes its content from the backend
at once (only the marker that it was removed stays, with no titles in it) and from each device
at its next sync; a revoked device is wiped when it next connects. Song
titles and artists are Spotify-derived data, so they are kept only while the class exists.

**Many users.** Every instructor has their own account and sees only their own classes,
enforced in the database as well as in the code. One account can be signed in on several devices
at once. A shared studio computer can hold several instructors' sign-ins and switch between them.
Riders who join a live class need no account. A gym account that groups several instructors is
not in the first version; the data model leaves room for it.

**Real time.** The backend carries live sessions over WebSocket (section 7). The load is small:
a class is one room screen and a few dozen phones, each exchanging about one short message a
second.

**Language and database**

| | For | Against |
|---|---|---|
| **Python (FastAPI)** | Good enough by a wide margin for this load; WebSocket built in; classbeat's proven designs for tenant isolation, sessions, rate limits, export and deletion can be written again from familiar ground | Slower per server than Java, which does not matter at this size |
| Java (Spring Boot) | Equally capable, faster per server, strict typing | More code for the same result; every security design is rebuilt in a new stack; its speed advantage is not needed at this size |
| TypeScript (Node) | One language for backend and clients; the class clock could be shared as code | The security designs are rebuilt, and the stack is the least proven of the three here |

Chosen: **Python 3.12 with FastAPI, and PostgreSQL 17**, in containers. The backend is
maintained by AI agents, not by hand (owner, 2026-11-12), so the owner's own language is not a
factor, and there is no technical need for Java. Python is stable in production and fast enough
here: the work is waiting on the database and the network, not computing, and nothing heavy
(no audio, no model calls) runs in this backend. It is kept safe the way classbeat is: strict
type checking, linting and tests on every change, and several server processes behind one
address when one is not enough. PostgreSQL is the right database in every variant.

**Deployment rule for live sessions.** Live-session state lives in the memory of one process.
So the ordinary API may run as several processes, but **live sessions run as exactly one
process** at first, or the instructor and the riders could land on different ones and never meet.
Running more than one requires shared coordination first (a message broker, or routing every
connection of a session to the same process). This is written into the deploy files, not left
to memory.

## 6. Architecture

```
classbeat (separate product)        this repository
  "Send to player" ───────────►     backend/   accounts, class library, devices
  (source token, class format)                 source API (in), player API (out), website
                                               live sessions over WebSocket (later: phones)
                                    schema/    the class format (JSON Schema, generated types)
                                    player/    the desktop application
                                                 sync + local cache (token in the keychain)
                                                 class clock (pure TypeScript, deterministic)
                                                 music link: macOS | Windows | Linux | manual | fake
                                                 screen: plain 2D + 3D scene (same code runs in a browser)
                                                 presenter window, keyboard and remote control
                                                 sensors (later): heart rate, bike, treadmill
```

The class clock and the music-link state machine are pure modules with a fake link, and the
backend has a fake source, so everything runs in CI with no Spotify, no operating-system access,
no classbeat and no network.

## 7. Built for later: phones in a live class and sensors

None of this is in the first version. It is here because the owner asked for a future-proof
design, and each item decides something that must be right from the start.

**Phones joining a class the instructor is running**

- The instructor's player starts a **live session** and shows a code and a QR code. A rider scans
  it and their phone opens a web page: no install and no account, only a nickname.
- The phone shows the rider's own view in step with the room: the current interval, the time
  left, and the target worked out from their own FTP or maximum heart rate, kept on the phone.
- The instructor's player owns the class clock and publishes it through the backend a few times
  a second; phones interpolate between messages, so a short network gap is invisible.
- It needs a network in the studio. The room's own screen never depends on it.
- **Consequences now:** the backend has a real-time channel (WebSocket) and a session concept
  from the first version, and the player's screen code must also run in a phone browser.

**A phone or tablet as the player itself.** The same screen runs as a web app on a phone or
tablet for an instructor without a computer. It cannot follow Spotify there, because a browser
cannot read another app's playback, so it uses the manual clock, or joins a live session run from
a computer.

**Sensors (Bluetooth), from the web page only**

Owner, 2026-11-12: sensor reading stays in the plan, from a page opened from a link. No phone
app of our own is planned; on iPhone the answer is "use Bluefy". (The desktop player stays an
installed application.)

| Device | Can a web page read Bluetooth sensors? |
|---|---|
| The desktop player (Windows, macOS, Linux) | Yes, built in |
| Android phone or tablet, in Chrome | Yes |
| A computer's Chrome or Edge browser | Yes |
| **iPhone and iPad** | **Only in the Bluefy browser** (owner's decision, 2026-11-12). Safari, Chrome, Edge and Firefox all run on Safari's engine there and have no Web Bluetooth. An iPhone user who wants their sensor installs Bluefy, a free browser that adds it, and opens the link there; the page says so when it sees an iPhone without Bluetooth support. Without Bluefy an iPhone still gets the targets and the timing |

Limits of reading from a web page, on every device:

- the user picks the sensor in the browser's own dialog each time; a page cannot connect silently;
- the page must stay open and the screen on, which the page can request;
- many straps and bikes accept one connection at a time, so a watch or another app already
  connected can block it;
- only sensors using the standard services can be read. A bike that only broadcasts in its own
  format (Keiser M3i) cannot.

- The standard is the Bluetooth Fitness Machine Service (FTMS): Indoor Bike Data gives cadence,
  power and speed; Treadmill Data gives speed and incline. Older and simpler devices use the
  Cycling Power, Cycling Speed and Cadence, Running Speed and Cadence and Heart Rate services.
- Studio bikes vary. Stages, ICG, Life Fitness, BodyBike, Matrix, Wattbike and Schwinn are
  reported as Bluetooth-compatible; Technogym is closed; Keiser M3i is out, as above. Each model
  has to be tried.
- First step: the instructor's own bike and heart rate on the computer, shown against the target.
- Second step: each rider's phone reads their own bike or strap, shows it to that rider against
  their target, and sends it to the instructor's screen only (rule 13). Android in Chrome, iPhone
  in Bluefy.
- Treadmills: reading speed and incline is the same work. Controlling a treadmill is out of scope
  for safety.

## 8. Client technology: what is most portable

The owner's steer (2026-11-12): HTML5 is one option, not a preference. A free game engine is
welcome if it serves us better. Think future proof and portable across devices.

The product is two things at once: an **application** (accounts, pairing, sync, sensors, a
website, a phone page) and a **scene** (the 3D display). Game engines are
strong at the scene and weak at the application; web technology is the reverse.

| | Web technology (TypeScript with Babylon.js or three.js) | Godot 4 | Unity 6 | Unreal 5 |
|---|---|---|---|---|
| Cost and licence | Free, open source | Free, open source (MIT) | Free below USD 200k revenue a year, then per seat; proprietary | Royalty or seat licence |
| Windows, macOS, Linux | Yes, in a desktop shell | Yes | Yes | Yes |
| iPhone, iPad, Android | Yes, in the browser | Yes, as installed apps | Yes, as installed apps | Yes, very large apps |
| A rider joins by scanning a code, nothing to install | **Yes** | Not practical: the web export is a large download and has been unreliable on iPhone | Not practical | No |
| Television or any other screen | Anything with a browser | Android TV; no Apple TV | Apple TV, Android TV, consoles | Consoles |
| Virtual reality later | Yes (WebXR) | Yes | Yes | Yes |
| A rich 3D scene | Good, built in code; fewer ready-made tools | Full engine with an editor | Full engine, largest ecosystem | Highest fidelity |
| Bluetooth sensors | Built in on desktop and Android; on iPhone through the Bluefy browser | Community plugins; desktop confirmed, phones not confirmed | Third-party plugins | Third-party plugins |
| Sign-in, forms, lists, the website | Native ground | Awkward | Awkward | Awkward |
| One code base for the room's screen, the phone and the website | **Yes** | No: phone page and website are separate web code anyway | No | No |
| Agents can build it, test it and check screenshots | Best | Good (text scenes, headless runs) | Harder (editor licence in CI, heavy asset files) | Poor |

**Recommended: web technology as the platform.**

- It is the only option that runs on every device with a screen from one code base, and the only
  one where a rider's phone joins with nothing to install. A game engine would still need that
  phone page and the website written in web technology beside it.
- On the desktop it ships inside a shell. Recommended: Electron, because it brings the same
  browser engine to Windows, macOS and Linux and has Bluetooth built in. Tauri is the alternative
  for a much smaller download.
- On phones it is a web page. No phone app of our own is planned (owner, 2026-11-12); iPhone
  users who want their sensor use the Bluefy browser.
- Unreal is excluded: it is probably MOWL's engine (not confirmed) and the heaviest to build.

**The room's 3D scene is a separate, replaceable part.** The shell owns everything that is not
drawing: sign-in, class selection, sync, the class clock, following the music, Bluetooth. A scene
only draws what the shell tells it, many times a second. So the class clock is written once, and
a scene can be swapped or added without touching the rest. Two screens exist side by side: the
plain 2D screen (always there, also the phone's view and the fallback for weak computers) and
the 3D scene.

## 9. Drawing the scene

MOWL's engine is **probably Unreal** (its iOS binary follows Unreal's naming and the app is about
485 MB; not confirmed).

| | For | Against |
|---|---|---|
| **Godot 4, started by the shell** (the owner's leaning, 2026-11-12) | A real engine and editor from the first 3D scene: animation, shaders, particles and lighting are its home ground even with no world. Richer scenes later extend what exists. Free and open, scenes are text files | A second runtime in the application (larger download, two build pipelines on three systems). The scene does not run on phones, which keep the 2D view. How well agents can check its pictures in CI is not yet proven |
| **Web 3D inside the shell** (Babylon.js, or three.js for a lighter scene) | One runtime and one build. The same scene could run on phones and tablets. Agents check it with ordinary browser screenshots | A library, not an engine with an editor: richer scenes are built entirely in code |

**Godot is a good fit for running a class even with no world**, and it does make later visual
enhancements easier. A virtual world is ruled out (section 3), so Godot has to earn its place on
the light show alone. What it does not make easier is anything on phones or the website, which
stay web code either way.

**The scene is replaceable only once its join with the shell is settled.** With web 3D the scene
is part of the shell's own window and the text is ordinary HTML over it. With Godot there are
three ways to join, and they differ in who owns the projector window and who draws the text:

| | Projector window | Text | Risk |
|---|---|---|---|
| Godot as its own program, started by the shell | Godot's | Drawn by Godot from what the shell sends | Two programs to keep in step: focus, window placement, crash recovery, two things to sign |
| Godot's web export running inside the shell | The shell's | HTML over the scene | Godot's simpler web renderer, not its best one |
| A transparent shell window laid over Godot's | Both | HTML | Fragile across systems and in full screen; not recommended |

**The choice does not have to be made now**, but it is made on the integrated application, not on
pictures alone. The real shell, class clock and plain 2D screen are the same in every case and
are built in phases PL4 and PL5. Spike 2 runs earlier, in PL0, on a **throwaway harness**: a
minimal shell with a presenter window, a fake class clock and the 2D screen as a stub, written
only for the trial and deleted after it. Its result is required before phase PL6 starts. Spike 2 builds the same rough light-show scene in web 3D
and in Godot (as its own program and as a web export) and must show, for each:

- the look, and the frame rate on a studio-class computer;
- full screen on a second display while the presenter window keeps the keyboard and its controls;
- large text placed and readable at room distance, and still right after a resize or a display
  being plugged in or removed;
- **recovery:** when the scene is killed, the room's screen falls back to the plain 2D screen
  within two seconds and the class clock is unaffected;
- how well agents could build it and check its pictures automatically.

Godot is the leading candidate; the spike confirms it or shows why not, before phase PL6 starts.

No choice here changes the music question: no engine can play Spotify itself, and all can follow it.

## 10. Repository, hosting and distribution

- **Repository:** one new repository for the whole product (`backend/`, `schema/`, `player/`,
  `docs/`), with its own issues, CI and releases. It takes over classbeat's working rules
  (one issue per pull request, independent review before merge, Conventional Commits, tests on
  fakes only) as its own `AGENTS.md`, written for this project.
- **Hosting the backend:** a container image and a compose file, deployable beside classbeat on
  the owner's server or anywhere else, on its own domain. Deploying, DNS and TLS are the owner's.
- **Signing the application.** macOS needs an Apple Developer ID and notarisation (USD 99 a
  year). Windows needs a code-signing identity (Microsoft's signing service at roughly USD 10 a
  month if Sweden is eligible for an individual, otherwise a certificate or the Microsoft Store).
  Both are paid and in the owner's name.
- **Updates:** signed automatic updates from the repository's releases.
- **CI cost:** macOS and Windows build runners cost more minutes than Linux; the application's
  jobs run when anything they are built from changes: `player/`, `web/` (the screens the
  application shows), `schema/`, the build and packaging scripts, the workflow files themselves
  and the dependency manifests and lockfiles.

## 11. Terms and risks

- **classbeat's provider decision applies here too and must be extended first.** classbeat's ADR
  0010 limits it to an invite-only, free, non-commercial beta. This product adds: Spotify-derived
  titles stored in a second service and on users' devices; visuals shown in time with Spotify
  playback; and use in a studio. It needs its own written decision before any build.
- **Spotify.** Option A uses no Spotify developer interface, so the developer limits (5 users,
  non-commercial) do not apply to the player as they do to classbeat's song picking. That is our
  reading, not a ruling. Spotify's consumer terms still make studio use the instructor's risk. If
  option B is added, the player becomes a Spotify application with all those limits.
- **MOWL.** classbeat uses MOWL's undocumented API with the user's own account. Shipping a
  competing player makes it more likely that MOWL objects or blocks it. classbeat's design depends
  on MOWL for music analysis, so that would stop new classes, not only saving.
- **Independence later.** Replacing MOWL's analysis needs another source of BPM and song
  structure: the user's own licensed audio analysed on their device, or a provider agreement.
  Not planned here.
- **Fragility of following.** The local interfaces are not contracts: a Spotify or system update
  can change them. The manual clock is the guaranteed fallback, and the music link sits behind one
  interface so a replacement is one module.
- **A second service to run.** Its own accounts mean its own privacy text, export and deletion,
  backups and security upkeep.
- **Look and feel, and the product rules:** section 3.

## 12. Phases

Sizes are in pull requests. Security-critical ones (accounts, tokens, tenant isolation) get the
stronger developer and reviewer, as in classbeat.

| Phase | What | Size | Needs the owner |
|---|---|---|---|
| **PL0** | Repository setup: working rules, CI skeleton, the decisions of section 13 written as ADRs (class format; accounts, pairing and tokens; application stack and music link; provider terms). **Spike 1** (music, pass criteria below) on the owner's Mac and Windows machine. **Spike 2** (scene and its join with the shell, section 9) on a typical studio computer. | About 5, 2 spikes | Creates the repository; decisions; runs both spikes (a live account and a real screen) |
| **PL1** | The class format: schema, generated types, example classes, a converter test against classbeat's data shape | About 3 | |
| **PL2** | Backend: accounts and sign-in, class library, source API, pairing and device tokens, player API, website, export and deletion, container image | About 10 | |
| **PL3** | classbeat side, in the classbeat repository: the player connection and "Send to player" | About 4 | |
| **PL4** | Application core: desktop shell, pairing, class list, offline cache, open a class file, class clock, plain 2D screen, manual clock, full screen and presenter window, keep-awake, builds on three systems in CI | About 8 | |
| **PL5** | Music link: the interface and its fake, macOS and Windows followers, Linux best effort, lock and re-lock, transport control, crossfade check | About 6 | One authorized live check per system |
| **PL6** | The 3D scene, in the technology spike 2 confirmed: design direction, the light show and the score, beat pulse, quality levels, reduced motion | About 6 to 8 | Reviews the design |
| **PL7** | Release: signing, notarisation, updater, release workflow, download page, deploy runbook | About 5 | Signing accounts; domain; the first deploy |
| **PL8** | Live sessions. First **the handlebar companion**: the instructor's phone as teleprompter and remote (section 3). Then riders: join by code, the rider's view in step with the room. Also the player as a web app on a phone or tablet | About 10 | |
| **PL9** | Sensors: the instructor's heart rate, cadence, power and FTMS bike on the computer; then riders' phones sending theirs to the session, from the web page (Android in Chrome, iPhone in Bluefy) | About 6 | A bike to test on; an Android phone and an iPhone with Bluefy |
| **PL10** | Running classes and treadmill reading | About 3 | A treadmill to test on |
| **PL11** | Swedebeat playback: play a mix while downloading it to an encrypted cache on the device; exact timing | About 6 | Swedebeat's agreement and a sanctioned source of the audio; its own ADR |
| Ruled out | A group display, ranked lists, games, a virtual world (section 3) | | |

**Spike 1 pass criteria** (proposed; fixed in the timing ADR before the spike runs). A throwaway
follower logs readings against a reference recording of the same playback, on macOS and Windows,
for a full class at crossfade off, 5 s and 9 s.

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
| Beat effects (measured separately) | A flash on the beat is within 50 ms of the audible beat for at least 90 % of beats. If not, beat effects fall back to tempo-only (section 4) and the plan is otherwise unchanged |

Spike 1 decides whether the music design stands. If interval timing fails on Windows or macOS, the first version ships with the manual clock and option B for the beta circle,
and the rest of the plan is unchanged. PL4 can start in parallel with PL2 because the application
opens class files from disk. After PL5 the player is usable in a class; PL6 makes it the product
the owner described.

## 13. Decisions for the owner

At the freeze (2026-11-12) the owner gave go on PL0. Until the owner says otherwise, the
recommended option of each decision below is the working default (AGENTS.md, section 1).
Decisions 9 to 13 stay open; agents work around them with reversible defaults.

1. **Go or no-go** on PL0 (repository setup, the ADRs and two spikes; no product code).
2. **Music:** follow the Spotify desktop app locally (A) with the manual clock (D) as fallback.
   Recommended. The alternative is the Web API (B) for the beta circle only.
3. **Client technology:** a web-technology shell on computers (Electron), with the phone page
   and the website in web technology too. Recommended. **The room's 3D scene:** Godot 4 is the
   leading candidate (the owner's leaning), web 3D the alternative; decided after spike 2 and
   before phase PL6.
4. **Backend stack: decided (2026-11-12).** Python, FastAPI and PostgreSQL, maintained by AI
   agents.
5. **Accounts:** the product's own accounts, with email link and passkey sign-in and no
   passwords. Recommended. Alternative: sign in with a classbeat account, which ties the two
   products together.
6. **Scope of the first version:** the instructor's display only (section 2), cycling first.
   Recommended. Phones joining a live class come next (phase PL8). Games, teams, a group
   display and a virtual world are ruled out (section 3).
7. **Visual direction:** "a light show, not a landscape" with a sideways score (section 3) as
   the starting point for the design work, or another idea of the owner's that keeps to the rules
   of section 3.
8. **Linux:** best effort in CI from the start, with the manual clock if following fails there.
   Recommended.
9. **Signing accounts:** an Apple Developer membership and a Windows signing identity, in whose
   name, and whether to use the Microsoft Store and Mac App Store instead.
10. **Hosting:** the backend's domain, and whether it runs beside classbeat on the same server.
11. **Swedebeat:** the owner wants download-and-cache playback (2026-11-12). Open: whether to
    ask Swedebeat for an agreement and a source of the audio, or to get the audio through the
    user's MOWL account. classbeat's standing decision is that providers are not contacted;
    asking would be the first exception. Recommended: ask Swedebeat.
12. **Name and look:** the product's name, and whether it shares classbeat's design or gets its
    own.
13. **Repository and openness:** public or private, and the licence. Recommended: the class
    format under a permissive open licence, and the player as open source.
14. **The niche:** "the instructor's player" (section 3) as the thing this product is known for.

## 14. Not verified

- MOWL: its engine, prices, casting, how it holds its Spotify access, and the terms under which
  it plays Swedebeat mixes.
- Swedebeat: whether its own service can deliver a user's mix to anything but its app and MOWL. Its help centre could be read only as search excerpts.
- Spotify: no ruling on whether a workout timeline or a tempo-driven scene is "visual media" under
  III.6; whether the Web API sees an offline desktop app; current position accuracy of the Windows
  media session and of AppleScript with crossfade on (spike 1 measures both).
- Whether Sweden qualifies for Microsoft's signing service as an individual, and its price.
- 3D frame rate on studio-class integrated graphics and on phones (spike 2).
- Godot's web export on iPhone: its 4.2 documentation says it does not run there; later versions
  are said to have improved it, not confirmed.
- Whether any Godot Bluetooth plugin covers iPhone and Android.
- Bluefy on iPhone with bike and heart-rate sensors: not tested. It is a third party's app; if it
  stops working, iPhone sensors stop with it.
- Which Bluetooth services each studio bike and treadmill model really exposes.
- Bluetooth field layouts, engine licence terms and the legal notes in section 3 are from general
  knowledge, not from documents opened for this plan.
