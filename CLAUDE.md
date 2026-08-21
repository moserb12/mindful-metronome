# Mindful Metronome — Claude Code Project Guide

This file is read automatically by Claude Code at the start of every session
in this repo. Keep it up to date as decisions get made.

## Status update — tempo weight on the rod + background-tab resilience

Two more from the same conversation as the smoothness/eye-tracking fixes
above (read that section first — it also covers a re-verification of
audio-pan-vs-visual agreement done in this same follow-up, using real
`StereoPannerNode` instrumentation rather than DOM inspection, which came
back 100% correct on the pushed code; the builder's screenshot showing a
mismatch most likely reflects a build from before that fix, not a
still-open bug — check you've pulled latest and restarted your dev server
if you still see it).

**Tempo weight on the pendulum** (`TempoWeight` in `MetronomeVisual.tsx`):
the builder's idea — "put the BPM slider on the metronome" — became a
literal reproduction of how a real mechanical metronome sets tempo: a
draggable weight that slides along the rod, closer to the pivot for a
faster tempo (shorter effective pendulum), closer to the tip for slower.
It's rendered as a child of the arm's own rotating `<g>`, so it swings
with the pendulum for free — SVG nested transforms compose, no extra
per-frame code needed. Drag math deliberately ignores the rod's live
rotation angle and just reads vertical pointer movement (up = faster, down
= slower) rather than projecting onto the constantly-swinging axis, which
would fight the animation instead of feeling natural. A small always-
upright label below the visual (`.tempo-weight-hint`) shows the live BPM
number, since text rotating with the rod would go illegible at extreme
angles. The existing BPM slider in `ControlPanel` was kept alongside it —
both just call the same `setBpm`, so there's no state to keep in sync, and
the numeric slider is still there for anyone who wants precision over
theming. Verified via direct `PointerEvent` dispatch (not coordinate-based
mouse simulation, which kept missing the small ~20×13px target on a second
consecutive drag in testing — a Playwright quirk, not an app bug): three
consecutive drags landed at exactly the BPM math predicted.

**Keeps playing when the tab loses focus:** `BeatScheduler`'s lookahead
for THIS app's audio scheduler was widened from `timing.ts`'s 0.1s
audio-only default to a new `BACKGROUND_SAFE_LOOKAHEAD_SEC = 3` (see
`start()` in `useMetronomeEngine.ts`). The risk: BeatScheduler only
refills its tick queue when its `setInterval` callback fires, and browsers
throttle `setInterval` in hidden tabs (commonly clamped to a 1s minimum
per spec). Already-scheduled ticks keep sounding regardless of any JS
throttling — they're baked into the audio graph as exact `AudioContext`
times the moment they're scheduled — but with only a 0.1s lookahead the
queue would run dry within ~100ms of the tab losing focus. 3 seconds of
lookahead comfortably outlasts typical background throttling. The
continuous drone was never at risk — its oscillators start once and run
continuously regardless of any JS timer. One accepted, deliberate
trade-off: the drone's L/R balance modulation (`updateDroneBalance`,
driven by the visual's `requestAnimationFrame` loop) pauses while hidden,
since `requestAnimationFrame` itself doesn't fire in background tabs by
any browser's design — audio keeps playing, the balance just freezes at
its last value and resumes smoothly (no drift, since it's recomputed from
elapsed time) the instant the tab is foregrounded again.

## Status update — pendulum smoothness + eye-tracking inversion, real bugs fixed

The builder reported the pendulum wasn't swinging smoothly and the eye
tracking looked inverted. Both were real, and both are fixed — this is not
a cosmetic tweak, it's a correction to a genuine design flaw in the first
version.

**Smoothness — root cause, confirmed by direct measurement (Playwright
sampling the live DOM every ~40-50ms):** the swing's from/to boundaries
used to get re-pointed only when `BeatScheduler` SCHEDULED a beat, which
fires just ~100ms before that beat sounds. But a swing segment actually
STARTS a full beat interval earlier, at the PREVIOUS beat's arrival — so
the arm sat completely frozen at each extreme for most of a beat (up to
~800ms at 64 BPM), then had to render already ~90% through its eased curve
the instant the next segment showed up. Measured: max frame-to-frame angle
delta was 61.7°, i.e. a visible snap, not a swing.

**Fix:** `SwingState` (`useMetronomeEngine.ts`) no longer stores explicit
from/to boundaries at all. It stores ONE fixed reference point — a beat's
time + side + the tempo in effect from it — and a new pure function,
`computeSwingSegment(nowSec, ref)`, derives which segment "now" falls into
and how far through it by elapsed-time arithmetic, called fresh every
animation frame. This has zero dependency on scheduler notification
timing. `setBpm()` re-anchors the reference at the moment of a mid-play
tempo change (continuing from wherever the arm currently is, at the new
pace) so a live BPM drag can't retroactively distort segments computed
before it. `computeSwingSegment` is pure and unit-tested directly
(`useMetronomeEngine.test.ts`) — no scheduler, no timers, no DOM. Measured
after the fix: max frame-to-frame delta ~5.4°, smooth.

**Eye inversion — root cause:** both the arm's rotation and the pupil's
offset were driven through CSS (`style.transform`), and CSS
`transform`/`transform-origin`/`transform-box` on SVG elements is a
genuinely inconsistent corner of the platform across browsers (units,
default transform-box, and compositing all vary). Fixed by switching both
to NATIVE SVG attributes instead — `element.setAttribute('transform',
'rotate(deg, cx, cy)')` for the arm, and setting the pupil's `cx`/`cy`
attributes directly rather than a CSS `translate()`. Both have been
unambiguous, plain-SVG-user-unit operations since SVG 1.1, so there's
nothing left for a browser to interpret differently. Verified: pupil
offset direction now agrees with the arm's swing direction on 100% of
sampled frames (was previously unverified/assumed correct from a single
screenshot, which is exactly how this kind of bug slips through — always
sample many frames programmatically, not one screenshot, when verifying
anything animated).

Also fielded, same conversation: "is there bloat from splitting off Brain
Bridging Beats, should we start over?" — checked directly: 1,642 lines
across the whole `src/` tree, 3 runtime dependencies (react, react-dom, one
font package), 53KB gzipped JS. Confirmed nothing beyond `timing.ts` and
`ErrorBoundary.tsx` was ever ported from Brain Bridging Beats (see the
Origin story section below) — no curriculum, no storage, no input
adapters, no leftover component tree. There is no bloat to clean up by
starting over; a rewrite would only re-derive the same ~150 lines of
scheduling math and lose the tests already covering it.

## Status update — acoustic interference waveform (oscilloscope/spectrum) panel

Added `src/components/Metronome/AcousticVisualizer.tsx`, a literal
technical reading of the combined signal (drone + tick + noise, everything
hitting the output at once), toggleable between a raw oscilloscope line and
a frequency spectrum bar chart. Adapted from a second Gemini-built
prototype the builder supplied (`binaural_beats_bpm_lab_v2.html`) —
specifically called out as the piece she wanted kept: "I really like the
acoustic interference waveform oscilloscope and spectrum visualizers."

Deliberately kept SEPARATE from the smoothed "chill" waveform ring drawn
around the eye in `MetronomeVisual` — that ring is ambient decoration built
into the instrument itself (heavily exponentially-smoothed on purpose, see
its own comment); this new panel is the opposite on purpose: unsmoothed,
literal, useful for actually seeing the two carrier tones' interference
pattern. Both read from the exact same `BinauralEngine.analyser` node —
no engine changes were needed, just a second consumer of the existing
analyser.

Rendered as its own card between the transport controls and
`ControlPanel`, colored by the current band (`bandColor` prop, not a fixed
palette — same "color follows the band, not the brand" rule as everywhere
else in this app). Shows "Audio engine inactive" when paused, exactly
matching the source prototype's nice touch, and only runs its own
animation-frame loop while playing — same performance discipline as the
rest of the visual layer.

## Status update — eye tracking + pendulum-synced drone panning + tick ear modes

A follow-up session, right after the initial build, added three related
features the builder asked for by watching the first version:

- **The eye watches the pendulum.** `MetronomeVisual`'s pupil (`pupilRef`)
  is offset every animation frame toward the arm's CURRENT tip position
  (computed from the same angle, wiggle included, that rotates the arm),
  normalized and clamped to `PUPIL_MAX_OFFSET`. Since the tip is always
  below the eye, the eye always looks at least somewhat downward, more
  left/right as the pendulum swings further — written straight to
  `pupilRef.current.style.transform`, same non-React-state approach as the
  arm itself.
- **The drone's L/R balance now continuously tracks the pendulum's
  position**, not just fixed hard-left/hard-right. `BinauralEngine` split
  its single `droneGain` into `droneGainLeft`/`droneGainRight` — the two
  oscillators STAY permanently hard-panned to their own ear (that fixed
  separation is what makes the binaural beat perceivable at all); what
  changes is each channel's OWN gain, continuously re-balanced by
  `updateDroneBalance(panValue)`. The two channels always sum to
  `droneVolume` — total loudness never pumps, only the balance moves.
  `panModulationDepth` (0-1, default 0.6, a control in `ControlPanel`)
  sets how extreme the swing gets: 0 = always 50/50 (modulation off), 1 =
  full 100/0 <-> 0/100, 0.6 lands on exactly the 80/20 <-> 20/80 example
  the builder gave. `MetronomeVisual` calls `onSwingUpdate(panValue)` every
  frame from the SAME swing interpolation that rotates the arm, so the
  audio balance and the visual position can never drift apart.
- **Tick ear mode** (`TickEarMode`: `MATCH` / `OPPOSITE` / `BOTH`, a
  segmented control in `ControlPanel`) controls which ear the percussive
  tick fires into relative to the drone's current balance: MATCH (default)
  fires in the ear the pendulum just arrived at (the drone's
  currently-louder ear); OPPOSITE fires in the drone's currently-quieter
  ear instead, for a call-and-response feel; BOTH fires centered in both
  ears regardless of position. Resolved inside `BinauralEngine.
  resolveTickPan()` from the same `matchSide` the scheduler already computes
  — no new state needed, just a different pan value for the same tick.

Verified: `tsc` clean, tests still passing, and a live Playwright pass
confirmed the pupil transform changes every frame and correlates with the
arm's swing direction, the pan-modulation slider's live "X/Y at the
extremes" preview updates correctly (20/80 at the default 0.6 depth, 0/100
at depth 1), and all three tick-ear buttons are clickable/highlight
correctly — zero console errors.

## Origin story — spun out of Brain Bridging Beats

This repo is a deliberate fork/reboot, not a from-scratch idea. The
builder's original app, **Brain Bridging Beats** (repo
`moserb12/Brain-Balance-Beats`), is a hand/foot rhythm-timing trainer built
around Interactive-Metronome-style clinical curriculum, aimed at
occupational therapists and Brain Balance coaches as a sellable/licensable
B2B product. After showing it to her boss, the builder decided to split her
roadmap in two:

- **Brain Bridging Beats** stays the clinical, sellable/white-label product
  for centers — that repo does not change because of this one.
- **Mindful Metronome** (this repo) is the free, public-facing sibling: "I
  can basically be my own competitor to Brain Balance, charging people for
  help [t-shirt: licensing], while giving this one away for free." Domain
  **mindfulmetronome.com** is already purchased. Positioning: a binaural-
  beat, bilateral-stimulation rhythm tool for flow states, for anyone —
  not gated behind a clinic relationship, "pay what you want / free to use."

**What was ported vs. rebuilt from scratch**, so a future session doesn't
have to guess:

- `src/engine/timing.ts` (`BeatScheduler`, `TimeDomainSync`) — ported
  nearly verbatim from Brain Bridging Beats. This is genuinely
  product-agnostic: a lookahead scheduler that turns a BPM into precisely
  timed `AudioContext` beats, with zero opinion about what plays on each
  one. `findNearestBeatTimeSec` (used there for tap-scoring) was dropped —
  nothing here scores a tap.
- `src/components/shared/ErrorBoundary.tsx` — same pattern (a crash must
  never blank the whole page), copy adjusted for this app's tone/copy.
- Everything else in `src/` is genuinely new: the audio engine, the visual,
  the whole design system. This is NOT a re-skin.

**Explicitly NOT ported (yet):** the 18-level curriculum, the session
engine's tap-scoring/classification logic, profiles, stars, games, input
adapters (keyboard/gamepad/WebHID/WebMIDI/audio-jack), storage/backup. Per
the builder's brief, that whole system becomes a secondary **"Practice with
Bilateral Stimulation"** section here — collapsible, start/stop independent
of the main metronome, NOT the first thing a visitor sees. `App.tsx`
currently has a collapsible placeholder section for this
(`.practice-section`) with a "being built next" note — porting the real
engine/curriculum/profile code into it is the next big chunk of work, not
done in the first pass that created this repo. When that happens, port the
pure-logic files (`engine/`, `data/curriculum.ts`, `types/`, `storage/`,
`input/`) from Brain Bridging Beats the same way `timing.ts` was — copy,
then strip brand-specific naming, then re-test.

## What "Mindful Metronome" IS, concretely

Two audio layers, one visual instrument:

- **Drone** — a continuous binaural pair, one pure sine tone in each ear,
  offset by a "beat" (binaural difference) frequency. The brain never
  literally hears that difference tone — it's synthesized in the auditory
  brainstem from two steady real pitches, panned hard left/right. This is
  the ambient "flow state" layer, controlled by `carrierHz` (pitch) and
  `beatHz` (which also determines the brainwave band label — Delta/Theta/
  Alpha/Beta/Gamma, see `src/data/bands.ts`).
- **Tick** — the literal metronome: short percussive ticks scheduled by
  `BeatScheduler` at a BPM, ALTERNATING ears with each tick (even beat
  index = left, odd = right). This is what makes it a "dual-tone tick like
  a binaural metronome," per the builder's exact framing, distinct from the
  continuous drone.

Both layers, plus a very quiet pink-noise "shield," are independent
`GainNode`s — same principle Brain Bridging Beats uses for its audio
channels: a listener should be able to silence any one layer without
touching the others. See `src/audio/binauralEngine.ts`.

**The visual (`src/components/Metronome/MetronomeVisual.tsx`) IS the
instrument, not decoration around it** — this was a specific, deliberate
read of the builder's brief ("greeted with a beautiful 'quantum' metronome
with an eyeball in a pyramid shaped brain... neurons firing"). One SVG:

- A pyramid outline. Its two base corners are the two "hemispheres" —
  literally where the metronome's tip swings between, alternating the
  audio tick's ear to match.
- An eye at the pyramid's center, its pupil/iris colored by the current
  brainwave band. The pendulum arm hangs from a pivot near the apex, above
  the eye, and swings smoothly between the two base corners over each beat
  interval.
- Two "neuron clusters," one per hemisphere side, connected to the eye by
  thin lines — each cluster pulses (a keyed CSS remount, see
  `NeuronCluster`) the instant that side's tick sounds, not before.
- A soft, heavily-smoothed circular waveform ring drawn on a `<canvas>`
  from the engine's `AnalyserNode`, colored by the current band — "chilled
  out," per the brief, meaning exponentially smoothed sample-to-sample so
  it breathes rather than jitters like a raw oscilloscope.
- A short decaying "wiggle" (a few degrees of extra rotation, exponentially
  damped) layered onto the arm the instant each tick sounds — the visual
  answer to "when the tone sounds I want the stick of the metronome to
  wiggle."

**Sync is achieved entirely by reading live `AudioContext` time inside one
requestAnimationFrame loop and writing directly to the arm's `style.transform`
and the canvas** — never CSS animation-duration guesses, never React state
driving 60fps updates (that would re-render on every frame, expensive on
weaker hardware). `swingRef` — a plain ref, not React state — is written
once per SCHEDULED beat (via `BeatScheduler`'s callback) and read every
animation frame. React state (`lastTickSide`/`tickCount`) only flips once
per beat, and is deliberately delayed via `setTimeout` to the moment the
tick actually SOUNDS (not when it was merely scheduled ~100ms early) — see
the long comment in `useMetronomeEngine.ts` for why these two update rates
are kept strictly separate. This mirrors a hard lesson from Brain Bridging
Beats: beat-driven visuals must derive their timing from the real BPM/audio
clock, never a fixed CSS duration guessed at build time.

**Presets and custom controls both come from the same
`src/data/bands.ts`** — five presets (one per band), each a
carrier/beat/BPM triple, plus free sliders for carrier Hz, beat Hz, BPM,
tick sound, and three independent volume faders (drone/tick/noise). Ported
and adapted from a Gemini-built HTML/Tailwind prototype the builder
supplied (`binaural_beats_bpm_lab.html`) — that file's Web Audio approach
(dual oscillators, `StereoPannerNode`, pink-noise buffer synthesis, preset
carrier/beat pairs) is where the numbers and audio techniques came from;
the actual code here is a clean rewrite in TypeScript against this
project's engine conventions, not a copy-paste port.

## Visual system — deliberately NOT Brain Bridging Beats' palette

Dark, minimalist, "quantum" — near-black background with soft nebula glows,
Space Grotesk type, and a UI palette that carries almost no fixed brand
color at all. The ONE place color appears with real meaning is
`--band-color`/`--band-glow`, set inline by whichever component is
currently deriving the active brainwave band — so the whole page's accent
color shifts live as a listener drags the beat-frequency slider or taps a
preset. This is the opposite design decision from Brain Bridging Beats'
warm "caring father" palette on purpose: two different products, two
different audiences, two different feelings to land on.

## Performance

Same principle as Brain Bridging Beats: this has to run on weak/old
hardware, not just a modern laptop. The 60fps sync loop only runs while
`isPlaying` is true (paused/idle costs nothing), and it writes directly to
the DOM/canvas rather than through React state for exactly that reason.
Revisit this note before adding anything else that runs every frame.

## Working conventions

Same as Brain Bridging Beats (see that repo's CLAUDE.md if this one is ever
short on detail): prefer fewer, complete changes per session; commit
generously; write/keep tests for anything that isn't purely visual (the
scheduler math in particular); flag anywhere a decision was guessed rather
than confirmed with the builder.

## Open / next work

- **Practice with Bilateral Stimulation** section — port the real
  curriculum/session-engine/profile system from Brain Bridging Beats in,
  wired as the secondary collapsible feature `App.tsx` already stubs out.
- No backend/storage yet at all — the practice section will need its own
  local storage (IndexedDB, same pattern as Brain Bridging Beats) once it's
  real; the metronome itself is stateless and needs none.
- No deployment yet. Vercel project + `mindfulmetronome.com` domain still
  need to be connected — a manual, one-time dashboard step for the builder,
  not something Claude Code can do from here.
- No favicon/OG-image beyond the simple pyramid-eye SVG favicon.
- The five presets' BPM values are a first pass, not confirmed against any
  real source — reasonable guesses matched to each band's energy, flagged
  here as exactly that.
