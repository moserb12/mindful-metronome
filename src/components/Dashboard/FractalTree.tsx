import { generateFractalTree, pickFruitTips, TREE_VIEW } from '../../engine/fractalTree';
import type { MedallionId } from '../../data/medallions';
import { MedallionIcon } from './MedallionIcon';

interface FractalTreeProps {
  /** 0 (seed) .. 1 (fully mature) — see engine/growth.ts's computeGrowth(). */
  growth: number;
  /** Every currently-unlocked medallion, rendered as fruit hanging at the
   * tree's outermost branch tips. Order matters only for WHICH tip each
   * lands on (see pickFruitTips) — it's deterministic, not randomized, so
   * the tree doesn't visually reshuffle itself between renders. */
  unlockedIds: MedallionId[];
  glowColor: string;
}

const CANOPY_COLOR = '#4ade80';

/** Linear color interpolation between the trunk's bark brown and the
 * canopy's leaf green, by depth fraction — so the tree reads as one
 * continuous plant (bark near the base, green further out) rather than
 * uniformly one flat color from root to twig. */
function branchColor(depthFraction: number): string {
  const t = Math.max(0, Math.min(1, depthFraction));
  const from = { r: 0x8b, g: 0x6b, b: 0x4a };
  const to = { r: 0x4a, g: 0xde, b: 0x80 };
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function FractalTree({ growth, unlockedIds, glowColor }: FractalTreeProps) {
  const { branches, tips, maxDepth } = generateFractalTree(growth);
  const fruitTips = pickFruitTips(tips, unlockedIds.length);

  return (
    <svg
      viewBox={`0 0 ${TREE_VIEW} ${TREE_VIEW}`}
      className="fractal-tree"
      role="img"
      aria-label={`Focus tree, ${Math.round(growth * 100)}% grown`}
      style={{ '--tree-glow': glowColor } as React.CSSProperties}
    >
      <ellipse cx={TREE_VIEW / 2} cy={TREE_VIEW - 10} rx={54} ry={8} className="fractal-tree-ground-shadow" />
      <g className="fractal-tree-sway">
        {branches.map((b, i) => (
          <line
            key={i}
            x1={b.x1}
            y1={b.y1}
            x2={b.x2}
            y2={b.y2}
            stroke={branchColor(b.depth / Math.max(1, maxDepth))}
            strokeWidth={Math.max(1.2, 6 - b.depth * 1.1)}
            strokeLinecap="round"
            opacity={0.92}
          />
        ))}
        {tips.map((tip, i) => (
          <circle key={`leaf-${i}`} cx={tip.x} cy={tip.y} r={2.6} fill={CANOPY_COLOR} opacity={0.55} className="fractal-tree-leaf" />
        ))}
        {fruitTips.map((tip, i) => {
          const medallionId = unlockedIds[i];
          if (!medallionId) return null;
          const fruitSize = 22;
          return (
            <g key={`fruit-${medallionId}`} className="fractal-tree-fruit" style={{ animationDelay: `${(i % 7) * 0.35}s` }}>
              <foreignObject x={tip.x - fruitSize / 2} y={tip.y - fruitSize / 2} width={fruitSize} height={fruitSize}>
                <MedallionIcon id={medallionId} size={fruitSize} />
              </foreignObject>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
