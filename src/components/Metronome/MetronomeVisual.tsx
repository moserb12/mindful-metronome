import { useEffect, useRef, useState } from 'react';
import { BANDS, MAX_BPM, MIN_BPM, type BrainwaveBand } from '../../data/bands';
import { MOOD_BY_BAND } from '../../data/moods';
import { buildSmoothPath, clamp, pendulumEase, waveOffset } from '../../engine/motion';
import { formatCountdown } from '../../format';
import {
  computeSessionPhase,
  computeSwingSegment,
  type SessionState,
  type SessionPlaybackPhase,
  type SwingState,
} from '../../hooks/useMetronomeEngine';

/** BPM change per pixel dragged — tuned so the full rod's on-screen length
 * covers roughly the full BPM range in one drag. */
const DRAG_SENSITIVITY = 0.55;

/** How long, in real seconds, the swing takes to ease in from motionless
 * to full amplitude after Play is pressed — see the ramp-in comment in
 * the main rAF effect below. */
const RAMP_IN_SEC = 1.75;
/** How long, in real ms, the arm takes to settle back to vertical after
 * Pause/Stop — a JS/rAF decay, not a CSS transition (see the settle-tail
 * comment below for why). */
const SETTLE_MS = 700;
/** Base snake-wave amplitude in SVG units, before the band's mood
 * multiplier and the ramp-in/settle factor are applied. */
const BASE_WAVE_AMPLITUDE = 2.5;
/** How far the eye's clock hand reaches from center while a timed session
 * is active — deliberately BETWEEN the iris (r=22) and the tick-mark ring
 * (r=23-37, see CLOCK_TICKS below), so the hand visibly points INTO the
 * tick band rather than staying trapped inside the iris. Distinct from
 * PUPIL_MAX_OFFSET (10), which governs the much subtler swing/mouse-
 * tracking glance — the clock hand is a different, more deliberate motion
 * and reads better with real reach. */
const CLOCK_HAND_RADIUS = 30;

// ============================================================================
// MetronomeVisual — the "quantum metronome": an eye at the center of a
// pyramid, two neuron clusters (one per hemisphere), and a pendulum arm
// swinging between the pyramid's two base corners. This is not decoration
// around the instrument — it IS the instrument. The eye is the pivot the
// arm hangs from; each base corner is a "hemisphere"; a soft waveform ring
// breathes around the eye, color-coded by the current brainwave band.
//
// Sync strategy: the arm's rotation and the waveform ring are both written
// directly to DOM/canvas inside one requestAnimationFrame loop, reading
// live AudioContext time — never React state, never a CSS animation with a
// guessed duration. That's what keeps the visual PERFECTLY locked to the
// audio regardless of frame jank, exactly like Brain Bridging Beats' own
// beat-driven visuals. The loop only runs while playing, so an idle tab
// costs nothing.
//
// "Focus companion" pass: the pyramid/eye now carry a per-band MOOD
// (src/data/moods.ts — sleepy/chill/peaceful/happy/energized), the swing
// uses a more physically-weighted easing curve, the rod resonates with a
// traveling snake-wave tied to BPM, motion eases in on Play and settles
// out on Pause/Stop, and — while a timed session is running — the eye
// itself becomes a ticking clock face showing the remaining time. NONE of
// this changes WHEN a beat lands or what BinauralEngine hears: the ramp/
// mood/wave math only reshapes the RENDERED swing, never `panValue` (fed
// to onSwingUpdate at full amplitude, every frame, exactly as before).
// ============================================================================

const VIEW = 400;
const PIVOT = { x: 200, y: 92 };
const BASE_LEFT = { x: 62, y: 322 };
const BASE_RIGHT = { x: 338, y: 322 };
const EYE = { x: 200, y: 224 };

/**
 * Degrees to feed the arm's `rotate(deg, cx, cy)` SVG transform so that a
 * line initially pointing straight down from `from` ends up pointing at
 * `to`. This is NOT simply `atan2(dx, dy)` — that was the original,
 * WRONG version of this function, and it silently rendered the arm
 * mirrored (LEFT_ANGLE actually swung the tip to the RIGHT corner) from
 * the very first version of this component. `rotate(a, cx, cy)` applies
 * the real 2D rotation matrix x' = dx·cos(a) − dy·sin(a), y' =
 * dx·sin(a) + dy·cos(a) relative to the pivot; solving that for a target
 * (dx, dy) starting from a straight-down vector (0, r) gives
 * `atan2(-dx, dy)`, not `atan2(dx, dy)`. Verified by hand against the
 * real matrix (not just against this app's own other numbers, which is
 * how the mirrored version passed self-consistency checks for so long):
 * plugging the old formula's LEFT_ANGLE into the real rotation matrix
 * landed the tip at BASE_RIGHT's exact coordinates, and vice versa.
 */
function angleToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(-dx, dy) * 180) / Math.PI;
}

const LEFT_ANGLE = angleToward(PIVOT, BASE_LEFT);
const RIGHT_ANGLE = angleToward(PIVOT, BASE_RIGHT);
const ARM_LENGTH = Math.hypot(BASE_LEFT.x - PIVOT.x, BASE_LEFT.y - PIVOT.y);

/** A point at `radius` from EYE's center, `angleDeg` clockwise from 12
 * o'clock — the classic clock-face convention (0°=up, 90°=right), NOT the
 * `rotate()`-matrix convention `angleToward()` uses above. Deliberately
 * different, unrelated math for a deliberately different purpose (a
 * clock hand, not the pendulum's own rotation) — don't "reconcile" the
 * two sign conventions, they're solving different problems. */
function clockPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: EYE.x + radius * Math.sin(rad), y: EYE.y - radius * Math.cos(rad) };
}

/** 12 static clock-face tick marks, precomputed once at module load (same
 * pattern as LEFT_ANGLE/RIGHT_ANGLE) — a ring between the iris (r=22) and
 * the outer eye (r=38). Every 3rd mark (12/3/6/9) is longer/closer-in for
 * a classic clock read. Always present in the DOM; visibility is a CSS
 * opacity transition on the parent `.has-session` class, not a JSX
 * mount/unmount, so it fades rather than pops. */
const CLOCK_TICKS = Array.from({ length: 12 }, (_, i) => {
  const angleDeg = i * 30;
  const major = i % 3 === 0;
  const inner = clockPoint(angleDeg, major ? 23 : 25);
  const outer = clockPoint(angleDeg, major ? 37 : 35);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major };
});

interface NeuronClusterProps {
  side: 'left' | 'right';
  color: string;
  pulseToken: string;
}

/** A handful of small nodes along one side of the pyramid, connected to the
 * eye by thin lines. Re-keyed by `pulseToken` so it remounts (replaying its
 * CSS pulse animation) only when THIS side's tick just sounded.
 *
 * Hovering/tapping a node highlights its own connecting line (a small,
 * purely decorative flourish — "the instrument notices you're looking at
 * it") via per-node local state, entirely separate from the pulseToken/
 * tick-driven pulse above: different elements (the line's opacity/glow,
 * not the node circle's pulse animation), so the two never fight. */
function NeuronCluster({ side, color, pulseToken }: NeuronClusterProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const base = side === 'left' ? BASE_LEFT : BASE_RIGHT;
  const nodes = [0.28, 0.5, 0.7].map((t) => ({
    x: PIVOT.x + (base.x - PIVOT.x) * t + (side === 'left' ? -18 : 18) * t,
    y: PIVOT.y + (base.y - PIVOT.y) * t,
  }));

  return (
    <g key={pulseToken} className="neuron-cluster">
      {nodes.map((n, i) => (
        <g key={i}>
          <line
            x1={EYE.x}
            y1={EYE.y}
            x2={n.x}
            y2={n.y}
            stroke={color}
            strokeWidth={0.6}
            opacity={0.35}
            className={`neuron-connector ${hoveredIndex === i ? 'neuron-connector-active' : ''}`}
          />
          <circle
            className="neuron-node"
            cx={n.x}
            cy={n.y}
            r={3.2}
            fill={color}
            style={{ animationDelay: `${i * 70}ms` }}
            onPointerEnter={() => setHoveredIndex(i)}
            onPointerLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
          />
        </g>
      ))}
    </g>
  );
}

/** How far the pupil can drift from the iris's center while tracking the
 * pendulum or the cursor, in SVG units. Iris radius is 22, pupil radius 9
 * — this keeps the pupil comfortably inside the iris at full deflection.
 * NOT used for the session-clock hand mode — see CLOCK_HAND_RADIUS. */
const PUPIL_MAX_OFFSET = 10;

/** Where along the rod the weight can slide, in SVG units from the pivot.
 * Kept short of the pivot dot and the tip so it never visually collides
 * with either. */
const WEIGHT_MIN_OFFSET = 40;
const WEIGHT_MAX_OFFSET = ARM_LENGTH - 30;

interface TempoWeightProps {
  bpm: number;
  onSetBpm: (bpm: number) => void;
  color: string;
}

/**
 * A draggable weight on the pendulum rod, exactly like a real mechanical
 * metronome: slide it toward the pivot for a faster tempo, toward the tip
 * for slower — a shorter effective pendulum swings faster. Rendered as a
 * child of the arm's rotating <g>, so it swings with the pendulum for free
 * (SVG nested transforms compose) without any extra per-frame code.
 *
 * Deliberately positioned on the rod's STRAIGHT center axis, ignoring the
 * snake-wave offset applied to the rod's own rendering (see the rAF loop
 * below) — the weight is a rigid physical slider, not part of the thin
 * rod's own resonance, so it stays put regardless of how wavy the string
 * looks around it.
 *
 * Drag math deliberately ignores the rod's current rotation: it just reads
 * vertical pointer movement (up = faster, down = slower) rather than
 * projecting onto the rod's live angle. That's simpler and just as usable
 * — the rod is swinging while playing, so "grab the exact rotated axis"
 * would fight the animation instead of feeling natural.
 */
function TempoWeight({ bpm, onSetBpm, color }: TempoWeightProps) {
  const dragState = useRef<{ startClientY: number; startBpm: number } | null>(null);

  const t = (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
  const offset = WEIGHT_MAX_OFFSET - t * (WEIGHT_MAX_OFFSET - WEIGHT_MIN_OFFSET);
  const weightY = PIVOT.y + offset;

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    dragState.current = { startClientY: e.clientY, startBpm: bpm };

    function handleMove(ev: PointerEvent) {
      if (!dragState.current) return;
      const deltaY = dragState.current.startClientY - ev.clientY; // up = positive
      const nextBpm = Math.round(dragState.current.startBpm + deltaY * DRAG_SENSITIVITY);
      onSetBpm(Math.min(MAX_BPM, Math.max(MIN_BPM, nextBpm)));
    }
    function handleUp() {
      dragState.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  return (
    <g className="tempo-weight" onPointerDown={handlePointerDown} style={{ cursor: 'grab' }}>
      <rect x={PIVOT.x - 11} y={weightY - 7} width={22} height={14} rx={4} fill={color} className="tempo-weight-body" />
      <line x1={PIVOT.x - 11} y1={weightY} x2={PIVOT.x + 11} y2={weightY} className="tempo-weight-notch" />
    </g>
  );
}

interface MetronomeVisualProps {
  isPlaying: boolean;
  band: BrainwaveBand;
  swingRef: React.RefObject<SwingState | null>;
  getAudioTimeSec: () => number;
  getAnalyser: () => AnalyserNode | null;
  lastTickSide: 'left' | 'right' | null;
  tickCount: number;
  /** Called every animation frame with the pendulum's current position
   * (-1 full left .. 1 full right), so the drone's L/R balance can track
   * it continuously — see BinauralEngine.updateDroneBalance(). ALWAYS
   * full amplitude, even during the visual ramp-in/settle-out — see the
   * rAF loop below. */
  onSwingUpdate: (panValue: number) => void;
  bpm: number;
  onSetBpm: (bpm: number) => void;
  /** Raw session reference (or null when no timed session is armed) — read
   * DIRECTLY inside the rAF loop every frame via computeSessionPhase(),
   * exactly like `swingRef`, rather than relying on the 250ms-polled
   * `sessionPhase`/`sessionRemainingSec` React state. This sidesteps a
   * real staleness risk: `sessionRef.current` can flip from null to a
   * real session (or back) WHILE isPlaying stays true (e.g. picking a
   * duration mid-play), which would NOT re-run this effect since
   * `isPlaying` didn't change — a value captured only in the effect's own
   * closure would go stale in that case, but a ref's `.current` is always
   * fresh no matter when it's read. */
  sessionRef: React.RefObject<SessionState | null>;
  sessionPhase: SessionPlaybackPhase;
  sessionRemainingSec: number | null;
}

export function MetronomeVisual({
  isPlaying,
  band,
  swingRef,
  getAudioTimeSec,
  getAnalyser,
  lastTickSide,
  tickCount,
  onSwingUpdate,
  bpm,
  onSetBpm,
  sessionRef,
  sessionPhase,
  sessionRemainingSec,
}: MetronomeVisualProps) {
  const armRef = useRef<SVGGElement | null>(null);
  const armPathRef = useRef<SVGPathElement | null>(null);
  const pupilRef = useRef<SVGCircleElement | null>(null);
  const clockHandLineRef = useRef<SVGLineElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<number[] | null>(null);
  const rafRef = useRef<number | null>(null);
  /** The last RENDERED total angle (post-ramp, post-wiggle) — seeds the
   * settle-tail's decay-to-zero starting point when Pause/Stop is
   * pressed, so it always continues smoothly from wherever the arm
   * actually was, never a jump. */
  const lastAngleRef = useRef(0);
  /** The last rendered wave amplitude — seeds the settle-tail's wave
   * decay the same way. */
  const lastWaveAmplitudeRef = useRef(0);

  const bandInfo = BANDS[band];
  const mood = MOOD_BY_BAND[band];

  // Two small, purely decorative one-shot flourishes — tapping the pyramid
  // outline or the eye's outer ring plays a brief animation via a toggled
  // CSS class, timed out automatically. Neither touches the rAF loop above
  // or the pupil-driving effects below: different elements/properties
  // entirely (the pyramid's own filter, the eye-outer ring's own
  // transform — never cx/cy, which only the swing/mouse-tracking/session-
  // clock effects are allowed to touch), so there's nothing for them to
  // conflict with.
  const [pyramidPinging, setPyramidPinging] = useState(false);
  const pyramidPingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [eyeWinking, setEyeWinking] = useState(false);
  const eyeWinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handlePyramidTap() {
    if (pyramidPingTimeoutRef.current) clearTimeout(pyramidPingTimeoutRef.current);
    setPyramidPinging(true);
    pyramidPingTimeoutRef.current = setTimeout(() => setPyramidPinging(false), 600);
  }

  function handleEyeTap() {
    if (eyeWinkTimeoutRef.current) clearTimeout(eyeWinkTimeoutRef.current);
    setEyeWinking(true);
    eyeWinkTimeoutRef.current = setTimeout(() => setEyeWinking(false), 250);
  }

  useEffect(() => {
    return () => {
      if (pyramidPingTimeoutRef.current) clearTimeout(pyramidPingTimeoutRef.current);
      if (eyeWinkTimeoutRef.current) clearTimeout(eyeWinkTimeoutRef.current);
    };
  }, []);

  /** Builds the rod's wavy `d` attribute from sampled points along its
   * LOCAL (unrotated) length — amplitude 0 collapses this to exactly
   * today's straight line, so idle/resting and the settle-tail's final
   * frame both reuse this one function with no special-cased "flat"
   * branch. */
  function buildArmPathD(amplitude: number, phase: number): string {
    const SAMPLES = 16;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const s = (i / SAMPLES) * ARM_LENGTH;
      const offset = waveOffset(s, ARM_LENGTH, phase, amplitude);
      points.push({ x: PIVOT.x + offset, y: PIVOT.y + s });
    }
    return buildSmoothPath(points);
  }

  /** Derives the pendulum-tip position from a rendered rotation angle,
   * using the SAME sign convention the arm itself is rotated with (see
   * angleToward()'s doc comment) — shared by the main swing-tracking
   * branch and the settle-tail, so both apply the pupil offset from the
   * exact same tip math. */
  function setPupilFromAngle(totalAngleDeg: number) {
    if (!pupilRef.current) return;
    const angleRad = (totalAngleDeg * Math.PI) / 180;
    const tipX = PIVOT.x - ARM_LENGTH * Math.sin(angleRad);
    const tipY = PIVOT.y + ARM_LENGTH * Math.cos(angleRad);
    const dx = tipX - EYE.x;
    const dy = tipY - EYE.y;
    const dist = Math.hypot(dx, dy) || 1;
    const offsetX = (dx / dist) * PUPIL_MAX_OFFSET;
    const offsetY = (dy / dist) * PUPIL_MAX_OFFSET;
    pupilRef.current.setAttribute('cx', String(EYE.x + offsetX));
    pupilRef.current.setAttribute('cy', String(EYE.y + offsetY));
  }

  function snapToRest() {
    if (armRef.current) armRef.current.setAttribute('transform', `rotate(0 ${PIVOT.x} ${PIVOT.y})`);
    if (armPathRef.current) armPathRef.current.setAttribute('d', buildArmPathD(0, 0));
    if (pupilRef.current) {
      pupilRef.current.setAttribute('cx', String(EYE.x));
      pupilRef.current.setAttribute('cy', String(EYE.y));
    }
    lastAngleRef.current = 0;
    lastWaveAmplitudeRef.current = 0;
  }

  useEffect(() => {
    if (!isPlaying) {
      // Settle-out: ease the arm back to vertical over SETTLE_MS rather
      // than snapping instantly, seeded from wherever it actually was
      // (lastAngleRef). A JS/rAF decay, not a CSS transition — the arm's
      // rotation is deliberately set via the native SVG `transform`
      // ATTRIBUTE, not the CSS `transform` property (see angleToward()'s
      // doc comment on why), and CSS transitions can't animate an
      // attribute set imperatively like this without reintroducing the
      // exact cross-browser ambiguity that convention exists to avoid.
      //
      // This is purely a rendering-layer tail: onSwingUpdate(0) still
      // fires at the identical moment it always has (synchronously, right
      // here), so the manual-Pause/Stop-is-audio-instant invariant is
      // completely untouched by this — only the arm/pupil/wave's
      // RENDERED decay is new.
      onSwingUpdate(0);

      const startAngle = lastAngleRef.current;
      const startAmplitude = lastWaveAmplitudeRef.current;
      // A natural session end holds sessionPhase at 'ended' for a few
      // seconds so the eye's clock face reads as "complete" rather than
      // instantly reverting — captured once here (accurate for this
      // short-lived purpose: it won't flip back to 'idle' until well
      // after this settle tail finishes) so the pupil-decay step below
      // can skip touching the frozen clock-hand position during that
      // window. The arm/wave still settle regardless — different
      // elements, orthogonal to what the eye is showing.
      const skipPupilDecay = sessionPhase === 'ended';

      if (Math.abs(startAngle) < 0.01 && startAmplitude < 0.01) {
        snapToRest();
        return;
      }

      const startTime = performance.now(); // wall clock — the AudioContext may already be torn down by stop()
      function settleFrame() {
        const t = clamp((performance.now() - startTime) / SETTLE_MS, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const remaining = 1 - eased;
        const angle = startAngle * remaining;
        const amplitude = startAmplitude * remaining;

        if (armRef.current) armRef.current.setAttribute('transform', `rotate(${angle} ${PIVOT.x} ${PIVOT.y})`);
        if (armPathRef.current) armPathRef.current.setAttribute('d', buildArmPathD(amplitude, 0));
        if (!skipPupilDecay) setPupilFromAngle(angle);
        lastAngleRef.current = angle;
        lastWaveAmplitudeRef.current = amplitude;

        if (t < 1) {
          rafRef.current = requestAnimationFrame(settleFrame);
        } else {
          snapToRest();
        }
      }

      rafRef.current = requestAnimationFrame(settleFrame);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    // Ramp-in: captured ONCE per Play press (this effect only re-runs when
    // isPlaying/bandInfo.color/onSwingUpdate change — a mid-play setBpm()
    // does not re-run it, so dragging the tempo weight never re-triggers
    // a ramp).
    const rampStartSec = getAudioTimeSec();

    function frame() {
      const arm = armRef.current;
      const swing = swingRef.current;
      const now = getAudioTimeSec();

      const rampT = clamp((now - rampStartSec) / RAMP_IN_SEC, 0, 1);
      const rampIn = 1 - Math.pow(1 - rampT, 3);

      let angle = 0;
      let wiggle = 0;
      let panValue = 0;
      if (swing) {
        // computeSwingSegment derives which segment "now" falls into (and
        // how far through it) by pure elapsed-time arithmetic against a
        // fixed reference point — see the long comment on SwingState in
        // useMetronomeEngine.ts for why this replaced an earlier version
        // that re-pointed from/to boundaries only when a beat was
        // SCHEDULED. That approach left the arm frozen at each extreme for
        // most of a beat, then jumping to ~90% through its eased curve the
        // instant the next segment arrived — a visible freeze-then-snap
        // instead of a smooth swing. Deriving the segment from elapsed
        // time relative to a fixed reference removes the dependency on
        // scheduler notification timing entirely.
        const segment = computeSwingSegment(now, swing);
        const span = segment.toTimeSec - segment.fromTimeSec;
        const t = span > 0 ? Math.min(1, Math.max(0, (now - segment.fromTimeSec) / span)) : 1;

        // A more physically-weighted curve than plain sine, blended by the
        // band's mood AND the live tempo — see pendulumEase()'s doc
        // comment in engine/motion.ts. `eased` (the SHAPE) is shared by
        // BOTH the angle and panValue below, so the audio pan and the
        // rendered swing always agree on TIMING; only angle's FINAL
        // rendered value additionally gets `* rampIn` further down —
        // panValue never does.
        const tempoT = (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
        const hangWeight = clamp(mood.easeHangTime - 0.35 * tempoT, 0.05, 0.95);
        const eased = pendulumEase(t, hangWeight);

        const fromDeg = segment.fromSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
        const toDeg = segment.toSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
        angle = fromDeg + (toDeg - fromDeg) * eased;

        const fromPan = segment.fromSide === 'left' ? -1 : 1;
        const toPan = segment.toSide === 'left' ? -1 : 1;
        panValue = fromPan + (toPan - fromPan) * eased;

        // A short, decaying vibration layered on top the instant the tip
        // arrives at a side (when the tick actually sounds) — the
        // "wiggle" the tone triggers, distinct from the smooth swing.
        // Scaled by the band's mood (energized bands wiggle harder).
        const sinceArrival = now - segment.toTimeSec;
        if (sinceArrival >= 0 && sinceArrival < 0.35) {
          wiggle = Math.exp(-sinceArrival * 14) * Math.sin(sinceArrival * 60) * 4 * mood.wiggleMul;
        }
      }

      // Native SVG `transform` attribute, not a CSS transform — CSS
      // transform/transform-origin on SVG elements is an inconsistently
      // implemented corner of the platform across browsers (units, default
      // transform-box, and compositing behavior all vary). The SVG
      // attribute form (`rotate(deg, cx, cy)`) has been unambiguous since
      // SVG 1.1: it always operates in the element's own user-unit
      // coordinate system, so there's nothing left to disagree about.
      const totalAngle = (angle + wiggle) * rampIn;
      lastAngleRef.current = totalAngle;
      if (arm) arm.setAttribute('transform', `rotate(${totalAngle} ${PIVOT.x} ${PIVOT.y})`);
      onSwingUpdate(panValue); // full amplitude, always — never scaled by rampIn

      // Snake-wave resonance along the rod, tied to bpm and the band's
      // mood — phase derived from the absolute audio clock (not
      // accumulated per-frame), matching this file's anti-drift
      // philosophy everywhere else, so the ripple's speed stays locked to
      // real tempo regardless of frame jank.
      const wavePhase = now * 2 * Math.PI * (bpm / 60) * 1.5 * mood.waveSpeedMul;
      const waveAmplitude = BASE_WAVE_AMPLITUDE * mood.waveAmplitudeMul * rampIn;
      lastWaveAmplitudeRef.current = waveAmplitude;
      if (armPathRef.current) armPathRef.current.setAttribute('d', buildArmPathD(waveAmplitude, wavePhase));

      // Eye contents: a timed session (if armed) takes precedence over the
      // normal swing-tracking pupil. Read `sessionRef.current` directly
      // (fresh every frame, see the prop's doc comment above) rather than
      // the polled `sessionPhase` prop, and derive the exact fraction via
      // computeSessionPhase() — the same pure function the hook itself
      // uses, so the hand's sweep is perfectly smooth between polls
      // without needing a second timing mechanism.
      const session = sessionRef.current;
      if (session) {
        const phaseNow = computeSessionPhase(now, session);
        const progress = clamp(1 - phaseNow.remainingSec / session.durationSec, 0, 1);
        const handPoint = clockPoint(progress * 360, CLOCK_HAND_RADIUS);
        pupilRef.current?.setAttribute('cx', String(handPoint.x));
        pupilRef.current?.setAttribute('cy', String(handPoint.y));
        clockHandLineRef.current?.setAttribute('x2', String(handPoint.x));
        clockHandLineRef.current?.setAttribute('y2', String(handPoint.y));
      } else {
        // The eye watches the pendulum: look toward wherever the tip
        // currently is, using the SAME angle (including the wiggle) that
        // just moved the arm, so the eye reacts to the tick too.
        setPupilFromAngle(totalAngle);
        clockHandLineRef.current?.setAttribute('x2', String(EYE.x));
        clockHandLineRef.current?.setAttribute('y2', String(EYE.y));
      }

      drawWaveform();
      rafRef.current = requestAnimationFrame(frame);
    }

    function drawWaveform() {
      const canvas = canvasRef.current;
      const analyser = getAnalyser();
      if (!canvas || !analyser) return;

      const dpr = window.devicePixelRatio || 1;
      const size = canvas.clientWidth;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const bufferLength = analyser.frequencyBinCount;
      const data = new Uint8Array(bufferLength);
      analyser.getByteTimeDomainData(data);

      // Heavily smoothed + downsampled ring — "chilled", not a jagged
      // oscilloscope. Exponential smoothing per point across frames gives
      // it a slow, breathing quality even though the underlying signal
      // updates every frame.
      const points = 64;
      if (!smoothedRef.current || smoothedRef.current.length !== points) {
        smoothedRef.current = new Array(points).fill(0);
      }
      const smoothed = smoothedRef.current;

      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.34;
      const amp = size * 0.05;

      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const idx = Math.floor((i % points) * (bufferLength / points));
        const sample = (data[idx] - 128) / 128;
        smoothed[i % points] = smoothed[i % points] * 0.9 + sample * 0.1;
        const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
        const r = baseRadius + smoothed[i % points] * amp;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = bandInfo.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, bandInfo.color, onSwingUpdate]);

  // When the pendulum isn't moving, the eye watches the cursor instead —
  // an idle instrument that's still paying attention. Tracks the pointer
  // anywhere on the page (not just while hovering the visual itself), so
  // it reads as alive rather than as a hover effect. Deliberately a
  // SEPARATE effect from the swing-driven one above rather than one
  // combined effect: the three pupil modes (swing-tracking, mouse-
  // tracking, session-clock) are mutually exclusive by construction, so
  // keeping them apart avoids one growing a pile of branches.
  //
  // Guarded on `sessionPhase === 'ended'` too, not just `isPlaying`: a
  // natural session end sets isPlaying false immediately but holds
  // sessionPhase at 'ended' for a few seconds so the eye's completed
  // clock face (numeral "0:00", hand at 12) has time to actually read as
  // finished — mouse-tracking taking over instantly would erase that.
  useEffect(() => {
    if (isPlaying || sessionPhase === 'ended') return;
    const svg = svgRef.current;
    const pupil = pupilRef.current;
    if (!svg || !pupil) return;

    pupil.classList.add('tracking');

    function handlePointerMove(e: PointerEvent) {
      const rect = svg!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const scaleX = VIEW / rect.width;
      const scaleY = VIEW / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;
      const dx = px - EYE.x;
      const dy = py - EYE.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Ease off the deflection for a cursor very close to the eye, so it
      // doesn't jitter wildly when the pointer is right on top of it.
      const reach = Math.min(1, dist / (PUPIL_MAX_OFFSET * 4));
      const offsetX = (dx / dist) * PUPIL_MAX_OFFSET * reach;
      const offsetY = (dy / dist) * PUPIL_MAX_OFFSET * reach;
      pupil!.setAttribute('cx', String(EYE.x + offsetX));
      pupil!.setAttribute('cy', String(EYE.y + offsetY));
    }

    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      pupil.classList.remove('tracking');
      pupil.setAttribute('cx', String(EYE.x));
      pupil.setAttribute('cy', String(EYE.y));
    };
  }, [isPlaying, sessionPhase]);

  const hasSession = sessionPhase !== 'idle';

  return (
    <div
      className="metronome-visual"
      style={
        {
          '--band-color': bandInfo.color,
          '--band-glow': bandInfo.glow,
          '--mood-breathe-dur': `${mood.breatheDurSec}s`,
          '--mood-breathe-scale': mood.breatheScale,
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} className="metronome-waveform" aria-hidden="true" />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="metronome-svg"
        role="img"
        aria-label="Mindful Metronome visual"
      >
        <path
          d={`M ${PIVOT.x} 48 L ${BASE_RIGHT.x} ${BASE_RIGHT.y} L ${BASE_LEFT.x} ${BASE_LEFT.y} Z`}
          className={`pyramid-outline ${pyramidPinging ? 'pyramid-ping' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Ping the pyramid"
          onClick={handlePyramidTap}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handlePyramidTap();
            }
          }}
        />

        <NeuronCluster side="left" color={bandInfo.color} pulseToken={lastTickSide === 'left' ? `L${tickCount}` : 'L-idle'} />
        <NeuronCluster side="right" color={bandInfo.color} pulseToken={lastTickSide === 'right' ? `R${tickCount}` : 'R-idle'} />

        <g ref={armRef} className="metronome-arm">
          <path ref={armPathRef} className="metronome-arm-line" d={`M ${PIVOT.x} ${PIVOT.y} L ${PIVOT.x} ${PIVOT.y + ARM_LENGTH}`} />
          <circle cx={PIVOT.x} cy={PIVOT.y + ARM_LENGTH} r={7} className="metronome-arm-tip" />
          <TempoWeight bpm={bpm} onSetBpm={onSetBpm} color={bandInfo.color} />
        </g>

        <circle cx={PIVOT.x} cy={PIVOT.y} r={5} className="metronome-pivot-dot" />

        <g className={`metronome-eye ${hasSession ? 'has-session' : ''}`}>
          <circle
            cx={EYE.x}
            cy={EYE.y}
            r={38}
            className={`eye-outer ${eyeWinking ? 'eye-wink' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Wink"
            onClick={handleEyeTap}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleEyeTap();
              }
            }}
          />
          <circle cx={EYE.x} cy={EYE.y} r={22} className="eye-iris" />
          <g className="eye-clock-ticks" aria-hidden="true">
            {CLOCK_TICKS.map((tick, i) => (
              <line
                key={i}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                className={`eye-clock-tick ${tick.major ? 'eye-clock-tick-major' : ''}`}
              />
            ))}
          </g>
          <line ref={clockHandLineRef} x1={EYE.x} y1={EYE.y} x2={EYE.x} y2={EYE.y} className="eye-clock-hand" aria-hidden="true" />
          <circle ref={pupilRef} cx={EYE.x} cy={EYE.y} r={9} className="eye-pupil" />
          {hasSession && (
            <text x={EYE.x} y={EYE.y} textAnchor="middle" dominantBaseline="central" className="eye-clock-text">
              {formatCountdown(sessionRemainingSec ?? 0)}
            </text>
          )}
        </g>
      </svg>
      <p className="tempo-weight-hint">Drag the weight — {bpm} BPM</p>
    </div>
  );
}
