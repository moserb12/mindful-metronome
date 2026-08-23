import { useEffect, useRef, useState } from 'react';
import { BANDS, MAX_BPM, MIN_BPM, type BrainwaveBand } from '../../data/bands';
import type { TickSubdivision } from '../../audio/binauralEngine';
import { MEDALLIONS_BY_ID, type MedallionId } from '../../data/medallions';
import { MOOD_BY_BAND } from '../../data/moods';
import { buildSmoothPath, clamp, pendulumEase, waveOffset } from '../../engine/motion';
import { computeSwingSegment, type SessionPlaybackPhase, type SessionState, type SwingState } from '../../hooks/useMetronomeEngine';
import { MedallionGlyph } from '../Dashboard/MedallionIcon';
import { MedallionPicker } from './MedallionPicker';

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
// — it never stops doing that job, session or no session. An earlier pass
// turned the iris itself into a session countdown (a from-center fill-
// wedge + numeral), then removed it entirely because the wedge visually
// painted over the pupil whenever the pupil's live position fell inside
// the swept angle. It's back now as an ANNULAR ring living entirely
// outside eye-outer's radius (see EYE_TIMER_INNER_R/EYE_TIMER_OUTER_R
// below) — geometrically incapable of touching the pupil, since the ring
// never reaches EYE's center at all, unlike the old wedge. The numeral
// countdown is deliberately NOT part of it — that stays in
// SessionTimer.tsx only, to avoid recreating clutter at the eye's center.
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

/** Fixed 60-minute dial the session ring is drawn against — a 15-min
 * session therefore starts at exactly 90° (1/4 sweep) and shrinks toward
 * 0° as time runs out, regardless of which duration was actually picked
 * — same "kitchen timer" behavior as a mechanical dial timer. */
const HOUR_DIAL_SEC = 3600;

/** The ring's inner/outer radii, in SVG units from EYE. Chosen to sit
 * entirely OUTSIDE eye-outer's live max radius (r=38, breathing up to
 * ~39.3) and well inside the pyramid edges' ~67.9-unit clearance and the
 * nearest neuron node's ~80.5-unit clearance — a currently-empty band
 * that can never touch the iris(22)/pupil(max dist 19)/eye-outer(38),
 * fixing the old wedge's "paints over the pupil" bug by construction:
 * the band never reaches EYE's center at all. */
const EYE_TIMER_INNER_R = 44;
const EYE_TIMER_OUTER_R = 58;

/** Tick geometry — minor ticks sit inside the ring band so they read
 * faintly through the translucent fill (ticks painted first, ring on top
 * at partial opacity); major ticks (every 3rd, i.e. the 0/15/30/45-min
 * marks) poke slightly past both edges for emphasis, staying inside
 * 42..60 — still clear of eye-outer and the pyramid clearance. */
const EYE_TIMER_TICK_MINOR_INNER = 46;
const EYE_TIMER_TICK_MINOR_OUTER = 56;
const EYE_TIMER_TICK_MAJOR_INNER = 42;
const EYE_TIMER_TICK_MAJOR_OUTER = 60;

/** 0° = straight up from EYE, sweeping clockwise. */
function clockPoint(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: EYE.x + radius * Math.sin(rad), y: EYE.y - radius * Math.cos(rad) };
}

/** Builds a shrinking ANNULAR SECTOR — a thick ring band swept from 0° to
 * `sweepDeg`, confined between `innerR` and `outerR`. Four segments: out
 * along the outer arc, straight line in to the inner radius, back along
 * the inner arc, close. Unlike a from-center pie slice (`M EYE.x EYE.y L
 * ... Z`), this never touches EYE's own center at any sweep angle — the
 * direct fix for the removed wedge's "paints over the pupil" bug. At
 * sweepDeg=0 this collapses to a degenerate (invisible) path, matching a
 * fully-elapsed session. */
function buildAnnularWedgePathD(sweepDeg: number, innerR: number, outerR: number): string {
  const clamped = Math.max(0, Math.min(sweepDeg, 359.9));
  const outerStart = clockPoint(0, outerR);
  const outerEnd = clockPoint(clamped, outerR);
  const innerEnd = clockPoint(clamped, innerR);
  const innerStart = clockPoint(0, innerR);
  const largeArc = clamped > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

/** 12 ticks, one per 5 real minutes (30° = 5min on the 60-min dial),
 * every 3rd (0/15/30/45-min positions) drawn major/bolder for a classic
 * clock-face read, styled after a kitchen-timer dial. */
const EYE_TIMER_TICKS = Array.from({ length: 12 }, (_, i) => {
  const angleDeg = i * 30;
  const major = i % 3 === 0;
  const inner = clockPoint(angleDeg, major ? EYE_TIMER_TICK_MAJOR_INNER : EYE_TIMER_TICK_MINOR_INNER);
  const outer = clockPoint(angleDeg, major ? EYE_TIMER_TICK_MAJOR_OUTER : EYE_TIMER_TICK_MINOR_OUTER);
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
 * The pupil ALWAYS does this job, session or no session. */
const PUPIL_MAX_OFFSET = 10;

/** Where along the rod the weight can slide, in SVG units from the pivot.
 * Kept short of the pivot dot and the tip so it never visually collides
 * with either. */
const WEIGHT_MIN_OFFSET = 40;
const WEIGHT_MAX_OFFSET = ARM_LENGTH - 30;

interface TempoWeightProps {
  bpm: number;
  onSetBpm: (bpm: number) => void;
  band: BrainwaveBand;
}

/** A pointer has to move more than this many CSS pixels before a drag
 * actually starts nudging BPM — otherwise a plain click-without-drag on
 * the weight (no drag intended at all) still nudges tempo by a pixel or
 * two of unavoidable pointer jitter. */
const TAP_MOVE_THRESHOLD_PX = 5;

/** Builds the "outer minus hole" compound path for the bagel body — two
 * full-ellipse subpaths combined under `fill-rule: evenodd`, the same
 * technique MedallionIcon.tsx uses for the crescent moon. This is what
 * makes the hole a genuine cutout (the rod line and, through it, whatever's
 * behind show through) rather than a same-color circle just painted on
 * top. */
function ellipseSubpath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
}

/** Fixed "seed" positions scattered on the bagel's surface — a handful of
 * small offsets from center, chosen by hand to sit on the dough and clear
 * of the hole, not generated per-render, so the bagel doesn't re-sprinkle
 * itself on every re-render. */
const BAGEL_SEEDS: [number, number][] = [
  [-11, -5],
  [-5, -8.5],
  [3, -8.5],
  [10, -5.5],
  [-9, 5.5],
  [9, 6],
  [0, 8.5],
];

const BAGEL_RX = 17;
const BAGEL_RY = 11;
const BAGEL_HOLE_RX = 6.5;
const BAGEL_HOLE_RY = 4;
const BAGEL_COLOR = '#c9924f';
/** Scale factor for MedallionGlyph's fixed 0..100 local viewBox onto the
 * pendant's real (400-unit) coordinate space, applied via
 * translate(cx,cy) scale(s) translate(-50,-50) — SVG transforms compose
 * right-to-left: re-center the glyph's local (50,50) origin to (0,0)
 * first, then scale, then move to the real pendant position.
 *
 * Most glyphs' effective bounding radius from their local center is
 * ~27-32 units. At scale 0.65 those land at real radius ~18-22 —
 * comfortably bigger than the old 13px charm (previously only ~6.5-unit
 * radius, i.e. the pendant used to be roughly 3x too small to easily
 * eye-track) and in the same ballpark as TempoWeight's own shapes
 * (~15-23 SVG units).
 *
 * Not normalized across glyphs — every glyph keeps its own honest
 * proportions. The largest (crescent-moon's offset cutout circle,
 * lightbulb, flame — each ~36-39 local units from center) land at
 * ~24.7-25.4 real units, which clears the ~39.8-unit margin from tipY to
 * the viewBox's bottom edge with room to spare regardless of which
 * medallion is equipped. */
const PENDANT_GLYPH_SCALE = 0.65;

/** Invisible hit-target radius for the pendant — generous enough to
 * fully enclose even the largest glyphs, mirroring TempoWeight's
 * WEIGHT_HIT_RADIUS precedent. Critical for sparse glyphs (snowflake's
 * thin arms, the spiral/infinity band-orb glyphs) that would otherwise
 * be nearly unclickable outside their painted strokes. */
const PENDANT_HIT_RADIUS = 28;
/** Uniform invisible hit-target radius shared by all 5 weight shapes —
 * roughly the bagel's own equivalent-area radius, so every shape gets a
 * comparably generous grab area regardless of how thin its silhouette is
 * (the star's points and the bolt's zigzag are visually much narrower than
 * this circle). */
const WEIGHT_HIT_RADIUS = 14;

/** Builds the 8-vertex outline for the beta/"happy" weight's 4-point
 * sparkle, alternating between outerR and innerR every 45°. */
function sparklePathD(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    points.push(`${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)}`);
  }
  return `M ${points[0]} L ${points.slice(1).join(' L ')} Z`;
}

/** Renders the weight's visible body, keyed on the active brainwave band —
 * each band gets its own silhouette so the weight itself carries the
 * current mood, not just the pendulum's tint. Alpha keeps the original
 * bagel (evenodd hole + glaze + seeds); the other four are simple solid
 * shapes filled with the band's own identity color. */
function renderWeightShape(band: BrainwaveBand, cx: number, cy: number, color: string) {
  switch (band) {
    case 'delta':
      // Cloud — three overlapping circles + a flattened base ellipse, one
      // solid silhouette. Soft and pillowy, no hard edges.
      return (
        <g className="tempo-weight-body" fill={color}>
          <ellipse cx={cx} cy={cy + 3} rx={15} ry={7} />
          <circle cx={cx - 8} cy={cy - 3} r={7} />
          <circle cx={cx} cy={cy - 5} r={8} />
          <circle cx={cx + 8} cy={cy - 3} r={7} />
        </g>
      );
    case 'theta':
      // Leaf — a pointed teardrop with a thin center vein.
      return (
        <g className="tempo-weight-body">
          <path
            fill={color}
            d={`M ${cx} ${cy - 15} C ${cx + 12} ${cy - 10} ${cx + 10} ${cy + 9} ${cx} ${cy + 16} C ${cx - 10} ${cy + 9} ${cx - 12} ${cy - 10} ${cx} ${cy - 15} Z`}
          />
          <line className="tempo-weight-vein" x1={cx} y1={cy - 11} x2={cx} y2={cy + 12} aria-hidden="true" />
        </g>
      );
    case 'beta':
      // Sparkle — bright, "twinkle."
      return <path className="tempo-weight-body" fill={color} d={sparklePathD(cx, cy, 15, 5)} />;
    case 'gamma':
      // Lightning bolt — angular, kinetic.
      return (
        <path
          className="tempo-weight-body"
          fill={color}
          d={`M ${cx + 3} ${cy - 16} L ${cx - 6} ${cy - 2} L ${cx + 1} ${cy - 2} L ${cx - 4} ${cy + 16} L ${cx + 7} ${cy} L ${cx} ${cy} Z`}
        />
      );
    case 'alpha':
    default:
      // Bagel — the original shape, unchanged. This IS the default/most-
      // traveled path, so it's kept exactly as it was.
      return (
        <>
          <path
            className="tempo-weight-body"
            fillRule="evenodd"
            d={`${ellipseSubpath(cx, cy, BAGEL_RX, BAGEL_RY)} ${ellipseSubpath(cx, cy, BAGEL_HOLE_RX, BAGEL_HOLE_RY)}`}
            fill={BAGEL_COLOR}
          />
          <ellipse cx={cx} cy={cy - BAGEL_RY * 0.45} rx={BAGEL_RX * 0.68} ry={BAGEL_RY * 0.32} className="tempo-weight-glaze" />
          {BAGEL_SEEDS.map(([dx, dy], i) => (
            <ellipse key={i} cx={cx + dx} cy={cy + dy} rx={1.1} ry={0.65} className="tempo-weight-seed" />
          ))}
        </>
      );
  }
}

/**
 * The weight on the pendulum rod — dragging it slides it along the rod
 * exactly like a real mechanical metronome (toward the pivot for a faster
 * tempo, toward the tip for slower). Its shape carries the current
 * brainwave band's mood (see renderWeightShape) — alpha keeps the
 * original bagel, the other four bands get their own silhouette. Purely
 * a drag handle now: the medallion charm and tap-to-open-picker gesture
 * live on the Pendant component at the arm's tip instead (see Pendant
 * below) — a listener changes their medallion by tapping the charm at the
 * very end of the pendulum, not by touching the weight partway up the rod.
 *
 * Rendered as a child of the arm's rotating <g>, so it swings with the
 * pendulum for free (SVG nested transforms compose) — no extra per-frame
 * code needed. Deliberately positioned on the rod's STRAIGHT center axis,
 * ignoring the snake-wave offset applied to the rod's own rendering (see
 * the rAF loop below) — the weight is a rigid physical slider, not part
 * of the thin rod's own resonance, so it stays put regardless of how wavy
 * the string looks around it.
 */
function TempoWeight({ bpm, onSetBpm, band }: TempoWeightProps) {
  const dragState = useRef<{ startClientX: number; startClientY: number; startBpm: number } | null>(null);

  const t = (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
  const offset = WEIGHT_MAX_OFFSET - t * (WEIGHT_MAX_OFFSET - WEIGHT_MIN_OFFSET);
  const weightY = PIVOT.y + offset;
  const bandInfo = BANDS[band];

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    dragState.current = { startClientX: e.clientX, startClientY: e.clientY, startBpm: bpm };

    function handleMove(ev: PointerEvent) {
      if (!dragState.current) return;
      const totalMove = Math.hypot(ev.clientX - dragState.current.startClientX, ev.clientY - dragState.current.startClientY);
      if (totalMove <= TAP_MOVE_THRESHOLD_PX) return;
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
      <circle cx={PIVOT.x} cy={weightY} r={WEIGHT_HIT_RADIUS} className="tempo-weight-hit-target" />
      {renderWeightShape(band, PIVOT.x, weightY, bandInfo.color)}
    </g>
  );
}

interface PendantProps {
  medallionId: MedallionId;
  onTap: () => void;
  pendantRef: React.Ref<SVGGElement>;
}

/**
 * The charm at the very end of the pendulum arm — tapping it opens the
 * medallion picker. This is the "pendant": a pure click target with no
 * drag concern (unlike the weight above it on the rod), so it follows the
 * same onClick/onKeyDown convention as the eye and pyramid elsewhere in
 * this file (handlePyramidTap/handleEyeTap) rather than TempoWeight's
 * pointer-drag handling.
 */
function Pendant({ medallionId, onTap, pendantRef }: PendantProps) {
  const tipY = PIVOT.y + ARM_LENGTH;
  const color = MEDALLIONS_BY_ID[medallionId].color;
  return (
    <g
      ref={pendantRef}
      className="metronome-pendant"
      role="button"
      tabIndex={0}
      aria-label="Pendulum pendant — tap to change medallion"
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // Without this, the SAME keypress also bubbles to the global
          // Space handler in useKeyboardShortcuts.ts (guarded only by
          // isEditableOrControlFocused(), which an SVG <g role="button">
          // doesn't satisfy) and toggles play/pause at the same time the
          // picker opens/closes.
          e.stopPropagation();
          onTap();
        }
      }}
    >
      <circle cx={PIVOT.x} cy={tipY} r={PENDANT_HIT_RADIUS} className="pendant-hit-target" />
      <g className="pendant-glyph" transform={`translate(${PIVOT.x} ${tipY}) scale(${PENDANT_GLYPH_SCALE}) translate(-50 -50)`}>
        <MedallionGlyph id={medallionId} color={color} />
      </g>
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
  sessionPhase: SessionPlaybackPhase;
  /** Live per-frame read of the session clock, driving the eye's timer
   * ring only — sessionRemainingSec (the polled mm:ss value) stays
   * App-level, feeding only SessionTimer.tsx. */
  sessionRef: React.RefObject<SessionState | null>;
  /** Which tick(s) are currently audible — see TickSubdivision's doc
   * comment in binauralEngine.ts. Drives which of the arm's two wiggle
   * accents (end-arrival, center-crossing) are active — see the
   * `tickSubdivisionRef` comment in the rAF loop below for why this is
   * read via a ref rather than a plain closed-over prop. */
  tickSubdivision: TickSubdivision;
  /** Which medallion currently hangs from the pendant at the arm's tip. */
  selectedMedallionId: MedallionId;
  /** Every medallion the listener has actually earned — see
   * engine/growth.ts's computeUnlockedMedallions(). The picker only ever
   * offers a choice from this list. */
  unlockedMedallionIds: MedallionId[];
  onSelectMedallion: (id: MedallionId) => void;
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
  sessionPhase,
  sessionRef,
  tickSubdivision,
  selectedMedallionId,
  unlockedMedallionIds,
  onSelectMedallion,
}: MetronomeVisualProps) {
  const armRef = useRef<SVGGElement | null>(null);
  const armPathRef = useRef<SVGPathElement | null>(null);
  const pupilRef = useRef<SVGCircleElement | null>(null);
  const timerRingRef = useRef<SVGPathElement | null>(null);
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
  const hasSession = sessionPhase !== 'idle';

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

  // The medallion picker is plain HTML rendered BELOW the SVG, not inside
  // it — the pendant itself lives inside the arm's rotating <g>, and a
  // picker popover that rotated with the pendulum mid-swing would be
  // unusable. Tapping the pendant (see Pendant's onTap) just flips this
  // boolean; the popover's own position is fixed relative to the visual,
  // independent of wherever the pendulum currently is on its swing.
  const [medallionPickerOpen, setMedallionPickerOpen] = useState(false);
  const pendantRef = useRef<SVGGElement | null>(null);

  /** Restores focus to the pendant on close, mirroring the picker's own
   * focus-in-on-open (see MedallionPicker.tsx) — without this, closing via
   * Escape or a selection drops focus to the document body. */
  function closeMedallionPicker() {
    setMedallionPickerOpen(false);
    pendantRef.current?.focus();
  }

  function handleSelectMedallion(id: MedallionId) {
    onSelectMedallion(id);
    closeMedallionPicker();
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
  // than true path morphing. Runs whether playing or idle (per the
  // builder — this one's ongoing character, not an idle tell like the
  // blink above).
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

      // Session-timer ring: fixed 60-min dial, so a 15-min session starts
      // at exactly 90° and shrinks to 0° as time runs out. Reads
      // sessionRef directly (a plain ref, not React state) so this needs
      // no extra effect dependency and never re-triggers the ramp-in —
      // same technique as swingRef above it.
      const session = sessionRef.current;
      if (session && timerRingRef.current) {
        const elapsedSec = now - session.startTimeSec;
        const remainingSec = Math.max(0, session.durationSec - elapsedSec);
        const sweepDeg = clamp(remainingSec / HOUR_DIAL_SEC, 0, 1) * 360;
        timerRingRef.current.setAttribute('d', buildAnnularWedgePathD(sweepDeg, EYE_TIMER_INNER_R, EYE_TIMER_OUTER_R));
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
          <TempoWeight bpm={bpm} onSetBpm={onSetBpm} band={band} />
          <Pendant
            medallionId={selectedMedallionId}
            onTap={() => setMedallionPickerOpen((open) => !open)}
            pendantRef={pendantRef}
          />
        </g>

        <circle cx={PIVOT.x} cy={PIVOT.y} r={5} className="metronome-pivot-dot" />

        <g className={`metronome-eye ${blinking ? 'eye-blink' : ''} ${hasSession ? 'has-session' : ''}`}>
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
          <circle ref={pupilRef} cx={EYE.x} cy={EYE.y} r={9} className="eye-pupil" />

          {/* Session countdown ring — deliberately no numeral here (the
              mm:ss countdown lives only in SessionTimer.tsx). Ticks
              painted first so the translucent ring reads on top of them. */}
          <g className="eye-timer-ticks" aria-hidden="true">
            {EYE_TIMER_TICKS.map((t, i) => (
              <line
                key={i}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                className={`eye-timer-tick ${t.major ? 'eye-timer-tick-major' : ''}`}
              />
            ))}
          </g>
          <path
            ref={timerRingRef}
            className="eye-timer-ring"
            d={buildAnnularWedgePathD(0, EYE_TIMER_INNER_R, EYE_TIMER_OUTER_R)}
            aria-hidden="true"
          />
        </g>
      </svg>
      <p className="tempo-weight-hint">Drag the weight to change tempo, tap the pendant to swap medallions — {bpm} BPM</p>
      {medallionPickerOpen && (
        <MedallionPicker
          unlockedIds={unlockedMedallionIds}
          selectedId={selectedMedallionId}
          onSelect={handleSelectMedallion}
          onClose={closeMedallionPicker}
        />
      )}
    </div>
  );
}
