import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MEDALLION_ID } from '../data/medallions';
import { emptySecondsByBand } from '../engine/growth';
import { loadStats, saveStats, type PersistedStats } from './statsStorage';

const STORAGE_KEY = 'mindful-metronome:focus-stats:v1';

describe('statsStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns a complete, well-formed default when nothing is stored', () => {
    const stats = loadStats();
    expect(stats.totalSecondsByBand).toEqual(emptySecondsByBand());
    expect(stats.dailySeconds).toEqual({});
    expect(stats.selectedMedallionId).toBe(DEFAULT_MEDALLION_ID);
  });

  it('round-trips a valid save through load', () => {
    const stats: PersistedStats = {
      totalSecondsByBand: { ...emptySecondsByBand(), alpha: 120, gamma: 45 },
      dailySeconds: { '2026-08-22': 90 },
      selectedMedallionId: 'star',
    };
    saveStats(stats);
    expect(loadStats()).toEqual(stats);
  });

  it('drops an invalid band entry without discarding the other bands', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        totalSecondsByBand: { alpha: 60, beta: -5, gamma: 'bogus' },
        dailySeconds: {},
        selectedMedallionId: 'spark',
      })
    );
    const stats = loadStats();
    expect(stats.totalSecondsByBand.alpha).toBe(60);
    expect(stats.totalSecondsByBand.beta).toBe(0);
    expect(stats.totalSecondsByBand.gamma).toBe(0);
  });

  it('drops a malformed daily-log entry without discarding the rest of the log', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        totalSecondsByBand: emptySecondsByBand(),
        dailySeconds: { '2026-08-22': 90, 'not-a-date': 100, '2026-08-23': -5 },
        selectedMedallionId: 'spark',
      })
    );
    const stats = loadStats();
    expect(stats.dailySeconds).toEqual({ '2026-08-22': 90 });
  });

  it('falls back to the default medallion id if the stored one is not a real medallion', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        totalSecondsByBand: emptySecondsByBand(),
        dailySeconds: {},
        selectedMedallionId: 'not-a-real-medallion',
      })
    );
    expect(loadStats().selectedMedallionId).toBe(DEFAULT_MEDALLION_ID);
  });

  it('never throws on corrupt JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => loadStats()).not.toThrow();
    expect(loadStats().selectedMedallionId).toBe(DEFAULT_MEDALLION_ID);
  });
});
