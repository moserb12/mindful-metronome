import { MEDALLIONS_BY_ID, type MedallionId } from '../../data/medallions';

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
      return (
        <>
          <circle cx={50} cy={50} r={30} fill="none" stroke={color} strokeWidth={2.5} />
          <path d="M50 20 A15 15 0 0 1 50 50 A15 15 0 0 0 50 80 A30 30 0 0 0 50 20 Z" fill={color} />
          <circle cx={50} cy={35} r={5} fill={color} />
          <circle cx={50} cy={65} r={5} fill="none" stroke={color} strokeWidth={2} />
        </>
      );
    case 'flame':
      return (
        <path
          d="M50 14 C63 32, 68 44, 63 56 C72 50, 75 40, 73 30 C83 46, 85 64, 74 78 C65 89, 48 89, 40 78 C32 68, 32 55, 41 48 C38 58, 42 65, 49 65 C57 65, 60 56, 53 47 C46 37, 45 25, 50 14 Z"
          fill={color}
        />
      );
    default:
      return <circle cx={50} cy={50} r={26} fill={color} />;
  }
}

export function MedallionIcon({ id, size = 40, locked = false, className, title }: MedallionIconProps) {
  const def = MEDALLIONS_BY_ID[id];
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
