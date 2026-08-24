// ============================================================================
// Per-band "personality" — this is what turns the pyramid-eye from a fixed
// mechanical diagram into something with a mood: sleepy, chill, peaceful,
// happy, energized, mapped one-to-one onto the five brainwave bands (each
// band's existing `blurb` in data/bands.ts already points this direction —
// "Deep rest" reads sleepy, "Peak binding & insight" reads energized).
//
// Three different consumers read this table:
//   - breatheDurSec/breatheScale feed CSS custom properties (see
//     MetronomeVisual's inline style) — the ambient pyramid/eye "breathing"
//     idle animation already runs continuously via CSS keyframes, so
//     personality there is a pure CSS knob, no JS math needed per frame.
//   - easeHangTime/waveAmplitudeMul/waveSpeedMul/wiggleMul are read
//     directly in MetronomeVisual's rAF loop (src/engine/motion.ts's
//     pendulumEase/waveOffset) — CSS keyframes can't drive per-frame
//     audio-clock-synced math, so these stay in JS.
//   - maxFocusSec is read once (per band change) by the idle mouse-
//     tracking effect in MetronomeVisual.tsx, to size its "how long before
//     the eye gets bored and wanders on its own" timer.
//   - tapSpinTurns/tapSpinDurationSec/tapSpinEase feed the pyramid's own
//     tap flourish (a Y-axis spin) via CSS custom properties, the same
//     "personality as a pure CSS knob" pattern breatheDurSec/breatheScale
//     already use.
//
// Alpha is deliberately pinned to the app's ORIGINAL literal numbers
// (5.5s breathe duration, 1.035 scale, plain sine easing via
// easeHangTime=0.5, wiggleMul=1, wave at baseline 1x) — it's
// DEFAULT_PRESET, the most-traveled path, so "peaceful" renders
// pixel-identical to before this file existed. Zero regression risk there.
// ============================================================================

import type { BrainwaveBand } from './bands';

export interface MoodProfile {
  /** Pyramid/eye ambient "breathing" animation-duration, in seconds. */
  breatheDurSec: number;
  /** Peak scale in the eye-breathe keyframe's midpoint. */
  breatheScale: number;
  /** 0..1, blended with live BPM each frame — see pendulumEase() in
   * src/engine/motion.ts. Higher = softer, more "hang time" at the
   * swing's extremes (sleepy/heavy); lower = snappier, more linear
   * (energized/light). */
  easeHangTime: number;
  /** Multiplier on the snake-wave rod's amplitude. */
  waveAmplitudeMul: number;
  /** Multiplier on the snake-wave rod's phase-advance speed. */
  waveSpeedMul: number;
  /** Multiplier on the existing tick-arrival "wiggle" bounce. */
  wiggleMul: number;
  /** How many seconds of stillness (no pointer movement) the eye tolerates
   * before it "gets bored" and starts wandering on its own — see the
   * idle-tracking effect in MetronomeVisual.tsx. Only relevant while idle
   * (mouse-tracking mode); has no effect during playback, when the pupil
   * follows the beat instead. Follows the same personality curve as
   * everything else here: calmer/slower bands are more patient, energized
   * ones get restless fast. */
  maxFocusSec: number;
  /** Full Y-axis rotations the pyramid completes on tap. */
  tapSpinTurns: number;
  /** Duration of that spin, in seconds — also how long the tap-response
   * state stays "active" (see handlePyramidTap in MetronomeVisual.tsx),
   * so the CSS class clears exactly when the animation actually ends.
   * Includes a brief wind-up (the first ~14% of this duration pulls the
   * pyramid backward before the main spin releases forward — see the
   * pyramid-spin keyframes in index.css), so this number sizes both the
   * anticipation and the release, not just the release. Bumped up across
   * every band from the first pass, more so for the higher-turn-count
   * bands, per direct feedback that the multi-turn spins read as too
   * fast to feel like something with real weight winding up. */
  tapSpinDurationSec: number;
  /** Which of the app's two shared eases (:root's --ease-soft/
   * --ease-harmonic) the spin settles with — 'soft' for a plain
   * decelerate-to-stop (calmer bands), 'harmonic' for a slight springy
   * overshoot (energized bands) — same curve TempoWeight's own drag
   * response and every hover/press transition in this app already use. */
  tapSpinEase: 'soft' | 'harmonic';
}

export const MOOD_BY_BAND: Record<BrainwaveBand, MoodProfile> = {
  // sleepy: slow, heavy, big lazy undulation — most patient, and a single
  // slow lazy turn on tap, settling with a plain soft ease (no bounce).
  delta: {
    breatheDurSec: 9.5,
    breatheScale: 1.02,
    easeHangTime: 0.85,
    waveAmplitudeMul: 1.6,
    waveSpeedMul: 0.6,
    wiggleMul: 0.5,
    maxFocusSec: 26,
    tapSpinTurns: 1,
    tapSpinDurationSec: 1.45,
    tapSpinEase: 'soft',
  },
  // chill / dreamy — drifts off eventually; a slow-ish double turn.
  theta: {
    breatheDurSec: 8.0,
    breatheScale: 1.03,
    easeHangTime: 0.65,
    waveAmplitudeMul: 1.3,
    waveSpeedMul: 0.8,
    wiggleMul: 0.75,
    maxFocusSec: 20,
    tapSpinTurns: 2,
    tapSpinDurationSec: 1.5,
    tapSpinEase: 'soft',
  },
  // peaceful — today's exact baseline for every OTHER field; a clean,
  // pleasant double turn with a touch of springy settle is the natural
  // "default" spin character.
  alpha: {
    breatheDurSec: 7.0,
    breatheScale: 1.035,
    easeHangTime: 0.5,
    waveAmplitudeMul: 1.0,
    waveSpeedMul: 1.0,
    wiggleMul: 1.0,
    maxFocusSec: 15,
    tapSpinTurns: 2,
    tapSpinDurationSec: 1.25,
    tapSpinEase: 'harmonic',
  },
  // happy / upbeat — a little antsy; a snappier triple turn.
  beta: {
    breatheDurSec: 5.0,
    breatheScale: 1.05,
    easeHangTime: 0.3,
    waveAmplitudeMul: 0.85,
    waveSpeedMul: 1.3,
    wiggleMul: 1.3,
    maxFocusSec: 10,
    tapSpinTurns: 3,
    tapSpinDurationSec: 1.05,
    tapSpinEase: 'harmonic',
  },
  // energized — can't sit still, least patient; a fast four-turn flurry.
  gamma: {
    breatheDurSec: 3.5,
    breatheScale: 1.07,
    easeHangTime: 0.12,
    waveAmplitudeMul: 0.7,
    waveSpeedMul: 1.8,
    wiggleMul: 1.6,
    maxFocusSec: 6,
    tapSpinTurns: 4,
    tapSpinDurationSec: 0.95,
    tapSpinEase: 'harmonic',
  },
};
