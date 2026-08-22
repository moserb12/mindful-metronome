// ============================================================================
// Pure motion math for the pendulum visual — pendulumEase (a more
// "physical" swing curve, blending sine with a snappier cubic based on
// tempo/mood), waveOffset (the snake-wave resonance along the rod), and
// buildSmoothPath (turns sampled points into a smooth SVG path string).
// Lives alongside engine/timing.ts as this app's other home for pure,
// unit-tested math with zero DOM/React/audio dependencies — driven by
// MetronomeVisual.tsx's rAF loop, never called from React state.
// ============================================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Blends the app's original ease-in-out-sine curve (soft, lingers at the
 * extremes — how a real pendulum's angular velocity actually behaves for
 * a LONG, slow swing) with a snappier cubic-in-out curve (less dwell time
 * at the extremes — closer to a SHORT, light pendulum) based on
 * `hangWeight` (0 = fully snappy/cubic, 1 = fully soft/sine).
 *
 * `t` must already be the correct 0..1 position within a segment whose
 * boundaries (`fromTimeSec`/`toTimeSec`) come from computeSwingSegment —
 * this function only reshapes the CURVE inside an already-correct time
 * window. It has no way to affect *when* a beat lands, only how the
 * rendered angle interpolates between two beats that already landed
 * exactly on the real audio clock.
 */
export function pendulumEase(t: number, hangWeight: number): number {
  const sine = -(Math.cos(Math.PI * t) - 1) / 2;
  const snappy = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return sine * hangWeight + snappy * (1 - hangWeight);
}

/**
 * The snake-wave resonance offset for a point at distance `s` along the
 * rod's LOCAL (unrotated) length, out of `armLength` total. `envelope` is
 * 0 exactly at `s=0` (the pivot) and `s=armLength` (the tip) — this is
 * what keeps the wave from disturbing the pivot dot's position or the
 * tip-position math the pupil-tracking and arm-tip-circle rendering
 * already assume (both treat the tip as exactly `armLength` from the
 * pivot along a straight line; since the wave contributes zero offset
 * there, that assumption stays exactly true even with a wavy rod).
 */
export function waveOffset(
  s: number,
  armLength: number,
  phase: number,
  amplitude: number,
  wavesAlongRod = 2.5
): number {
  const k = (2 * Math.PI * wavesAlongRod) / armLength;
  const envelope = Math.sin((Math.PI * s) / armLength);
  return amplitude * envelope * Math.sin(k * s - phase);
}

/** Builds a smooth SVG path `d` string through `points` via a quadratic-
 * Bezier-through-midpoints chain — visually smoother than a raw polyline
 * for a small number of samples, cheap enough to rebuild every rAF frame. */
export function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y}, ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
