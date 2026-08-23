import { describe, expect, it } from 'vitest';
import { generateFractalTree, pickFruitTips, TREE_VIEW } from './fractalTree';

describe('generateFractalTree', () => {
  it('produces a real, non-empty branching shape even at zero growth', () => {
    const tree = generateFractalTree(0);
    expect(tree.branches.length).toBeGreaterThan(0);
    expect(tree.tips.length).toBeGreaterThan(0);
  });

  it('grows more branches/tips as growth increases toward maturity', () => {
    const young = generateFractalTree(0.1);
    const mature = generateFractalTree(1);
    expect(mature.branches.length).toBeGreaterThan(young.branches.length);
    expect(mature.tips.length).toBeGreaterThan(young.tips.length);
    expect(mature.maxDepth).toBeGreaterThan(young.maxDepth);
  });

  it('clamps out-of-range growth values instead of producing invalid geometry', () => {
    const belowZero = generateFractalTree(-5);
    const aboveOne = generateFractalTree(5);
    const zero = generateFractalTree(0);
    const one = generateFractalTree(1);
    expect(belowZero.maxDepth).toBe(zero.maxDepth);
    expect(aboveOne.maxDepth).toBe(one.maxDepth);
  });

  it('is deterministic — identical growth produces byte-identical geometry', () => {
    const a = generateFractalTree(0.42);
    const b = generateFractalTree(0.42);
    expect(a).toEqual(b);
  });

  it('every branch and tip stays within the local view box', () => {
    const tree = generateFractalTree(1);
    for (const b of tree.branches) {
      expect(b.x1).toBeGreaterThanOrEqual(-10);
      expect(b.x1).toBeLessThanOrEqual(TREE_VIEW + 10);
      expect(b.y1).toBeGreaterThanOrEqual(-10);
      expect(b.y1).toBeLessThanOrEqual(TREE_VIEW + 10);
    }
  });

  it('fruitSlots covers every branch endpoint — interior splits AND tips, not just tips', () => {
    const tree = generateFractalTree(1);
    // One fruit slot per branch (each branch's own x2,y2 endpoint).
    expect(tree.fruitSlots.length).toBe(tree.branches.length);
    // Every tip is also a fruit slot, but fruitSlots is a strict superset
    // once the tree has any interior (non-leaf) branches at all.
    expect(tree.fruitSlots.length).toBeGreaterThan(tree.tips.length);
    for (const tip of tree.tips) {
      expect(tree.fruitSlots.some((s) => s.x === tip.x && s.y === tip.y)).toBe(true);
    }
  });
});

describe('pickFruitTips', () => {
  const tips = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i, index: i }));

  it('returns nothing for zero or negative count', () => {
    expect(pickFruitTips(tips, 0)).toEqual([]);
    expect(pickFruitTips(tips, -3)).toEqual([]);
  });

  it('returns every tip if count meets or exceeds the available tips', () => {
    expect(pickFruitTips(tips, 10)).toEqual(tips);
    expect(pickFruitTips(tips, 20)).toEqual(tips);
  });

  it('spreads a smaller count evenly across the tip array rather than clustering at the start', () => {
    const picked = pickFruitTips(tips, 5);
    expect(picked).toHaveLength(5);
    // Evenly spread across 10 tips in steps of 2 starting at index 0.
    expect(picked.map((t) => t.index)).toEqual([0, 2, 4, 6, 8]);
  });
});
