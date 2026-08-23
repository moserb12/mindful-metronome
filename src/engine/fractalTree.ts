// ============================================================================
// fractalTree.ts — pure geometry for the dashboard's growing fractal tree.
// No React, no DOM: `generateFractalTree(growth)` returns plain line
// segments and tip coordinates in a fixed local coordinate space
// (0..TREE_VIEW square), and FractalTree.tsx just maps that straight onto
// SVG <line> elements. Kept separate from growth.ts (which derives the 0..1
// `growth` value FROM real stats) the same way timing.ts's BeatScheduler is
// kept separate from what plays on each beat — this module has zero opinion
// about minutes, medallions, or bands, only about turning one growth number
// into branch geometry.
// ============================================================================

export const TREE_VIEW = 220;

const BASE = { x: TREE_VIEW / 2, y: TREE_VIEW - 14 };
/** Radians, standard math convention (0 = +x/right); straight up is -90°. */
const BASE_ANGLE = -Math.PI / 2;
const BASE_LENGTH = 46;
/** Each child branch is this fraction of its parent's length — the classic
 * self-similar fractal-tree ratio, tuned so 6-7 levels still comfortably
 * fits inside TREE_VIEW without the outermost twigs vanishing to nothing. */
const LENGTH_SCALE = 0.72;
const MIN_DEPTH = 2;
const MAX_DEPTH_AT_FULL_GROWTH = 6;

/** Deterministic pseudo-random in [0, 1) from an integer seed — a single
 * mulberry32-style mix step, no external dependency. Used only for a small
 * angle jitter per branch so the tree reads as organic rather than
 * mechanically symmetric, while staying byte-for-byte IDENTICAL across
 * re-renders for the same growth value (a real `Math.random()` here would
 * make the tree visibly reshuffle itself every time React re-renders the
 * dashboard, which would look broken, not alive). */
function seededRandom(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface TreeBranch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0 = trunk. Used for rendering: thicker/darker stroke near the trunk,
   * thinner near the twigs. */
  depth: number;
}

export interface TreeTip {
  x: number;
  y: number;
  index: number;
}

export interface FractalTree {
  branches: TreeBranch[];
  tips: TreeTip[];
  /** Every branch's endpoint — interior split points AND outer tips alike.
   * Superset of `tips`. This is the pool fruit placement should draw from
   * (see pickFruitSlots) so fruit reads as growing throughout the whole
   * tree rather than clustering only along the outermost edge. */
  fruitSlots: TreeTip[];
  maxDepth: number;
}

/**
 * Turns one 0..1 growth value into a full binary fractal tree. Even at
 * growth 0 this returns a small but real branching shape (MIN_DEPTH = 2),
 * deliberately never a blank canvas — the tree is something to look at
 * from a listener's very first session, not just once they've put in
 * hours.
 */
export function generateFractalTree(growth: number): FractalTree {
  const clamped = Math.max(0, Math.min(1, growth));
  const maxDepth = Math.round(MIN_DEPTH + clamped * (MAX_DEPTH_AT_FULL_GROWTH - MIN_DEPTH));
  // Even a young tree gets a visible trunk (55% length floor) rather than a
  // near-invisible sliver; full growth reaches the full BASE_LENGTH.
  const lengthMultiplier = 0.55 + clamped * 0.45;

  const branches: TreeBranch[] = [];
  const tips: TreeTip[] = [];
  const fruitSlots: TreeTip[] = [];
  let tipIndex = 0;
  let slotIndex = 0;

  function branch(x: number, y: number, angle: number, length: number, depth: number, seed: number) {
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    branches.push({ x1: x, y1: y, x2, y2, depth });

    // Every branch endpoint is a fruit-eligible slot — a split point if it
    // has children, a tip if it doesn't — so fruit can grow throughout the
    // tree's interior, not just along the outermost edge.
    fruitSlots.push({ x: x2, y: y2, index: slotIndex });
    slotIndex += 1;

    if (depth >= maxDepth || length < 4) {
      tips.push({ x: x2, y: y2, index: tipIndex });
      tipIndex += 1;
      return;
    }

    // Two children per branch. Spread narrows slightly with depth (a
    // denser canopy rather than an ever-widening fan); a small seeded
    // jitter on top keeps left/right siblings from looking identically
    // mirrored.
    const spread = 0.5 - depth * 0.02;
    const jitter = (seededRandom(seed) - 0.5) * 0.18;
    const nextLength = length * LENGTH_SCALE;
    branch(x2, y2, angle - spread + jitter, nextLength, depth + 1, seed * 2 + 1);
    branch(x2, y2, angle + spread + jitter, nextLength, depth + 1, seed * 2 + 2);
  }

  branch(BASE.x, BASE.y, BASE_ANGLE, BASE_LENGTH * lengthMultiplier, 0, 1);

  return { branches, tips, fruitSlots, maxDepth };
}

/** Deterministically spreads `count` fruit across a pool of candidate slots
 * (branch-split points and/or tips), evenly stepping through the array
 * rather than always taking the first N (which would cluster every fruit
 * on one side, since the recursion visits "angle minus spread" branches
 * before "angle plus spread" ones at every level). */
export function pickFruitTips(slots: TreeTip[], count: number): TreeTip[] {
  if (count <= 0 || slots.length === 0) return [];
  if (count >= slots.length) return slots;
  const step = slots.length / count;
  const picked: TreeTip[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(slots[Math.floor(i * step)]);
  }
  return picked;
}
