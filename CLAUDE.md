# Mindful Metronome — Claude Code Project Guide

This file is read automatically by Claude Code at the start of every session
in this repo. Keep it up to date as decisions get made.

## Status update — fixed a real latency bug: Sound effect / Beat pattern took up to 3s to change

The builder reported a "pretty long delay" after changing the tick sound
or Beat pattern while playing. Root cause: `BeatScheduler`
(`src/engine/timing.ts`) commits real Web Audio oscillators (via
`handleBeatScheduled` in `useMetronomeEngine.ts`) up to `lookaheadSec`
ahead of when they actually sound — once committed, an oscillator's
`tickSound`/`tickSubdivision` is baked in and can't be changed
retroactively. `start()` was hardcoding a 3-second lookahead
(`BACKGROUND_SAFE_LOOKAHEAD_SEC`) UNCONDITIONALLY, not just while the tab
was backgrounded (its actual, deliberate purpose — surviving hidden-tab
`setInterval` throttling) — so at any moment, up to 3 seconds of
already-committed ticks (several beats' worth, depending on tempo) had to
finish before a setting change became audible, every time, foreground or
not.

**Fix: the lookahead is now visibility-driven**, via a new
`BeatScheduler.setLookaheadSec()` (`timing.ts`) and a `visibilitychange`
listener added in `start()`/torn down in `stopPlaybackInternal()` and the
unmount cleanup:
- **Visible (the normal case):** `FOREGROUND_LOOKAHEAD_SEC = 0.2` —
  small, on purpose: this window IS the worst-case delay before a Sound
  effect/Beat pattern change is heard, so it needs to stay tiny. Verified
  live (instrumented `OscillatorNode.prototype.start`) that a sound
  change now reaches the audio graph in ~290ms, down from up to 3s.
- **Hidden:** swaps to `BACKGROUND_SAFE_LOOKAHEAD_SEC = 3` automatically,
  preserving the original background-safety guarantee exactly — a
  background tab isn't where anyone's actively tweaking these settings
  anyway, so the tradeoff only applies when it can't be felt.

Shrinking the lookahead mid-flight is safe: it only affects the NEXT
not-yet-scheduled beat (already-committed ones are unaffected either
way), confirmed by a new `timing.test.ts` case exercising widen-then-
narrow against a fake clock, alongside the existing scheduler tests.

## Status update — eye/mouth iteration + off-beat "&" tick

The builder tried the Focus Companion pass live and sent back an annotated
screenshot with six follow-ups. Two turned into real design decisions,
resolved via clarifying questions before implementing:

**1. The pupil goes back to tracking the pendulum/tick, always.** Making
the eye a session clock (§6 of the prior pass) had repurposed the pupil
into a sweeping clock hand whenever a session was active — the builder
wants it back to its original job unconditionally, session or no
session. The timed-session readout moved onto the IRIS instead (next
point) rather than the pupil.

**2. The iris is now a 60-minute fill ring**, not a clock hand.
`SessionState.durationSec` already equals `minutes * 60`, so
`elapsedSec / 3600` (clamped) is exactly the fill fraction with zero
special-casing: a 15-min session ends with the ring exactly 1/4 full, 30
min at half, 45 min at 3/4, 60 min fully round — literally "how much of
an hour you have," per the builder's own framing. Drawn via the standard
`stroke-dasharray`/`stroke-dashoffset` progress-ring technique, radius 28
(between the iris at 22 and the tick-mark ring at 23-37), rotated -90deg
so it sweeps from 12 o'clock. `CLOCK_HAND_RADIUS`/the old
`<line className="eye-clock-hand">` are gone entirely.
⚠️ Infinite duration needed no special case — picking it never creates a
`SessionState` at all, so the ring mechanic already doesn't run for it.

**A real race, found and fixed while restoring the pupil's job:**
Pause/Stop starts the settle-tail (a ~700ms JS/rAF decay of the arm back
to vertical, added in the prior pass) AND the mouse-tracking effect in
the same render. Mouse-tracking used to arm itself immediately — adding
`.tracking` (a CSS-transitioned class) to the pupil the instant it
mounted, before any actual pointer move — which smeared the settle-tail's
own precise per-frame `setAttribute` writes through an unwanted extra
CSS transition, and let a stray pointermove mid-settle straight-up
override it. Fixed with `settlingRef`: mouse-tracking now polls it via
`requestAnimationFrame` and waits for the settle-tail to actually finish
before taking control of the pupil — exactly as long as THIS settle
takes, not a guessed fixed delay.

**3. Idle-only blink** — a periodic (3-7s gap, ~260ms close), natural
close-and-open on the WHOLE eye group, distinct from the existing
tap-triggered `.eye-wink` (which stays scoped to just the outer ring and
only fires on a click). Scoped to `!isPlaying` per the builder's own
wording ("during idle"); skipped entirely under
`prefers-reduced-motion: reduce`.

**4. Pyramid mouth flourish** — the base edge (the pyramid's own bottom
line, between `BASE_LEFT`/`BASE_RIGHT`) occasionally, briefly reads as a
mouth (smile/sigh/smirk/consider), cross-faded in via opacity on an
8-20s interval, ~2s hold, then back to the plain neutral line — NOT true
path morphing, just an opacity swap between fixed `d` strings (matches
this file's existing `.eye-clock-*` fade convention). All four
expressions keep both endpoints fixed at the pyramid's real corners, only
the control point moves — SVG y grows downward, so a control point below
the baseline dips the curve's middle down (corners read "up" — a smile),
above it droops the corners (a sigh); an off-center control point biases
the peak toward one side for an asymmetric smirk or a subtler
"considering" waver. Runs whether playing or idle (unlike the blink —
the builder didn't scope this one to idle, framing it as ongoing
character).
⚠️ Splitting the base edge out of the pyramid's own closed path (so it
could be an independent, swappable element) meant the pyramid's tap
target — previously that same closed path, using the `pointer-events:
all`-on-a-closed-shape trick to make the WHOLE triangle interior
clickable, not just its stroke — needed to become its own separate,
invisible `.pyramid-hit-target` path underneath the now-open, base-edge-
less visible outline. Verified live that a click on the pyramid's
interior (not just its stroke lines) still triggers the ping.

**5. Pendulum drone panning merged into the Tick Ear control-group** — no
longer its own standalone box between Volume Mixer and Tick Ear; the
panning slider now lives directly above the Match/Opposite/Both buttons,
one visual unit, per the builder's sketch circling them together.

**6. NEW — tick subdivision, a genuine audio-scheduling feature, not a
relabel.** The builder wanted an optional SECOND tick at the pendulum's
CENTER-crossing (the "&" in "1 & 2 & 3 & 4 &"), independent of the
existing end-of-swing tick — confirmed over several rounds of
clarification once it became clear this wasn't just a UI tweak. New
`TickSubdivision` type (`binauralEngine.ts`): `'ENDS'` (default, today's
original single-tick behavior) / `'ENDS_AND_CENTER'` / `'CENTER'` (the
builder's "None" — the end-tick goes silent, only the "&" sounds).
Persisted exactly like `tickEarMode` (settingsStorage + full-snapshot
custom presets), deliberately NOT part of shareable links' "core tuning"
set, same tier as `tickEarMode`.

Confirmed, load-bearing decisions:
- `TickEarMode` (Match/Opposite/Both) keeps controlling ONLY the
  end-tick's ear placement, completely unchanged. The new center/"&"
  tick ALWAYS fires dead-center (pan 0), not configurable — ⚠️ this also
  clarified that `TickEarMode`'s existing `'BOTH'` option already WAS
  dead-center panning all along; nothing needed to change there, it was
  purely a naming/discoverability question the builder had, not a
  missing feature.
- The center tick is quieter than the main tick (`CENTER_TICK_GAIN_SCALE
  = 0.55`, `binauralEngine.ts`) — kept at that SAME scale in every mode,
  including `CENTER`-only, for one consistent subdivision-click
  character rather than "turned up to compensate" when it's the only
  sound playing.
- The haptic buzz and the arm's wiggle accent follow whichever tick(s)
  are actually AUDIBLE, not always the physical end-arrival. In `CENTER`
  mode the silent end-arrival gets NO accent at all — the
  center-crossing drives both the wiggle (`MetronomeVisual.tsx`, two
  independently-gated `wiggleFor()` calls sharing one decay shape) and
  the haptic/`lastTickSide`/`tickCount` state (`useMetronomeEngine.ts`'s
  `handleBeatScheduled`, now scheduling up to two delayed callbacks per
  beat via `endTickTimeoutRef`/`centerTickTimeoutRef`).
  ⚠️ Fixed a small pre-existing bug while rewriting this function: the
  old `wiggleTimeoutRef` was declared and `clearTimeout`'d in two places
  but never actually assigned anywhere — dead code from whenever the
  wiggle/haptic callback was last touched. The two new refs are both
  genuinely used now.
- UI label: "Beat pattern" — "On the beat" / "On the beat + off-beat" /
  "Off-beat only", its own control-group right after the merged Tick
  Ear/Panning group, before Haptics (WHEN ticks fire is a distinct
  concept from WHERE they're routed).

All new ambient motion (blink, mouth scheduling) respects
`prefers-reduced-motion: reduce`, verified live — as is the pupil's
restored tick-tracking during an active session, the ring's fill math,
the settle-tail/mouse-tracking race fix (confirmed a real pointer move
right after Pause correctly waits for the settle to finish first), and
the pyramid's full-interior tap target post-split. `npx tsc -b`,
`npx vitest run` (55 tests, unchanged — this pass is UI/scheduling
wiring, not new pure-function surface), and `npm run build` all clean.

## Status update — "Focus Companion" pass: mood, physics, session-clock eye

Following the delight pass below, the builder asked for the pyramid-eye
mascot to stop feeling like a fixed diagram and become a genuine "focus
companion" — personality per brainwave band, more physical pendulum
motion, a resonating rod, smooth ease in/out on play/pause, a friendly
rotating greeting, the eye itself as the session clock, duration chips
moved out of hiding, and the unbuilt bilateral-stimulation feature turned
into an honest "coming soon" banner. All of it is rendering/CSS layered on
top of the existing audio-visual-sync architecture — nothing here changes
WHEN a beat lands or WHEN a session phase transitions, only how an
already-correctly-timed moment is drawn.

**Per-band mood** (`src/data/moods.ts`, `MOOD_BY_BAND`) — delta=sleepy,
theta=chill, alpha=peaceful, beta=happy, gamma=energized. Each band sets a
breathing rate/scale (fed to the existing `eye-breathe`/`pyramid-breathe`
keyframes via new `--mood-breathe-dur`/`--mood-breathe-scale` CSS custom
properties on `.metronome-visual`), a pendulum "hang weight," a snake-wave
amplitude/speed multiplier, and a tick-arrival wiggle multiplier. **Alpha
is deliberately pinned to the exact pre-existing literal values** (it's
`DEFAULT_PRESET`), so the most common path renders pixel-identical to
before this pass — zero regression risk on the default preset.

**More physical pendulum + resonating rod** (`src/engine/motion.ts`, new,
unit-tested in `motion.test.ts`) — `pendulumEase(t, hangWeight)` blends the
old plain-sine curve with a cubic in/out snap, weighted by the band's mood
AND the live BPM each frame (dragging the tempo weight snappier feels
snappier regardless of band). `waveOffset()`/`buildSmoothPath()` drive a
traveling snake-wave along the rod, tied to BPM — the rod's `<line>` became
a `<path ref={armPathRef}>` sampled and rebuilt every rAF frame. The
envelope is exactly 0 at both the pivot and the tip, so nothing else (the
tip circle, the pupil-tracking math, the draggable tempo weight, which
rides the rod's straight center axis on purpose) needs to change to
accommodate it.

**Ease in/out on Play/Pause, visual-only.** Ramp-in (Play): amplitude
scales 0→1 over 1.75s (`RAMP_IN_SEC`), captured once per Play press so
dragging the tempo weight mid-play never re-triggers it. Settle-out
(Pause/Stop): a ~700ms JS/rAF cubic decay from wherever the arm actually
was back to vertical — a JS tail, not a CSS transition, because the arm's
rotation is deliberately set via the native SVG `transform` **attribute**,
not the CSS property (cross-browser SVG-transform ambiguity, solved once
already — see `angleToward()`'s doc comment). **The one rule that can never
be relaxed: `onSwingUpdate(panValue)` fires at full amplitude every frame,
completely unaffected by `rampIn`** — only the *rendered* angle and wave
amplitude are scaled. This preserves the prior session's manual-Pause/
Stop-is-audio-instant decision untouched; the ramp/settle are purely how
the arm is drawn, never when audio panning moves or when a manual stop
actually silences the drone.

**"What's the vibe?" greeting** (`src/data/greetings.ts`,
`VIBE_GREETINGS`) — 8 friendly phrases, one picked randomly per mount
(`ControlPanel.tsx`), replacing the plain "Presets" label above the band
picker (`aria-label="Presets"` keeps a stable label for assistive tech).

**The eye is now the session clock.** While a timed session is running,
the pupil leaves its normal swing/mouse-tracking job and becomes a
sweeping clock hand (`CLOCK_HAND_RADIUS = 30`, reaching into a ring of 12
tick marks between the iris and the outer eye), and the remaining time
renders as real SVG text at the eye's center (`formatCountdown`, extracted
to `src/format.ts` so `SessionTimer.tsx` and `MetronomeVisual.tsx` share
one implementation) — not `aria-live`, on purpose, since a per-second live
region would spam screen readers. Precedence is resolved by checking
`sessionRef.current !== null` **fresh every rAF frame**, not the polled
`sessionPhase` prop — a session can be armed/disarmed mid-play (picking a
duration while already playing) without `isPlaying` changing, and only a
ref (not a value closed over by the effect) is guaranteed fresh in that
case. The separate mouse-tracking effect is guarded on
`sessionPhase === 'ended'` too, not just `isPlaying`, so the completed
clock face (0:00, hand at 12) has the full multi-second "ended" grace
window to actually read as finished before mouse-tracking takes back over.
`useMetronomeEngine.ts` had exactly one line changed to support this:
`sessionRef` is now exposed from the hook's return object, same as
`swingRef` already was.

**Duration chips relocated + relabeled** (`SessionTimer.tsx`) — 15/30/45/
60/Infinite (was 10/20/30/Open-ended, hidden inside a collapsible
accordion). Now always visible, directly below the Play/Pause button,
unconditionally rendered in `App.tsx` — no more `practiceOpen` accordion
state. The old big numeric countdown that used to live here is gone
entirely; the eye is now the sole numeric readout.

**Bilateral stimulation → honest "coming soon" banner**
(`src/components/BilateralComingSoonBanner.tsx`, new) — the old
collapsible "🧠 Practice with Bilateral Stimulation" section (which just
housed the session timer, now moved) is replaced with one small
non-interactive line: a drifting SVG UFO, piloted by a miniature version
of the pyramid-eye mascot, next to "Bilateral stimulation function coming
soon." That 18-level hand/foot rhythm-timing program (the Brain Bridging
Beats sibling app's actual feature) isn't built here yet — this says so
honestly instead of a dead-end accordion.

All new ambient motion (mood breathing already inherited the existing
disable rules; UFO drift + light blink are new) respects
`prefers-reduced-motion: reduce`, verified live. `motion.test.ts` adds 15
pure-function tests (`pendulumEase`, `waveOffset`, `buildSmoothPath`) to
the existing suite — 55 tests total, all passing; `npx tsc -b` and
`npm run build` both clean.

## Status update — "delight" pass: persistence, timed sessions, PWA, and more

The builder asked what it would take to make the app "feel really truly
delightful to use." Two research passes surveyed the existing codebase for
real gaps (confirmed: zero persistence, zero keyboard handling, zero PWA
infra, zero haptics — everything reset on every reload), then the builder
picked nine features from a curated list and confirmed three product
decisions before implementation. All nine are built, individually verified
live in a real browser (not just unit-tested), and shipped in one pass.

**Confirmed decisions, load-bearing for the implementation below:**
- **Manual Pause/Stop always stays instant.** The graceful fade+chime+glow
  is reserved for a timed session ending *naturally* — never a deliberate
  stop. `stopPlaybackInternal()` (the actual teardown) and `stop()` (the
  public, manual version, which ALSO immediately resets session state to
  `'idle'`) are deliberately two different functions in
  `useMetronomeEngine.ts` so this distinction can't blur.
- **Shareable links carry only "core tuning"**: carrier Hz, beat Hz, BPM,
  noise type. A recipient's own volumes/tick sound/tick-ear mode are never
  overwritten by opening someone else's link.
- **Custom presets save a full snapshot** (every setting) — a preset is
  private to the browser that saved it, never shared via a link, so
  there's no reason to leave anything out.

**1. Persistence** (`src/storage/settingsStorage.ts`) — one localStorage
blob, validated FIELD BY FIELD on load so one corrupt/out-of-range value
never invalidates the whole saved config. `useMetronomeEngine.ts`'s
`resolveInitialSettings()` merges, PER FIELD, in this exact order:
hardcoded defaults < saved settings < URL query params (see §8) — computed
once via a lazy `useState` initializer, not on every render. Saves are
debounced 400ms (range inputs fire `onChange` continuously while dragged).

**2. Timed sessions + graceful fade-out + session-end moment** — the
largest piece, replacing `.practice-section`'s old "being built next"
placeholder with a real `SessionTimer.tsx` (duration chips: 10/20/30/
Open-ended + live countdown). Deliberately reuses the SAME single Begin/
Pause button rather than adding a second one — picking a duration just
arms what happens next time it's pressed (or, if already playing, re-arms
the countdown immediately from "now" — confirmed behavior for a mid-session
duration change, not preserved-elapsed-time-against-a-new-total).
- `computeSessionPhase(nowSec, sessionState)` in `useMetronomeEngine.ts` is
  a **pure function**, modeled directly on the existing `computeSwingSegment`
  ("derive current state from elapsed time against ONE fixed reference"),
  not a naive `setInterval` countdown that could drift or double-fire.
  Polled every 250ms; `active`/`fading`/`ended` transitions are each
  guarded by a "has this threshold already passed and we haven't fired
  yet" boolean, robust to poll timing rather than needing an exact instant.
- `BinauralEngine.beginSessionFadeOut()`/`playClosingChime()`
  (`binauralEngine.ts`) — the fade ramps `masterGain` directly via Web
  Audio automation, **never touching `params.masterVolume`** (the slider's
  source of truth), so the master fader is exactly where the user left it
  once a session ends. The chime is 3 oscillators (root/fifth/octave off
  the current carrierHz) routed to `analyser` — the SAME point drone/tick/
  noise feed into, upstream of `masterGain` — so it rides the same fade
  instead of sounding after everything else has gone quiet.
- ⚠️ **Found and fixed a real bug while building this**: `BinauralEngine.
  stop()` never reset `masterGain` before this pass. A session that faded
  it to ~0 and then stopped would leave the NEXT `start()` beginning
  SILENTLY — nothing else ever re-primed that GainNode. `stop()` now
  unconditionally resets it to `params.masterVolume`. Caught and confirmed
  via an instrumented live-browser test reading the actual
  `GainNode.gain.value` through a full session lifecycle (not just unit
  tests) — see the verification note below.
- Also added `cancelSessionFade()` for the edge case of re-arming a
  session (§ duration change) while a PREVIOUS session's fade-out ramp is
  still in flight — without it, stale automation could keep silently
  pulling volume toward zero underneath a session that now thinks it's
  freshly active.

**3. Keyboard shortcuts** (`hooks/useKeyboardShortcuts.ts`) — Space (play/
pause), ArrowUp/Down (±1 BPM), 1-5 (built-in band presets). Never fires
with a modifier key held, and never fires while a range slider/select/
text field has focus — verified live that a focused BPM slider's own
native arrow-key behavior isn't double-nudged by our own handler on top.

**4. Installable PWA** — `public/manifest.json` + hand-rolled
`public/sw.js` (no `vite-plugin-pwa`): cache-first for `/assets/*`
(Vite's hashed, content-addressed output — safe forever, any change gets
a new filename), network-first-with-cache-fallback for navigation (avoids
a stale-forever shell). Icons are generated, not hand-drawn or AI-
generated: `scripts/generate-icons.mjs` uses `@resvg/resvg-js` (a
**devDependency only**, never shipped in the runtime bundle — no system
SVG rasterizer like rsvg-convert/imagemagick exists in a typical dev
environment) to rasterize the SAME pyramid+eye glyph as `favicon.svg` into
192/512/maskable-512/apple-touch-icon-180, so the icon family can never
visually drift from the mascot. Verified live: manifest fetches and
parses, every icon URL resolves, the service worker reaches `active`,
`/assets/*` files get cached on real navigation, and — the real test — a
reload with the browser context set fully offline still renders the app
shell correctly from cache.

**5. Haptics** (`navigator.vibrate(15)` per tick) — fires from the exact
same delayed-to-real-sounding-time `setTimeout` callback that already
drives the wiggle/neuron-pulse visual, so it's guaranteed in sync with
those without inventing a second timing path. Feature-detected (`'vibrate'
in navigator`) both for firing and for whether the toggle UI renders at
all — desktop simply doesn't get a dead control. Defaults ON wherever
supported (opt-out, matching every other feedback channel in this app),
persisted per §1.

**6. Interactive visual flourishes** (`MetronomeVisual.tsx`) — three small,
purely additive taps: the pyramid outline pings (outward glow, layered on
top of its existing ambient breathing — same "one-shot on top of ambient
motion" idea as the tick "wiggle"), a neuron node's connecting line
highlights on hover/tap, the eye's outer ring does a quick squash-and-
return "wink." None touch the rAF loop or the pupil-driving effects
(different elements/properties entirely). ⚠️ **Found a real tappability
bug while verifying this live**: the pyramid `<path>` has `fill: none`, so
by default only the 1.5px STROKE LINE was actually clickable — a tap
anywhere in the visible triangle's interior silently missed. Fixed with
`pointer-events: all`. Caught only because live-browser verification used
`elementFromPoint()` to confirm what was ACTUALLY receiving the click,
not just that a class toggled in isolation.

**7. Shareable links** (`src/urlState.ts`) — `?c=&b=&t=&n=` query params,
decoded/validated per-field (a malformed or partial link degrades
gracefully, never throws), merged into initial state per the order in §1.
Once adopted, `history.replaceState()` cleans the address bar so the
config flows into the normal debounced-save path like any other change. A
new "Copy Link" button in `ControlPanel.tsx` always reads LIVE current
state via `paramsRef`, never a stale snapshot from render time.

**8. Custom saved presets** (`data/customPresets.ts`,
`storage/customPresetsStorage.ts`, `hooks/useCustomPresets.ts`) — own
storage key, separate from §1's settings blob (a growing collection, not
a scalar). `useMetronomeEngine.ts`'s `applyPreset()` was generalized from
its old 3-field (`carrierHz`/`beatHz`/`bpm`) form into accepting the full
`ApplyablePresetFields` superset, applying whichever fields are present —
one shared code path for both the 5 built-in band presets and custom ones.

**Verification discipline for this whole pass**: every feature was
confirmed in a real Playwright-driven browser, not just via unit tests —
including two live-browser bugs (the `stop()` masterGain reset, the
pyramid's hit-testing) that unit tests alone would never have caught,
since both are about the REAL rendered/audio DOM state, not pure function
logic. For the timed-session feature specifically, `SESSION_FADE_DURATION_
SEC` and a test-only short duration chip were TEMPORARILY shrunk to verify
the full fade→chime→end→bloom→reset-to-idle lifecycle in real time (an
instrumented `GainNode.gain.value` read confirmed the actual Web Audio
automation, not just CSS class changes), then reverted — confirmed via a
byte-identical rebuild hash before committing.

## Status update — master volume + selectable noise shields (pink/white/brown)

Two additions to the mixer, both in `ControlPanel.tsx` / `binauralEngine.ts`:

- **Master volume.** A single `masterGain` GainNode sits AFTER `analyser`
  and before `context.destination` — downstream of every existing
  per-channel gain (drone/tick/noise), not a replacement for them. Turning
  master down (even to 0) never touches the drone/tick/noise balance
  underneath; turning it back up restores exactly the mix that was there.
  The "Mix" control group was renamed **"Volume Mixer"** and now leads with
  a bold Master row above a divider, then the three existing channel rows.
- **Selectable noise-shield type — pink, white, or brown**
  (`NoiseType` in `binauralEngine.ts`). Previously only pink noise existed.
  `buildWhiteNoiseBuffer`/`buildBrownNoiseBuffer` were added alongside the
  existing pink generator, and their scaling constants were NOT eyeballed —
  each was tuned by comparing RMS/peak against pink's actual output (a
  quick Node script replicating the exact same math, no browser needed)
  until all three landed within ~1% of each other. This matters because
  otherwise switching shield type mid-session would jump in perceived
  loudness independent of the volume slider, which would read as a bug.
  `AudioBufferSourceNode.buffer` can only be assigned before `start()` —
  the spec throws if you reassign it on an already-started node — so
  `setNoiseType()` swaps the whole node (stop old, create+start new with
  the new buffer, same `noiseGain` routing) rather than mutating one in
  place, same pattern as a tick's one-shot oscillator.
  `src/data/noiseShields.ts` holds the user-facing side: a short
  description of each texture plus which brainwave bands and tempo range
  it pairs well with, shown as a chip row + dynamic caption underneath the
  Noise shield volume slider. The pairing logic is deliberately consistent
  with the noise itself: brighter/higher-energy shields (white) suit the
  more alert bands and brisker tempos (Beta/Gamma, 84-160 BPM); deeper/
  bassier shields (brown) suit the slower, more restful ones (Delta/Theta,
  30-56 BPM); pink sits in the middle and stays the default.

## Status update — the REAL eye/arm inversion bug (corrects the section below)

The builder reported, after the CSS→native-SVG-attribute fix documented
below shipped: "The eye is still looking the wrong way." That fix was real
but was not the actual bug — it fixed a genuine cross-browser CSS/SVG
transform inconsistency, but the pupil and arm had been agreeing with each
other on a WRONG angle the whole time, so the self-consistency check that
"verified" it (pupil offset direction agrees with arm swing direction on
100% of frames) passed for the wrong reason: both were computed from the
same buggy formula, so of course they agreed with each other.

**Real root cause, in `MetronomeVisual.tsx`'s `angleToward()`:** the
function computed `atan2(dx, dy)` to get the degrees to feed the arm's
`rotate(deg, cx, cy)` SVG transform. That's the wrong sign. SVG's
`rotate(a, cx, cy)` applies the real 2D rotation matrix `x' = cx + dx·cos(a)
− dy·sin(a)`, `y' = cy + dx·sin(a) + dy·cos(a)` relative to the pivot.
Solving that matrix for a target `(dx, dy)` starting from a straight-down
vector gives `atan2(-dx, dy)`, not `atan2(dx, dy)` — the original formula
silently rendered the arm mirrored (`LEFT_ANGLE` swung the tip to the
RIGHT corner) from the very first version of this component, and the
pupil's tip-position formula had the matching sign error, so it mirrored
right along with it.

**How this was verified, since "I did the math and it looks right" is
exactly how the original bug shipped:** three independent checks, not one.
(1) Hand-derived the rotation matrix and confirmed the old formula's
`LEFT_ANGLE`, run through that matrix, lands the tip at `BASE_RIGHT`'s
exact coordinates. (2) Built an isolated test SVG with no dependency on
this app's code and read the browser's own `getCTM()` (Current
Transformation Matrix) as ground truth — confirmed `rotate(+30.96, 200,
92)` lands at `BASE_LEFT`, `rotate(-30.96, ...)` at `BASE_RIGHT`, matching
the corrected formula. (3) Live in the running app: intercepted
`OscillatorNode.start(when)` and the `AudioContext` constructor to
correlate each tick's real scheduled AudioContext-time against the arm's
rendered angle at that same audio-clock instant (not wall-clock — the
scheduler's 3-second background-tab lookahead means pan gets assigned up
to 3 real seconds before a tick sounds, so an earlier wall-clock-based
version of this same test gave confusing, contradictory results before
that was caught). Result: the true geometric tip side agreed with the
actual `StereoPannerNode.pan` side on every event checked, sub-10ms
audio-clock lag. **Fix:** `angleToward()` now returns `atan2(-dx, dy)`,
and the pupil tip-position formula's `tipX` uses `PIVOT.x - ARM_LENGTH *
Math.sin(angleRad)` (was `+`) to match.

**The "match/opposite tick-ear is flipped" complaint, filed in the same
message, turned out to be a symptom of this exact bug, not a separate one.**
`resolveTickPan()` (`binauralEngine.ts`) and the drone-balance `panValue`
(`updateDroneBalance`) were never derived from `angleToward()` or the
rendered angle at all — both come straight from `segment.fromSide`/
`toSide`, plain `'left'`/`'right'` strings computed independently of the
visual. The audio was correct the entire time; the builder was judging
"does the tick match the side the pendulum LOOKS like it's on" against a
visual that was mirrored, so it looked flipped even though `MATCH` mode
was already doing exactly what `MATCH` should do (tick fires on the same
side the tip visually arrives at). **`resolveTickPan()` was NOT changed** —
doing so would have introduced a real bug now that the visual is fixed.
Confirmed by the same audio-clock-correlated test above: `MATCH` mode's
pan side agreed with the arm's now-correct true tip side on 4/4 checked
events.

## Status update — "quantum organic harmonic" visual pass

The builder asked for a full visual pass with a specific feel — "quantum
organic harmonic," clean modern design principles, subtle micro-animations
throughout so it feels alive and responsive — plus one concrete feature:
the eye tracking the mouse cursor when the pendulum isn't moving. All of
`src/index.css` was touched; nothing structural changed (no new
components, no new dependencies), so this is additive polish, not a
rewrite.

**A shared motion system, not ad hoc transitions.** New tokens in `:root`:
`--ease-harmonic` (a gentle overshoot/spring curve — `cubic-bezier(0.34,
1.56, 0.64, 1)` — for anything the user directly touches: buttons, chips,
the tempo weight) and `--ease-soft` (a plain organic ease-out for
ambient/idle motion that should never call attention to itself), plus a
`--dur-fast/base/slow` scale. Every transition/animation added in this
pass draws from these same few values so hovers, presses, and idle drifts
read as one consistent instrument rather than a pile of unrelated CSS —
that consistency IS the "clean modern design principles" part, more than
any individual effect.

**Ambient/idle motion (the "alive" part):**
- `body::before` — the nebula background gradients now drift almost
  imperceptibly (`nebula-drift`, 48s, translate + slight scale) instead of
  sitting static.
- `.eye-outer`/`.eye-iris` — a slow breathing scale (`eye-breathe`, 5.5s),
  the iris slightly out of phase with the outer ring (`animation-delay:
  -1.8s`) so it doesn't read as one mechanical unit.
- `.pyramid-outline` — a slow glow pulse (`pyramid-breathe`, 7s) using
  `--band-glow`, so even the outline itself feels like it's breathing with
  the current brainwave band.
- `.play-toggle.playing` — a slow heartbeat-style box-shadow pulse
  (`play-pulse`, 2.4s) using the band glow, only while actually playing —
  deliberately calm, not an alert.
- Panels (`.control-panel`, `.visualizer-panel`, `.metronome-visual`,
  `.hero-header`, `.stage-readout`) each rise/fade in on mount
  (`panel-rise`) with staggered `animation-delay`s (0s → 0.32s) for a
  cascading "the instrument comes to life" load sequence, not everything
  appearing at once.

**Interactive micro-transitions:** every chip/button (`preset-chip`,
`ear-mode-btn`, `visualizer-mode-toggle button`, `practice-toggle`) now
lifts slightly on hover and compresses on `:active`, using
`--ease-harmonic`. Range slider thumbs scale up on hover/active with a
matching glow boost. `select` elements pick up a hover border tint. A
global `:focus-visible` outline (band-colored) was added for keyboard
navigation — genuinely missing before this pass.

**Eye tracks the cursor when idle** (`MetronomeVisual.tsx`): a second,
separate `useEffect` from the swing-driven one, active only while
`!isPlaying`. Listens on `window` (not just while hovering the visual, so
it reads as "aware," not as a hover effect), converts the cursor's screen
position into the SVG's viewBox coordinate space via
`getBoundingClientRect()`, and offsets the pupil toward it — with a
`reach` falloff so a cursor very close to the eye doesn't cause jittery
extreme deflection. The two pupil-driving effects (this one, and the
swing-driven one added earlier) are mutually exclusive by construction —
exactly one is ever "live" depending on `isPlaying` — so they never fight
over the pupil's position. A `.eye-pupil.tracking` CSS class adds a
`transition: cx/cy` ONLY while idle-tracking; it's deliberately never
applied during play, where cx/cy already update every animation frame and
a CSS transition would just make the pupil perpetually lag behind the
beat instead of syncing crisply — see the swing-loop's own comment for why
that distinction matters.

**Shared theme scope, cleaned up:** `--band-color`/`--band-glow` are now
set once on `.metronome-stage` in `App.tsx` (previously only set locally
on `.metronome-visual`), so the play button, state badge, and both panels
can reference the current band's color without needing it threaded in as
a prop everywhere. `.state-badge`'s old one-off `--badge-color` local
variable was removed in favor of just using the shared `--band-color`.

**Reduced motion:** every animation added in this pass (nebula drift, eye
breathe, pyramid glow, play-pulse, panel-rise, the pupil-tracking
transition) is disabled under `prefers-reduced-motion: reduce` — same
policy this app already held for the neuron pulse.

Verified: `tsc` clean, 13/13 tests still passing, build succeeds (54KB
gzip JS, only +0.86KB CSS gzipped for the whole pass), and a live
Playwright pass confirmed the pupil moves toward the cursor in both
tested directions, `.tracking` correctly disengages the instant playback
starts, and the `.playing` pulse class applies — zero console errors.

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

⚠️ **The eye-inversion fix below was incomplete — see the status update at
the top of this file for the real root cause (a trig sign error in
`angleToward()`) and the fix that actually resolved it.** The smoothness
fix below is unaffected and still stands as documented.

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
