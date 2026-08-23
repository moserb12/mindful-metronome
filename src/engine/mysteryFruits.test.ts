import { describe, expect, it } from 'vitest';
import { MYSTERY_MEDALLIONS } from '../data/mysteryMedallions';
import {
  MAX_MYSTERY_FRUITS,
  mysteryFruitsGrown,
  mysteryFruitThresholds,
  pendingMysteryFruitCount,
  rollMysteryMedallion,
} from './mysteryFruits';

describe('mysteryFruitThresholds', () => {
  it('produces one threshold per fruit, strictly increasing', () => {
    const thresholds = mysteryFruitThresholds();
    expect(thresholds).toHaveLength(MAX_MYSTERY_FRUITS);
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]).toBeGreaterThan(thresholds[i - 1]);
    }
  });

  it('the gap between successive thresholds grows, then caps rather than growing forever', () => {
    const thresholds = mysteryFruitThresholds(10);
    const gaps = thresholds.map((t, i) => (i === 0 ? t : t - thresholds[i - 1]));
    // Early gaps strictly grow ("progressively less often").
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[2]).toBeGreaterThan(gaps[1]);
    // Far enough out, the gap has hit its cap and stops growing.
    const laterThresholds = mysteryFruitThresholds(60);
    const lastGap = laterThresholds[59] - laterThresholds[58];
    const secondLastGap = laterThresholds[58] - laterThresholds[57];
    expect(lastGap).toBeCloseTo(secondLastGap, 5);
  });
});

describe('mysteryFruitsGrown', () => {
  it('is zero before the first threshold', () => {
    expect(mysteryFruitsGrown(0)).toBe(0);
  });

  it('counts exactly how many thresholds have been reached', () => {
    const thresholds = mysteryFruitThresholds();
    expect(mysteryFruitsGrown(thresholds[0])).toBe(1);
    expect(mysteryFruitsGrown(thresholds[0] - 0.01)).toBe(0);
    expect(mysteryFruitsGrown(thresholds[4])).toBe(5);
  });

  it('caps at the full catalogue size for a very large total', () => {
    expect(mysteryFruitsGrown(1_000_000)).toBe(MAX_MYSTERY_FRUITS);
  });
});

describe('pendingMysteryFruitCount', () => {
  it('is the difference between grown and harvested, never negative', () => {
    const thresholds = mysteryFruitThresholds();
    expect(pendingMysteryFruitCount(thresholds[2], 0)).toBe(3);
    expect(pendingMysteryFruitCount(thresholds[2], 2)).toBe(1);
    // Harvested can never legitimately exceed grown, but the function
    // should still never report a negative pending count if it somehow did.
    expect(pendingMysteryFruitCount(thresholds[2], 10)).toBe(0);
  });
});

describe('rollMysteryMedallion', () => {
  it('never returns an id already in ownedIds', () => {
    const owned = new Set(MYSTERY_MEDALLIONS.slice(0, 45).map((m) => m.id));
    for (let i = 0; i < 200; i++) {
      const result = rollMysteryMedallion(owned);
      expect(result).not.toBeNull();
      expect(owned.has(result!)).toBe(false);
    }
  });

  it('returns null once every medallion is already owned', () => {
    const owned = new Set(MYSTERY_MEDALLIONS.map((m) => m.id));
    expect(rollMysteryMedallion(owned)).toBeNull();
  });

  it('always returns a real catalogue id when the pool is non-empty', () => {
    const validIds = new Set(MYSTERY_MEDALLIONS.map((m) => m.id));
    const result = rollMysteryMedallion(new Set());
    expect(result).not.toBeNull();
    expect(validIds.has(result!)).toBe(true);
  });

  it('over many rolls, common items come up far more often than legendary ones', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const id = rollMysteryMedallion(new Set())!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    const commonTotal = MYSTERY_MEDALLIONS.filter((m) => m.rarity === 'common').reduce((s, m) => s + (counts[m.id] ?? 0), 0);
    const legendaryTotal = MYSTERY_MEDALLIONS.filter((m) => m.rarity === 'legendary').reduce((s, m) => s + (counts[m.id] ?? 0), 0);
    expect(commonTotal).toBeGreaterThan(legendaryTotal * 20);
  });
});
