import { useEffect, useRef, useState } from 'react';
import { BANDS, MAX_BPM, MIN_BPM, type BrainwaveBand } from '../../data/bands';
import type { TickSubdivision } from '../../audio/binauralEngine';
import { MOOD_BY_BAND } from '../../data/moods';
import { buildSmoothPath, clamp, pendulumEase, waveOffset } from '../../engine/motion';
import { formatCountdown } from '../../format';
import {
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
/** The center-crossing wiggle's amplitude relative to the end-arrival
 * wiggle's — deliberately the SAME numeric value as binauralEngine.ts's
 * CENTER_TICK_GAIN_SCALE (two separately-defined constants kept in
 * numeric parity by convention, not a shared import — audio and visual
 * layers don't currently share constants) so the off-beat accent reads
 * as visually "quieter" in lockstep with how it sounds quieter. */
const CENTER_WIGGLE_SCALE = 0.55;
/** Radius of the iris fill-wedge showing session time remaining against a
 * fixed 60-minute dial — see the wedge comment in the rAF loop below.
 * Reaches out to just inside the eye-outer ring (r=38) so it visibly
 * covers the tick marks (r=23-37) too, not just the iris disc. */
const CLOCK_WEDGE_RADIUS = 36;
/** The fixed reference the iris wedge is sized against — NOT the
 * session's own duration. Because SessionState.durationSec already equals
 * `minutes * 60`, `durationSec / HOUR_DIAL_SEC` alone lands exactly on
 * 0.25/0.5/0.75/1.0 at 15/30/45/60 minutes, with zero special-casing. */
const HOUR_DIAL_SEC = 3600;

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
// traveling snake-wave tied to BPM, and motion eases in on Play and
// settles out on Pause/Stop. NONE of this changes WHEN a beat lands: the
// ramp/mood/wave math only reshapes the RENDERED swing. The drone's
// actual audio pan is NOT driven from here at all — see
// BinauralEngine.scheduleDroneSwing(), pre-scheduled per-beat from
// useMetronomeEngine.ts's handleBeatScheduled, independent of this rAF
// loop (which the browser throttles or pauses entirely in a backgrounded
// tab — audio panning needs to keep going regardless).
//
// The pupil ALWAYS tracks the pendulum's tip (or the cursor, while idle)
// — it never stops doing that job, session or no session. While a timed
// session is running, the IRIS itself becomes a fill-wedge showing time
// remaining against a fixed 60-minute dial (a 15-min session starts
// filled to exactly 1/4 and shrinks to nothing as it runs out, 30 min at
// half, etc.), with a numeral readout alongside it — a separate visual
// layer from the pupil, not a replacement for it.
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

/** Builds a filled pie-wedge `d` string spanning clockwise from 12 o'clock
 * to `sweepDeg` degrees, radius CLOCK_WEDGE_RADIUS — the iris timer's
 * fill. `sweepDeg` is `remainingSec / HOUR_DIAL_SEC * 360`, so the wedge
 * starts at the session's OWN fraction of the hour dial (a 15-min session
 * starts filled to exactly 1/4) and shrinks toward nothing as time runs
 * out, reaching 0 exactly when the session ends — the mirror image of
 * the 12 CLOCK_TICKS' own always-static hour-dial framing. Clamped just
 * under 360 because an SVG arc command can't represent a true full circle
 * (identical start/end points render as nothing, not a full circle). */
function buildWedgePathD(sweepDeg: number): string {
  const clamped = Math.max(0, Math.min(sweepDeg, 359.9));
  const start = clockPoint(0, CLOCK_WEDGE_RADIUS);
  const end = clockPoint(clamped, CLOCK_WEDGE_RADIUS);
  const largeArc = clamped > 180 ? 1 : 0;
  return `M ${EYE.x} ${EYE.y} L ${start.x} ${start.y} A ${CLOCK_WEDGE_RADIUS} ${CLOCK_WEDGE_RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
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

/** Four mouth expressions for the pyramid's base-edge flourish (see the
 * mouth-scheduling effect below) — each a single quadratic Bezier with
 * BOTH endpoints fixed at BASE_LEFT/BASE_RIGHT (so it always reads as
 * sitting exactly where the neutral base edge sits), only the control
 * point moves. SVG y grows DOWNWARD: a control point pushed below the
 * baseline dips the curve's middle down, which reads as the CORNERS being
 * raised — a smile (⌣). Pushed above the baseline, the corners read as
 * drooping — a sigh (⌢). An off-center control point biases the curve's
 * peak toward one side for an asymmetric smirk or a subtler "considering"
 * waver. */
const MOUTH_SHAPES = {
  smile: `M ${BASE_LEFT.x} ${BASE_LEFT.y} Q 200 336 ${BASE_RIGHT.x} ${BASE_RIGHT.y}`,
  sigh: `M ${BASE_LEFT.x} ${BASE_LEFT.y} Q 200 308 ${BASE_RIGHT.x} ${BASE_RIGHT.y}`,
  smirk: `M ${BASE_LEFT.x} ${BASE_LEFT.y} Q 260 306 ${BASE_RIGHT.x} ${BASE_RIGHT.y}`,
  consider: `M ${BASE_LEFT.x} ${BASE_LEFT.y} Q 210 316 ${BASE_RIGHT.x} ${BASE_RIGHT.y}`,
} as const;

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
 * The pupil ALWAYS does this job now, session or no session — the timed-
 * session readout lives entirely in the iris fill-ring instead (see
 * CLOCK_RING_RADIUS). */
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
  bpm: number;
  onSetBpm: (bpm: number) => void;
  /** Raw session reference (or null when no timed session is armed) — read
   * DIRECTLY inside the rAF loop every frame, exactly like `swingRef`,
   * rather than relying on the 250ms-polled `sessionPhase`/
   * `sessionRemainingSec` React state. This sidesteps a
   * real staleness risk: `sessionRef.current` can flip from null to a
   * real session (or back) WHILE isPlaying stays true (e.g. picking a
   * duration mid-play), which would NOT re-run this effect since
   * `isPlaying` didn't change — a value captured only in the effect's own
   * closure would go stale in that case, but a ref's `.current` is always
   * fresh no matter when it's read. */
  sessionRef: React.RefObject<SessionState | null>;
  sessionPhase: SessionPlaybackPhase;
  sessionRemainingSec: number | null;
  /** Which tick(s) are currently audible — see TickSubdivision's doc
   * comment in binauralEngine.ts. Drives which of the arm's two wiggle
   * accents (end-arrival, center-crossing) are active — see the
   * `tickSubdivisionRef` comment in the rAF loop below for why this is
   * read via a ref rather than a plain closed-over prop. */
  tickSubdivision: TickSubdivision;
}

export function MetronomeVisual({
  isPlaying,
  band,
  swingRef,
  getAudioTimeSec,
  getAnalyser,
  lastTickSide,
  tickCount,
  bpm,
  onSetBpm,
  sessionRef,
  sessionPhase,
  sessionRemainingSec,
  tickSubdivision,
}: MetronomeVisualProps) {
  const armRef = useRef<SVGGElement | null>(null);
  const armPathRef = useRef<SVGPathElement | null>(null);
  const pupilRef = useRef<SVGCircleElement | null>(null);
  const wedgeRef = useRef<SVGPathElement | null>(null);
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
  /** True for the duration of the settle-tail (see the `!isPlaying`
   * branch below). The separate mouse-tracking effect checks this before
   * taking control of the pupil's cx/cy — without it, Pause/Stop starts
   * BOTH the settle-tail's precise per-frame writes AND mouse-tracking's
   * `.tracking` CSS-transitioned writes on the exact same pupil element in
   * the same render, and whichever one touches the DOM last (or a stray
   * pointermove mid-settle) wins, smearing or overriding the intended
   * settle curve. */
  const settlingRef = useRef(false);
  // frame()'s rAF effect only re-runs on [isPlaying, bandInfo.color,
  // onSwingUpdate] — adding tickSubdivision there would wrongly restart
  // the ramp-in every time the "Beat pattern" control is toggled mid-
  // play. Read it fresh via a ref instead, kept in sync every render body
  // (same technique useMetronomeEngine.ts uses for
  // sessionDurationMinutesRef).
  const tickSubdivisionRef = useRef(tickSubdivision);
  tickSubdivisionRef.current = tickSubdivision;

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

  // Idle-only blink: a periodic, natural-feeling close-and-open, distinct
  // from the tap-triggered .eye-wink above (that one's a direct response
  // to a click, scoped to just the outer ring; this one closes the WHOLE
  // eye group and fires on its own while nobody's touching anything).
  // Gated on !isPlaying per the builder's own framing ("during idle") —
  // while playing, the pupil/wiggle/wave are already carrying the
  // instrument's "alive" quality, a blink would just be visual noise
  // fighting the beat-synced motion.
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (isPlaying) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let closeTimeout: ReturnType<typeof setTimeout> | null = null;
    let nextBlinkTimeout: ReturnType<typeof setTimeout> | null = null;

    function scheduleNextBlink() {
      const gapMs = 3000 + Math.random() * 4000; // 3-7s
      nextBlinkTimeout = setTimeout(() => {
        setBlinking(true);
        closeTimeout = setTimeout(() => {
          setBlinking(false);
          scheduleNextBlink();
        }, 260);
      }, gapMs);
    }
    scheduleNextBlink();

    return () => {
      if (closeTimeout) clearTimeout(closeTimeout);
      if (nextBlinkTimeout) clearTimeout(nextBlinkTimeout);
      setBlinking(false);
    };
  }, [isPlaying]);

  // Pyramid mouth flourish: the base edge occasionally, briefly reads as a
  // mouth (smile/sigh/smirk/consider), cross-faded in via opacity rather
  // than true path morphing — matches this file's existing convention for
  // the eye-clock-* fades, no extra libraries needed. Runs whether playing
  // or idle (per the builder — this one's ongoing character, not an idle
  // tell like the blink above).
  const [mouthShape, setMouthShape] = useState<keyof typeof MOUTH_SHAPES>('smile');
  const [mouthVisible, setMouthVisible] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const shapes = Object.keys(MOUTH_SHAPES) as (keyof typeof MOUTH_SHAPES)[];
    let hideTimeout: ReturnType<typeof setTimeout> | null = null;
    let showTimeout: ReturnType<typeof setTimeout> | null = null;

    function scheduleNextExpression() {
      const gapMs = 8000 + Math.random() * 12000; // 8-20s
      showTimeout = setTimeout(() => {
        setMouthShape(shapes[Math.floor(Math.random() * shapes.length)]);
        setMouthVisible(true);
        hideTimeout = setTimeout(() => {
          setMouthVisible(false);
          scheduleNextExpression();
        }, 2000);
      }, gapMs);
    }
    scheduleNextExpression();

    return () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      if (showTimeout) clearTimeout(showTimeout);
      setMouthVisible(false);
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

  /** The decaying-vibration shape shared by both wiggle accents (end-
   * arrival, center-crossing) — `sinceSec` is elapsed time since whichever
   * moment is being accented. Scaled by the band's mood (energized bands
   * wiggle harder), matching the original single-accent formula exactly. */
  function wiggleFor(sinceSec: number): number {
    if (sinceSec < 0 || sinceSec >= 0.35) return 0;
    return Math.exp(-sinceSec * 14) * Math.sin(sinceSec * 60) * 4 * mood.wiggleMul;
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
    settlingRef.current = false;
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
      // This is purely a rendering-layer tail — the manual-Pause/Stop-is-
      // audio-instant invariant lives entirely in BinauralEngine.stop()
      // now (its own short click-free release ramp), completely
      // independent of this decay; only the arm/pupil/wave's RENDERED
      // settle is what this loop drives.
      const startAngle = lastAngleRef.current;
      const startAmplitude = lastWaveAmplitudeRef.current;

      if (Math.abs(startAngle) < 0.01 && startAmplitude < 0.01) {
        snapToRest();
        return;
      }

      settlingRef.current = true;
      const startTime = performance.now(); // wall clock — the AudioContext may already be torn down by stop()
      function settleFrame() {
        const t = clamp((performance.now() - startTime) / SETTLE_MS, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const remaining = 1 - eased;
        const angle = startAngle * remaining;
        const amplitude = startAmplitude * remaining;

        if (armRef.current) armRef.current.setAttribute('transform', `rotate(${angle} ${PIVOT.x} ${PIVOT.y})`);
        if (armPathRef.current) armPathRef.current.setAttribute('d', buildArmPathD(amplitude, 0));
        setPupilFromAngle(angle);
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
    // isPlaying/bandInfo.color change — a mid-play setBpm() does not
    // re-run it, so dragging the tempo weight never re-triggers a ramp).
    const rampStartSec = getAudioTimeSec();

    function frame() {
      const arm = armRef.current;
      const swing = swingRef.current;
      const now = getAudioTimeSec();

      const rampT = clamp((now - rampStartSec) / RAMP_IN_SEC, 0, 1);
      const rampIn = 1 - Math.pow(1 - rampT, 3);

      let angle = 0;
      let wiggle = 0;
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
        // comment in engine/motion.ts. Also matched, formula-for-formula
        // (mood + live tempo -> hangWeight -> pendulumEase shape), by
        // BinauralEngine.scheduleDroneSwing()'s audio-side curve, computed
        // independently in useMetronomeEngine.ts's handleBeatScheduled —
        // the two are no longer fed by the same per-frame value (see this
        // file's header comment for why), so keeping the FORMULA in sync
        // is what keeps the rendered swing and the audible pan agreeing.
        const tempoT = (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
        const hangWeight = clamp(mood.easeHangTime - 0.35 * tempoT, 0.05, 0.95);
        const eased = pendulumEase(t, hangWeight);

        const fromDeg = segment.fromSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
        const toDeg = segment.toSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
        angle = fromDeg + (toDeg - fromDeg) * eased;

        // A short, decaying vibration layered on top the instant a tick
        // actually sounds — the "wiggle" the tone triggers, distinct from
        // the smooth swing. Scaled by the band's mood (energized bands
        // wiggle harder). Two independently-gated accents share one decay
        // shape: the end-arrival (today's original single accent) and the
        // center-crossing "&" — see TickSubdivision's doc comment.
        // Confirmed scope: in CENTER mode the (silent) end-arrival gets
        // NO accent; the center-crossing drives it instead.
        const subdivision = tickSubdivisionRef.current;
        if (subdivision !== 'CENTER') {
          const sinceArrival = now - segment.toTimeSec;
          wiggle += wiggleFor(sinceArrival);
        }
        if (subdivision !== 'ENDS') {
          const centerCrossSec = segment.fromTimeSec + span / 2; // geometric midpoint, independent of audio scheduling
          wiggle += wiggleFor(now - centerCrossSec) * CENTER_WIGGLE_SCALE;
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

      // Snake-wave resonance along the rod, tied to bpm and the band's
      // mood — phase derived from the absolute audio clock (not
      // accumulated per-frame), matching this file's anti-drift
      // philosophy everywhere else, so the ripple's speed stays locked to
      // real tempo regardless of frame jank.
      const wavePhase = now * 2 * Math.PI * (bpm / 60) * 1.5 * mood.waveSpeedMul;
      const waveAmplitude = BASE_WAVE_AMPLITUDE * mood.waveAmplitudeMul * rampIn;
      lastWaveAmplitudeRef.current = waveAmplitude;
      if (armPathRef.current) armPathRef.current.setAttribute('d', buildArmPathD(waveAmplitude, wavePhase));

      // The eye watches the pendulum: look toward wherever the tip
      // currently is, using the SAME angle (including the wiggle) that
      // just moved the arm, so the eye reacts to the tick too. Always —
      // session or no session; the timed-session readout lives in the
      // iris fill-ring below, not in the pupil.
      setPupilFromAngle(totalAngle);

      // Iris fill-wedge: read `sessionRef.current` directly (fresh every
      // frame, see the prop's doc comment above) rather than the polled
      // `sessionPhase` prop. Starts filled to the session's OWN fraction
      // of the hour dial (durationSec/HOUR_DIAL_SEC — a 15-min session
      // starts at exactly 1/4) and shrinks as remainingSec counts down,
      // reaching empty exactly when the session ends — the builder wants
      // to read "how much time is left" directly off the wedge shrinking,
      // not a fill growing toward some eventual size.
      const session = sessionRef.current;
      if (session && wedgeRef.current) {
        const elapsedSec = now - session.startTimeSec;
        const remainingSec = Math.max(0, session.durationSec - elapsedSec);
        const sweepDeg = clamp(remainingSec / HOUR_DIAL_SEC, 0, 1) * 360;
        wedgeRef.current.setAttribute('d', buildWedgePathD(sweepDeg));
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
  }, [isPlaying, bandInfo.color]);

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

    let armed = false;
    let armRafId: number | null = null;

    function handlePointerMove(e: PointerEvent) {
      // Defensive re-check: even once armed, never fight the settle-tail
      // for control of cx/cy (see settlingRef's doc comment).
      if (settlingRef.current) return;
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

    // Wait out any in-progress settle-tail before taking over the pupil —
    // arming immediately (the old behavior) raced the settle-tail's own
    // per-frame writes on the exact same element. Polling settlingRef via
    // rAF (rather than a fixed guessed delay) waits exactly as long as
    // THIS settle actually takes, whatever SETTLE_MS/the arm's angle at
    // Pause make that be.
    function tryArm() {
      if (settlingRef.current) {
        armRafId = requestAnimationFrame(tryArm);
        return;
      }
      armed = true;
      pupil!.classList.add('tracking');
      window.addEventListener('pointermove', handlePointerMove);
    }
    tryArm();

    return () => {
      if (armRafId !== null) cancelAnimationFrame(armRafId);
      if (armed) {
        window.removeEventListener('pointermove', handlePointerMove);
        pupil.classList.remove('tracking');
        pupil.setAttribute('cx', String(EYE.x));
        pupil.setAttribute('cy', String(EYE.y));
      }
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
        {/* Invisible, geometry-only tap target — the full closed triangle,
            same as this element used to be before its base edge was split
            out into separate neutral/mouth paths below (see §4 of the
            eye/mouth iteration plan). `pointer-events: all` on a CLOSED
            path makes its whole interior clickable regardless of fill, but
            that trick needs the closed geometry — the two now-open visible
            side-paths below can't provide it on their own. */}
        <path
          d={`M ${PIVOT.x} 48 L ${BASE_RIGHT.x} ${BASE_RIGHT.y} L ${BASE_LEFT.x} ${BASE_LEFT.y} Z`}
          className="pyramid-hit-target"
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
        <path
          d={`M ${PIVOT.x} 48 L ${BASE_RIGHT.x} ${BASE_RIGHT.y} M ${PIVOT.x} 48 L ${BASE_LEFT.x} ${BASE_LEFT.y}`}
          className={`pyramid-outline ${pyramidPinging ? 'pyramid-ping' : ''}`}
          aria-hidden="true"
        />
        <path
          d={`M ${BASE_LEFT.x} ${BASE_LEFT.y} L ${BASE_RIGHT.x} ${BASE_RIGHT.y}`}
          className="pyramid-base-edge"
          style={{ opacity: mouthVisible ? 0 : 1 }}
          aria-hidden="true"
        />
        <path
          d={MOUTH_SHAPES[mouthShape]}
          className="pyramid-mouth"
          style={{ opacity: mouthVisible ? 1 : 0 }}
          aria-hidden="true"
        />

        <NeuronCluster side="left" color={bandInfo.color} pulseToken={lastTickSide === 'left' ? `L${tickCount}` : 'L-idle'} />
        <NeuronCluster side="right" color={bandInfo.color} pulseToken={lastTickSide === 'right' ? `R${tickCount}` : 'R-idle'} />

        <g ref={armRef} className="metronome-arm">
          <path ref={armPathRef} className="metronome-arm-line" d={`M ${PIVOT.x} ${PIVOT.y} L ${PIVOT.x} ${PIVOT.y + ARM_LENGTH}`} />
          <circle cx={PIVOT.x} cy={PIVOT.y + ARM_LENGTH} r={7} className="metronome-arm-tip" />
          <TempoWeight bpm={bpm} onSetBpm={onSetBpm} color={bandInfo.color} />
        </g>

        <circle cx={PIVOT.x} cy={PIVOT.y} r={5} className="metronome-pivot-dot" />

        <g className={`metronome-eye ${hasSession ? 'has-session' : ''} ${blinking ? 'eye-blink' : ''}`}>
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
          <path ref={wedgeRef} className="eye-clock-wedge" d={buildWedgePathD(0)} aria-hidden="true" />
          <circle ref={pupilRef} cx={EYE.x} cy={EYE.y} r={9} className="eye-pupil" />
          {hasSession && (
            <text x={EYE.x} y={EYE.y + 13} textAnchor="middle" dominantBaseline="central" className="eye-clock-text">
              {formatCountdown(sessionRemainingSec ?? 0)}
            </text>
          )}
        </g>
      </svg>
      <p className="tempo-weight-hint">Drag the weight — {bpm} BPM</p>
    </div>
  );
}
