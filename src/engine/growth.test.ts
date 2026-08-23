import { describe, expect, it } from 'vitest';
import { bandOrbId } from '../data/medallions';
import {
  computeGrowth,
  computeStreak,
  computeUnlockedMedallions,
  currentTreeStage,
  dateKeyFor,
  emptySecondsByBand,
  isMedallionUnlocked,
  totalMinutesAllBands,
  WATER_THRESHOLD_SEC,
  type FocusStats,
} from './growth';

function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

describe('dateKeyFor', () => {
  it('formats a local date as YYYY-MM-DD, zero-padded', () => {
    expect(dateKeyFor(day(2026, 8, 3))).toBe('2026-08-03');
    expect(dateKeyFor(day(2026, 12, 31))).toBe('2026-12-31');
  });
});

describe('computeStreak', () => {
  it('is zero with no history at all', () => {
    const streak = computeStreak({}, day(2026, 8, 22));
    expect(streak).toEqual({ current: 0, longest: 0, wateredToday: false });
  });

  it('counts today if watered today', () => {
    const streak = computeStreak({ '2026-08-22': WATER_THRESHOLD_SEC }, day(2026, 8, 22));
    expect(streak.wateredToday).toBe(true);
    expect(streak.current).toBe(1);
  });

  it('a day below the watering threshold does not count', () => {
    const streak = computeStreak({ '2026-08-22': WATER_THRESHOLD_SEC - 1 }, day(2026, 8, 22));
    expect(streak.wateredToday).toBe(false);
    expect(streak.current).toBe(0);
  });

  it('counts a streak still in progress from yesterday even if today is not yet watered', () => {
    const dailySeconds = {
      '2026-08-20': WATER_THRESHOLD_SEC,
      '2026-08-21': WATER_THRESHOLD_SEC,
    };
    const streak = computeStreak(dailySeconds, day(2026, 8, 22));
    expect(streak.wateredToday).toBe(false);
    expect(streak.current).toBe(2);
  });

  it('resets the current streak once more than a day has passed since the last watered day', () => {
    const dailySeconds = { '2026-08-18': WATER_THRESHOLD_SEC };
    // Neither today (08-21) nor yesterday (08-20) was watered — the streak
    // from 08-18 is well and truly broken, not just "in progress."
    const streak = computeStreak(dailySeconds, day(2026, 8, 21));
    expect(streak.current).toBe(0);
  });

  it('tracks the longest run separately from the current one, across a gap', () => {
    const dailySeconds = {
      '2026-08-01': WATER_THRESHOLD_SEC,
      '2026-08-02': WATER_THRESHOLD_SEC,
      '2026-08-03': WATER_THRESHOLD_SEC,
      '2026-08-04': WATER_THRESHOLD_SEC,
      '2026-08-05': WATER_THRESHOLD_SEC,
      // gap
      '2026-08-20': WATER_THRESHOLD_SEC,
      '2026-08-21': WATER_THRESHOLD_SEC,
    };
    const streak = computeStreak(dailySeconds, day(2026, 8, 22));
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(5);
  });

  it('longest never drops below the current run', () => {
    const dailySeconds = {
      '2026-08-20': WATER_THRESHOLD_SEC,
      '2026-08-21': WATER_THRESHOLD_SEC,
      '2026-08-22': WATER_THRESHOLD_SEC,
    };
    const streak = computeStreak(dailySeconds, day(2026, 8, 22));
    expect(streak.longest).toBe(3);
    expect(streak.current).toBe(3);
  });
});

describe('growth / tree stage', () => {
  it('is 0 at zero minutes and clamps at 1 for very large totals', () => {
    expect(computeGrowth(0)).toBe(0);
    expect(computeGrowth(1_000_000)).toBe(1);
  });

  it('is proportional between the two extremes', () => {
    expect(computeGrowth(600)).toBeCloseTo(0.5, 5);
  });

  it('currentTreeStage picks the highest stage reached, not overshooting', () => {
    expect(currentTreeStage(0).key).toBe('seed');
    expect(currentTreeStage(4.9).key).toBe('seed');
    expect(currentTreeStage(5).key).toBe('sprout');
    expect(currentTreeStage(59).key).toBe('sapling');
    expect(currentTreeStage(600).key).toBe('ancient-tree');
    expect(currentTreeStage(10_000).key).toBe('ancient-tree');
  });
});

describe('medallion unlocks', () => {
  function statsWith(overrides: Partial<FocusStats['totalSecondsByBand']>): FocusStats {
    return { totalSecondsByBand: { ...emptySecondsByBand(), ...overrides }, dailySeconds: {} };
  }

  it('the default medallion is always unlocked, even with zero history', () => {
    const stats = statsWith({});
    const streak = computeStreak(stats.dailySeconds, day(2026, 1, 1));
    const spark = { id: 'spark', name: 'Spark', blurb: '', color: '#fff', unlock: { type: 'default' } } as const;
    expect(isMedallionUnlocked(spark, stats, streak)).toBe(true);
  });

  it('a band orb unlocks once that band alone reaches the threshold, independent of other bands', () => {
    const stats = statsWith({ alpha: 10 * 60, delta: 0 });
    const streak = computeStreak(stats.dailySeconds, day(2026, 1, 1));
    const alphaOrb = { id: bandOrbId('alpha'), name: '', blurb: '', color: '#fff', unlock: { type: 'band-minutes', band: 'alpha', minutes: 10 } } as const;
    const deltaOrb = { id: bandOrbId('delta'), name: '', blurb: '', color: '#fff', unlock: { type: 'band-minutes', band: 'delta', minutes: 10 } } as const;
    expect(isMedallionUnlocked(alphaOrb, stats, streak)).toBe(true);
    expect(isMedallionUnlocked(deltaOrb, stats, streak)).toBe(false);
  });

  it('total-minutes unlocks sum across every band', () => {
    const stats = statsWith({ alpha: 20 * 60, beta: 10 * 60 });
    expect(totalMinutesAllBands(stats.totalSecondsByBand)).toBe(30);
    const streak = computeStreak(stats.dailySeconds, day(2026, 1, 1));
    const star = { id: 'star', name: '', blurb: '', color: '#fff', unlock: { type: 'total-minutes', minutes: 30 } } as const;
    expect(isMedallionUnlocked(star, stats, streak)).toBe(true);
  });

  it('streak-days unlocks check the LONGEST-ever streak, so a lapsed streak does not un-earn it', () => {
    const stats: FocusStats = {
      totalSecondsByBand: emptySecondsByBand(),
      dailySeconds: {
        '2026-08-01': WATER_THRESHOLD_SEC,
        '2026-08-02': WATER_THRESHOLD_SEC,
        '2026-08-03': WATER_THRESHOLD_SEC,
        // streak lapses after this — "today" below is long after
      },
    };
    const streak = computeStreak(stats.dailySeconds, day(2026, 8, 22));
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(3);
    const moon = { id: 'crescent-moon', name: '', blurb: '', color: '#fff', unlock: { type: 'streak-days', days: 3 } } as const;
    expect(isMedallionUnlocked(moon, stats, streak)).toBe(true);
  });

  it('computeUnlockedMedallions always includes the default and is monotonic as time accumulates', () => {
    const empty = statsWith({});
    const unlockedEmpty = computeUnlockedMedallions(empty, day(2026, 1, 1));
    expect(unlockedEmpty).toContain('spark');

    const withTime = statsWith({ delta: 10 * 60 });
    const unlockedWithTime = computeUnlockedMedallions(withTime, day(2026, 1, 1));
    expect(unlockedWithTime).toContain('spark');
    expect(unlockedWithTime).toContain(bandOrbId('delta'));
    expect(unlockedWithTime.length).toBeGreaterThan(unlockedEmpty.length);
  });
});
