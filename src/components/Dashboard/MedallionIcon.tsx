import { useEffect, useRef } from 'react';
import { ALL_MEDALLIONS_BY_ID, type MedallionId } from '../../data/medallions';
import { MYSTERY_MEDALLIONS_BY_ID, type MysteryGlyphSpec, type MysteryMedallionId } from '../../data/mysteryMedallions';

// ============================================================================
// MedallionIcon — one shared glyph renderer for every collectible, used
// both in the dashboard's collection grid and (small) as the swappable
// charm on the pendant at the pendulum's tip. Every glyph is hand-built from
// plain SVG primitives in a fixed 0..100 local viewBox, matching this app's
// existing "thin strokes, glowing color, no external assets" visual
// language (the pyramid outline, neuron nodes, eye) rather than pulling in
// an icon font or emoji, which would read as a foreign style dropped on
// top of the quantum-metronome instrument.
// ============================================================================

interface MedallionIconProps {
  id: MedallionId;
  size?: number;
  /** Renders the glyph muted/gray with a dashed ring instead of its real
   * color — "you haven't earned this yet," without needing a second
   * overlay icon. The surrounding UI is expected to also show the unlock
   * requirement as text; this alone only signals "not yet." */
  locked?: boolean;
  className?: string;
  title?: string;
}

function circleSubpath(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

function starPath(cx: number, cy: number, outerR: number, innerR: number, points: number, startDeg = -90): string {
  const step = 180 / points;
  const cmds: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const rad = ((startDeg + step * i) * Math.PI) / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    cmds.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${cmds.join(' ')} Z`;
}

/** Archimedean spiral, sampled into a polyline — used by theta's band orb
 * (meditative, trance-like). */
function spiralPathD(cx: number, cy: number, turns: number, maxR: number, steps = 60): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * 2 * Math.PI;
    const r = t * maxR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/** A true lemniscate of Gerono (figure-8 / "∞") — used by alpha's band
 * orb, a literal math symbol for continuous flow. */
function infinityPathD(cx: number, cy: number, scale: number, steps = 80): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const denom = 1 + Math.sin(t) * Math.sin(t);
    const x = cx + (scale * Math.cos(t)) / denom;
    const y = cy + (scale * Math.sin(t) * Math.cos(t)) / denom;
    pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${pts.join(' ')} Z`;
}

/** Regular n-gon vertices, in the shared 0..100 local space — shared root
 * for both sigilPath (outline) and the gem/lattice families below (which
 * need the raw points, not just a path string, to draw facet/interlock
 * lines from each vertex). */
function polygonPoints(cx: number, cy: number, r: number, sides: number, startDeg = -90): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const rad = ((startDeg + (360 / sides) * i) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
  }
  return pts;
}

function polygonPathD(pts: { x: number; y: number }[]): string {
  return `M ${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')} Z`;
}

/** A cluster of thin triangular shards radiating from a small inner ring —
 * used by the "shard" mystery family. Alternates long/short shard length
 * so the cluster reads as shattered/uneven rather than a uniform star. */
function shardClusterPathD(cx: number, cy: number, n: number, outerR: number, innerR: number, startDeg = -90): string {
  const halfAngleDeg = 180 / n / 2.2;
  const subpaths: string[] = [];
  for (let i = 0; i < n; i++) {
    const lengthMul = i % 2 === 0 ? 1 : 0.7;
    const tipR = innerR + (outerR - innerR) * lengthMul;
    const centerDeg = startDeg + (360 / n) * i;
    const aRad = ((centerDeg - halfAngleDeg) * Math.PI) / 180;
    const bRad = ((centerDeg + halfAngleDeg) * Math.PI) / 180;
    const tipRad = (centerDeg * Math.PI) / 180;
    const ax = cx + innerR * Math.cos(aRad);
    const ay = cy + innerR * Math.sin(aRad);
    const bx = cx + innerR * Math.cos(bRad);
    const by = cy + innerR * Math.sin(bRad);
    const tx = cx + tipR * Math.cos(tipRad);
    const ty = cy + tipR * Math.sin(tipRad);
    subpaths.push(`M ${ax.toFixed(2)} ${ay.toFixed(2)} L ${tx.toFixed(2)} ${ty.toFixed(2)} L ${bx.toFixed(2)} ${by.toFixed(2)} Z`);
  }
  return subpaths.join(' ');
}

const PETAL_PATH_D = 'M50 50 C58 42 58 24 50 14 C42 24 42 42 50 50 Z';
const WISP_PATH_D = 'M20 70 C35 30 65 70 80 30';

/**
 * Renders one mystery medallion's glyph from its `MysteryGlyphSpec` —
 * 10 shape "families," each a small parametric generator (n/n2/rotation
 * knobs) rather than 50 individually hand-authored paths, the same
 * "shared generator, varied parameters" approach starPath/spiralPathD/
 * SnowflakeArm already use elsewhere in this file. See
 * data/mysteryMedallions.ts's file comment for why.
 */
function MysteryGlyph({ spec, color }: { spec: MysteryGlyphSpec; color: string }) {
  const { family, n, n2, rotation = 0 } = spec;
  switch (family) {
    case 'bloom': {
      const petals = n ?? 6;
      return (
        <>
          {Array.from({ length: petals }).map((_, i) => (
            <path key={i} d={PETAL_PATH_D} fill={color} opacity={0.85} transform={`rotate(${rotation + (360 / petals) * i} 50 50)`} />
          ))}
          <circle cx={50} cy={50} r={6} fill={color} />
        </>
      );
    }
    case 'sigil': {
      const sides = n ?? 5;
      const pts = polygonPoints(50, 50, 28, sides, -90 + rotation);
      return (
        <>
          <path d={polygonPathD(pts)} fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" />
          {sides <= 4 ? (
            <line x1={50} y1={26} x2={50} y2={74} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
          ) : (
            <circle cx={50} cy={50} r={4} fill={color} />
          )}
        </>
      );
    }
    case 'gem': {
      const sides = n ?? 5;
      const pts = polygonPoints(50, 50, 28, sides, -90 + rotation);
      return (
        <>
          <path d={polygonPathD(pts)} fill={color} opacity={0.88} />
          {n2 ? pts.map((p, i) => <line key={i} x1={50} y1={50} x2={p.x} y2={p.y} stroke="rgba(5,5,10,0.35)" strokeWidth={1.5} />) : null}
        </>
      );
    }
    case 'coil': {
      const turns = (n ?? 15) / 10;
      return (
        <>
          <path
            d={spiralPathD(50, 50, turns, 32)}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            transform={rotation ? `rotate(${rotation} 50 50)` : undefined}
          />
          {n2 === 2 && (
            <path
              d={spiralPathD(50, 50, turns, 32)}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.5}
              transform={`rotate(${180 + rotation} 50 50)`}
            />
          )}
        </>
      );
    }
    case 'wisp': {
      const strands = n ?? 1;
      return (
        <g transform={rotation ? `rotate(${rotation} 50 50)` : undefined}>
          {Array.from({ length: strands }).map((_, i) => (
            <path
              key={i}
              d={WISP_PATH_D}
              fill="none"
              stroke={color}
              strokeWidth={4 - i}
              strokeLinecap="round"
              opacity={1 - i * 0.28}
              transform={i ? `translate(0 ${i * 7})` : undefined}
            />
          ))}
        </g>
      );
    }
    case 'ring': {
      const rings = n ?? 2;
      return (
        <>
          {Array.from({ length: rings }).map((_, i) => {
            const r = rings <= 1 ? 24 : 14 + i * ((34 - 14) / (rings - 1));
            const circumference = 2 * Math.PI * r;
            return (
              <circle
                key={i}
                cx={50}
                cy={50}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeDasharray={`${circumference * 0.62} ${circumference * 0.38}`}
                transform={`rotate(${rotation + i * 47} 50 50)`}
              />
            );
          })}
        </>
      );
    }
    case 'shard':
      return <path d={shardClusterPathD(50, 50, n ?? 6, 34, 10, -90 + rotation)} fill={color} />;
    case 'comet': {
      const rad = (rotation * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const headR = 12;
      const dotCount = n ?? 4;
      return (
        <>
          {Array.from({ length: dotCount }).map((_, i) => {
            const t = i + 1;
            const dist = 14 + t * 11;
            const r = Math.max(2, headR * 0.55 - t * 1.6);
            return <circle key={i} cx={50 - dx * dist} cy={50 - dy * dist} r={r} fill={color} opacity={0.55 - i * 0.08} />;
          })}
          <circle cx={50 + dx * 14} cy={50 + dy * 14} r={headR} fill={color} />
        </>
      );
    }
    case 'lattice': {
      const sides = n ?? 3;
      return (
        <>
          <path d={polygonPathD(polygonPoints(50, 50, 30, sides, -90 + rotation))} fill="none" stroke={color} strokeWidth={2.5} />
          <path
            d={polygonPathD(polygonPoints(50, 50, 30, sides, -90 + rotation + 180 / sides))}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
          />
        </>
      );
    }
    case 'physics':
      return <DoublePendulumGlyph color={color} />;
    case 'eye':
    default: {
      const lashCount = n ?? 6;
      return (
        <>
          <path d="M14 50 Q50 22 86 50 Q50 78 14 50 Z" fill="none" stroke={color} strokeWidth={3.5} />
          <circle cx={50} cy={50} r={13} fill={color} />
          <circle cx={50} cy={50} r={5} fill="rgba(5,5,10,0.55)" />
          {Array.from({ length: lashCount }).map((_, i) => {
            const t = lashCount <= 1 ? 0 : (i / (lashCount - 1)) * 2 - 1;
            const x = 50 + t * 32;
            const y = 50 - Math.sqrt(Math.max(0, 1 - t * t)) * 26 - 2;
            return <line key={i} x1={x} y1={y} x2={x} y2={y - 8} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.7} />;
          })}
          {n2 ? <circle cx={50} cy={50} r={22} fill="none" stroke={color} strokeWidth={1.2} opacity={0.4} /> : null}
        </>
      );
    }
  }
}

/** Fixed pivot + rod lengths for the double-pendulum glyph, in the same
 * shared 0..100 local space every other glyph uses. Pivot sits above local
 * center (50,50) so the pendulum hangs mostly downward, like the real one
 * this app is built around. Worst-case reach from the pivot is
 * PENDULUM_L1 + PENDULUM_L2 = 26, so the furthest the bobs can ever get
 * from local center (50,50) is PENDULUM_PIVOT_OFFSET_Y + 26 = 34 — inside
 * the ~36-39-unit envelope the largest other glyphs already use, so this
 * clears the badge circle (r=47) and the pendant's clipping margin with
 * room to spare (see PENDANT_GLYPH_SCALE's doc comment in
 * MetronomeVisual.tsx) at any point in its motion. */
const PENDULUM_PIVOT_OFFSET_Y = 8;
const PENDULUM_PIVOT = { x: 50, y: 50 - PENDULUM_PIVOT_OFFSET_Y };
const PENDULUM_L1 = 14;
const PENDULUM_L2 = 12;
/** Tuned by feel, not physically calibrated — chosen so the natural
 * oscillation period (~sqrt(l/g)) lands around a second or so at this
 * glyph's rod lengths: fast enough to visibly read as "moving" even at a
 * small icon size, slow enough not to look like frantic jitter. */
const PENDULUM_G = 320;
/** Sub-steps per animation frame — a plain double pendulum's equations of
 * motion are stiff enough that a single large Euler step per frame (at
 * ~16ms) visibly drifts/destabilizes; a handful of smaller sub-steps
 * keeps the same simple integrator stable without needing anything
 * fancier (RK4, adaptive step size) for what's ultimately a decorative
 * glyph, not a physics engine. */
const PENDULUM_SUBSTEPS = 6;

interface PendulumState {
  a1: number;
  a2: number;
  w1: number;
  w2: number;
}

/**
 * One semi-implicit-Euler step of the classic equal-point-mass double
 * pendulum equations of motion (angles measured from straight down,
 * standard formulation — see e.g. the "Double pendulum" derivation on
 * Wikipedia). Mutates `s` in place; called several times per animation
 * frame with a small `dt` (see PENDULUM_SUBSTEPS) rather than once with
 * the full frame time, for stability.
 */
function integrateDoublePendulum(s: PendulumState, dt: number): void {
  const g = PENDULUM_G;
  const l1 = PENDULUM_L1;
  const l2 = PENDULUM_L2;
  const delta = s.a1 - s.a2;
  const den = 3 - Math.cos(2 * delta); // 2*m1+m2-m2*cos(2*delta) with m1=m2=1 (2*1+1=3)

  const num1 =
    -3 * g * Math.sin(s.a1) - g * Math.sin(s.a1 - 2 * s.a2) - 2 * Math.sin(delta) * (s.w2 * s.w2 * l2 + s.w1 * s.w1 * l1 * Math.cos(delta));
  const alpha1 = num1 / (l1 * den);

  const num2 = 2 * Math.sin(delta) * (2 * s.w1 * s.w1 * l1 + 2 * g * Math.cos(s.a1) + s.w2 * s.w2 * l2 * Math.cos(delta));
  const alpha2 = num2 / (l2 * den);

  s.w1 += alpha1 * dt;
  s.w2 += alpha2 * dt;
  s.a1 += s.w1 * dt;
  s.a2 += s.w2 * dt;
}

/**
 * The one mystery glyph that's genuinely simulated rather than a static
 * (or CSS-looped) shape — a real double pendulum, angles measured from
 * straight DOWN so it hangs and swings the same way the app's own main
 * pendulum does. Reads and writes SVG attributes directly via refs every
 * animation frame instead of React state, the same "bypass re-renders for
 * high-frequency updates" technique MetronomeVisual.tsx's own pendulum
 * already uses for its pupil-tracking and timer ring.
 *
 * Each mounted instance runs its own independent rAF loop and starts from
 * a slightly off-vertical, asymmetric pose (never hangs motionless at a
 * symmetric equilibrium) — chaotic from frame one, and since two
 * instances essentially never start from the exact same floating-point
 * angle, no two renders of this glyph trace the same path anyway.
 */
function DoublePendulumGlyph({ color }: { color: string }) {
  const rod1Ref = useRef<SVGLineElement | null>(null);
  const rod2Ref = useRef<SVGLineElement | null>(null);
  const bob1Ref = useRef<SVGCircleElement | null>(null);
  const bob2Ref = useRef<SVGCircleElement | null>(null);
  const stateRef = useRef<PendulumState>({ a1: Math.PI / 2 + 0.4, a2: Math.PI / 2 - 0.15, w1: 0, w2: 0 });

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return; // Freeze at the initial pose — no motion to opt out of.

    let raf = 0;
    let lastTime: number | null = null;

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (lastTime === null) {
        lastTime = now;
        return;
      }
      const dtSec = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const s = stateRef.current;
      const dtStep = dtSec / PENDULUM_SUBSTEPS;
      for (let i = 0; i < PENDULUM_SUBSTEPS; i++) integrateDoublePendulum(s, dtStep);

      const x1 = PENDULUM_PIVOT.x + PENDULUM_L1 * Math.sin(s.a1);
      const y1 = PENDULUM_PIVOT.y + PENDULUM_L1 * Math.cos(s.a1);
      const x2 = x1 + PENDULUM_L2 * Math.sin(s.a2);
      const y2 = y1 + PENDULUM_L2 * Math.cos(s.a2);

      rod1Ref.current?.setAttribute('x2', String(x1));
      rod1Ref.current?.setAttribute('y2', String(y1));
      rod2Ref.current?.setAttribute('x1', String(x1));
      rod2Ref.current?.setAttribute('y1', String(y1));
      rod2Ref.current?.setAttribute('x2', String(x2));
      rod2Ref.current?.setAttribute('y2', String(y2));
      bob1Ref.current?.setAttribute('cx', String(x1));
      bob1Ref.current?.setAttribute('cy', String(y1));
      bob2Ref.current?.setAttribute('cx', String(x2));
      bob2Ref.current?.setAttribute('cy', String(y2));
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <circle cx={PENDULUM_PIVOT.x} cy={PENDULUM_PIVOT.y} r={2} fill={color} opacity={0.6} />
      <line
        ref={rod1Ref}
        x1={PENDULUM_PIVOT.x}
        y1={PENDULUM_PIVOT.y}
        x2={PENDULUM_PIVOT.x}
        y2={PENDULUM_PIVOT.y + PENDULUM_L1}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <line
        ref={rod2Ref}
        x1={PENDULUM_PIVOT.x}
        y1={PENDULUM_PIVOT.y + PENDULUM_L1}
        x2={PENDULUM_PIVOT.x}
        y2={PENDULUM_PIVOT.y + PENDULUM_L1 + PENDULUM_L2}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <circle ref={bob1Ref} cx={PENDULUM_PIVOT.x} cy={PENDULUM_PIVOT.y + PENDULUM_L1} r={4} fill={color} />
      <circle ref={bob2Ref} cx={PENDULUM_PIVOT.x} cy={PENDULUM_PIVOT.y + PENDULUM_L1 + PENDULUM_L2} r={5} fill={color} />
    </>
  );
}

/** A small handful of the rarer mystery medallions get simple, purely
 * CSS-driven movement — a slow spin, a gentle sway, an occasional blink —
 * picked to loosely echo each one's own shape (a coil slowly turning, an
 * eye blinking) rather than one generic effect applied everywhere. Kept to
 * a deliberate few, and only the rarer tiers, so movement itself reads as
 * part of what makes a pull special rather than background noise across
 * all 51 icons. See the matching classes in index.css, all guarded by
 * prefers-reduced-motion like every other animation in this app.
 *
 * Rule, made explicit after an earlier pass left it inconsistent: within
 * any family that has movement at all, EVERY rare-and-above member of that
 * family gets it too — not just one representative item. The first pass
 * missed this (Deep Coil/rare moved but Dream Coil/epic sat still right
 * next to it in the grid), which read as broken rather than intentional.
 * Paired members of the same family reuse the SAME animation type but
 * lean on the two directional variants (spin/spin-reverse) or a different
 * existing type where that fits better, so two family-mates sitting next
 * to each other in the grid read as related, not identical. */
const MYSTERY_ANIMATION_CLASS: Partial<Record<MysteryMedallionId, string>> = {
  // bloom
  'mystery-nightbloom': 'mystery-anim-drift', // rare
  'mystery-solstice-bloom': 'mystery-anim-sway', // epic
  // coil
  'mystery-deep-coil': 'mystery-anim-spin', // rare
  'mystery-dream-coil': 'mystery-anim-spin-reverse', // epic — counter-rotates against Deep Coil
  // ring
  'mystery-echo-ring': 'mystery-anim-spin', // rare
  'mystery-far-halo': 'mystery-anim-spin-reverse', // rare — counter-rotates against Echo Ring
  // comet
  'mystery-silver-comet': 'mystery-anim-sway', // rare
  'mystery-long-tail-comet': 'mystery-anim-drift', // epic
  // eye (legendary tier — both members)
  'mystery-third-eye': 'mystery-anim-blink',
  'mystery-singularity': 'mystery-anim-spin',
};

const LOCKED_COLOR = '#5b6472';

/** Radius of the circular badge drawn behind every medallion's glyph, in
 * the shared 0..100 local viewBox — exported so the pendant
 * (MetronomeVisual.tsx) can reuse the exact same badge and, critically,
 * anchor itself to the badge's own TOP point rather than to the glyph's
 * local center. Every glyph's silhouette varies (some symmetric, some
 * not — flame, crescent-moon, and the spiral orb all have a bounding-box
 * center that differs from local (50,50)), but the badge circle is
 * identical for all of them, so anchoring by "top of a fixed r=47 circle
 * centered at (50,50)" is what actually guarantees every medallion hangs
 * from the same consistent point, unlike anchoring by each glyph's own
 * (inconsistent) geometry. */
export const MEDALLION_BADGE_RADIUS = 47;

function SnowflakeArm({ deg, color }: { deg: number; color: string }) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x1 = 50 - 30 * cos;
  const y1 = 50 - 30 * sin;
  const x2 = 50 + 30 * cos;
  const y2 = 50 + 30 * sin;
  // A small V-shaped branch near each outer end, perpendicular to the arm.
  const perpX = -sin;
  const perpY = cos;
  const branch = (t: number, side: 1 | -1) => {
    const bx = 50 + (30 * t) * cos;
    const by = 50 + (30 * t) * sin;
    return `M ${bx.toFixed(2)} ${by.toFixed(2)} L ${(bx + perpX * 6 * side).toFixed(2)} ${(by + perpY * 6 * side).toFixed(2)}`;
  };
  return (
    <g stroke={color} strokeWidth={3.5} strokeLinecap="round" fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <path d={branch(0.62, 1)} />
      <path d={branch(0.62, -1)} />
      <path d={branch(-0.62, 1)} />
      <path d={branch(-0.62, -1)} />
    </g>
  );
}

/**
 * Every medallion's glyph, shared by MedallionIcon (the dashboard grid,
 * the picker popover, and the fractal tree's fruit — all via the badged
 * <MedallionIcon>) and, unbadged and scaled up, by the pendant on the
 * pendulum's tip (Pendant in MetronomeVisual.tsx) — so a redesign here
 * improves every one of those displays at once.
 *
 * The 5 band orbs get their own distinct, math-symbol/popular-glyph
 * shape per band, echoing (without duplicating) the same per-band
 * character TempoWeight's shapes already establish — delta=hourglass
 * (stillness), theta=spiral (meditative), alpha=infinity (flow),
 * beta=target (focus), gamma=atom (energy/clarity). They're also the
 * ONLY medallions actually anchored to a specific vibe (the 10
 * milestone glyphs below are cumulative across all bands by design),
 * so they're the correct, narrowly-scoped target for vibe-relevant
 * shapes — the 10 milestones already have real, distinct hand-authored
 * glyphs and don't need redesigning.
 */
export function MedallionGlyph({ id, color }: { id: MedallionId; color: string }) {
  if (id.startsWith('mystery-')) {
    const def = MYSTERY_MEDALLIONS_BY_ID[id as MysteryMedallionId];
    const glyph = <MysteryGlyph spec={def.glyph} color={color} />;
    const animClass = MYSTERY_ANIMATION_CLASS[id as MysteryMedallionId];
    return animClass ? <g className={animClass}>{glyph}</g> : glyph;
  }

  if (id.endsWith('-orb')) {
    switch (id) {
      case 'delta-orb': // Hourglass — stillness, deep rest
        return (
          <>
            <path d="M28 20 L72 20 L50 50 Z M28 80 L72 80 L50 50 Z" fill={color} />
            <line x1={24} y1={20} x2={76} y2={20} stroke={color} strokeWidth={4} strokeLinecap="round" />
            <line x1={24} y1={80} x2={76} y2={80} stroke={color} strokeWidth={4} strokeLinecap="round" />
          </>
        );
      case 'theta-orb': // Spiral — meditative, trance-like
        return <path d={spiralPathD(50, 50, 2.25, 30)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />;
      case 'alpha-orb': // Infinity — continuous flow
        return <path d={infinityPathD(50, 50, 30)} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" />;
      case 'beta-orb': // Target — focus
        return (
          <>
            <circle cx={50} cy={50} r={30} fill="none" stroke={color} strokeWidth={4} />
            <circle cx={50} cy={50} r={19} fill="none" stroke={color} strokeWidth={4} />
            <circle cx={50} cy={50} r={8} fill={color} />
          </>
        );
      case 'gamma-orb': // Atom — energy, peak clarity
      default:
        return (
          <>
            <circle cx={50} cy={50} r={7} fill={color} />
            <ellipse cx={50} cy={50} rx={30} ry={12} fill="none" stroke={color} strokeWidth={3} />
            <ellipse cx={50} cy={50} rx={30} ry={12} fill="none" stroke={color} strokeWidth={3} transform="rotate(60 50 50)" />
            <ellipse cx={50} cy={50} rx={30} ry={12} fill="none" stroke={color} strokeWidth={3} transform="rotate(120 50 50)" />
          </>
        );
    }
  }

  switch (id) {
    case 'spark':
      return <path d="M50 16 L58 42 L84 50 L58 58 L50 84 L42 58 L16 50 L42 42 Z" fill={color} />;
    case 'star':
      return <path d={starPath(50, 50, 30, 13, 5)} fill={color} />;
    case 'raindrop':
      return (
        <path
          d="M50 16 C66 38, 75 53, 75 64 C75 78.5, 64 85, 50 85 C36 85, 25 78.5, 25 64 C25 53, 34 38, 50 16 Z"
          fill={color}
        />
      );
    case 'crescent-moon':
      return <path fillRule="evenodd" fill={color} d={`${circleSubpath(50, 50, 28)} ${circleSubpath(63, 41, 23)}`} />;
    case 'sun':
      return (
        <>
          <circle cx={50} cy={50} r={16} fill={color} />
          {Array.from({ length: 8 }).map((_, i) => {
            const rad = ((i * 45) * Math.PI) / 180;
            const x1 = 50 + 22 * Math.cos(rad);
            const y1 = 50 + 22 * Math.sin(rad);
            const x2 = 50 + 32 * Math.cos(rad);
            const y2 = 50 + 32 * Math.sin(rad);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={4} strokeLinecap="round" />;
          })}
        </>
      );
    case 'lightbulb':
      return (
        <>
          <line x1={50} y1={12} x2={50} y2={20} stroke={color} strokeWidth={3} strokeLinecap="round" />
          <circle cx={50} cy={44} r={22} fill="none" stroke={color} strokeWidth={4} />
          <path d="M40 60 L60 60 L60 68 Q60 76 52 76 L48 76 Q40 76 40 68 Z" fill={color} />
          <line x1={44} y1={82} x2={56} y2={82} stroke={color} strokeWidth={3} strokeLinecap="round" />
          <line x1={46} y1={88} x2={54} y2={88} stroke={color} strokeWidth={3} strokeLinecap="round" />
        </>
      );
    case 'leaf':
      return (
        <>
          <path d="M50 16 C75 22, 84 46, 67 67 C56 80, 39 83, 24 78 C21 55, 29 29, 50 16 Z" fill={color} />
          <path d="M50 22 C43 40, 36 59, 27 77" stroke="rgba(5,5,10,0.3)" strokeWidth={2} fill="none" strokeLinecap="round" />
        </>
      );
    case 'snowflake':
      return (
        <>
          <SnowflakeArm deg={0} color={color} />
          <SnowflakeArm deg={60} color={color} />
          <SnowflakeArm deg={120} color={color} />
        </>
      );
    case 'yin-yang':
      // The lower dot sits INSIDE the filled swoosh, not the empty half —
      // drawing it as a same-color outline (the original approach) put a
      // color={color} ring on top of a color={color} fill, indistinguishable
      // from its own background and effectively invisible. Real yin-yang
      // dots are a genuine cutout of the opposite shade; the closest
      // single-color equivalent is a true hole through the swoosh (evenodd,
      // same circleSubpath technique the crescent-moon glyph already uses)
      // so the badge's own background shows through, exactly like the
      // upper (empty-half) region already does.
      return (
        <>
          <circle cx={50} cy={50} r={30} fill="none" stroke={color} strokeWidth={2.5} />
          <path
            fillRule="evenodd"
            fill={color}
            d={`M50 20 A15 15 0 0 1 50 50 A15 15 0 0 0 50 80 A30 30 0 0 0 50 20 Z ${circleSubpath(50, 65, 5)}`}
          />
          <circle cx={50} cy={35} r={5} fill={color} />
        </>
      );
    case 'flame':
      return (
        <path
          d="M50 14 C63 32, 68 44, 63 56 C72 50, 75 40, 73 30 C83 46, 85 64, 74 78 C65 89, 48 89, 40 78 C32 68, 32 55, 41 48 C38 58, 42 65, 49 65 C57 65, 60 56, 53 47 C46 37, 45 25, 50 14 Z"
          fill={color}
        />
      );
    case 'question-mark':
      // Hand-drawn hook + dot, matching this file's "no icon fonts" rule —
      // the reward for harvesting 10 mystery fruits IS a literal question
      // mark, per the builder's own ask.
      return (
        <>
          <path d="M32 34 Q32 16 50 16 Q68 16 68 34 Q68 48 54 54 Q50 56 50 64" stroke={color} strokeWidth={8} strokeLinecap="round" fill="none" />
          <circle cx={50} cy={80} r={6} fill={color} />
        </>
      );
    default:
      return <circle cx={50} cy={50} r={26} fill={color} />;
  }
}

export function MedallionIcon({ id, size = 40, locked = false, className, title }: MedallionIconProps) {
  const def = ALL_MEDALLIONS_BY_ID[id];
  const color = locked ? LOCKED_COLOR : def.color;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`medallion-icon ${locked ? 'medallion-icon-locked' : ''} ${className ?? ''}`}
      role="img"
      aria-label={title ?? def.name}
    >
      <title>{title ?? def.name}</title>
      <circle
        cx={50}
        cy={50}
        r={MEDALLION_BADGE_RADIUS}
        fill="rgba(8, 10, 20, 0.35)"
        stroke={color}
        strokeWidth={locked ? 2 : 2.5}
        strokeDasharray={locked ? '4 5' : undefined}
        opacity={locked ? 0.55 : 0.9}
      />
      <g opacity={locked ? 0.4 : 1}>
        <MedallionGlyph id={id} color={color} />
      </g>
    </svg>
  );
}
