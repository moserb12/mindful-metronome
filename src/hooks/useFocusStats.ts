import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainwaveBand } from '../data/bands';
import { MEDALLIONS, type MedallionId } from '../data/medallions';
import {
  computeGrowth,
  computeStreak,
  computeUnlockedMedallions,
  currentTreeStage,
  dateKeyFor,
  isMedallionUnlocked,
  totalMinutesAllBands,
} from '../engine/growth';
import { loadStats, saveStats, type PersistedStats } from '../storage/statsStorage';

/** How often accumulated playtime is written to localStorage — debounced
 * like settingsStorage's save, though in practice this coalesces to
 * roughly once per accumulation tick rather than dozens of times a second
 * (nothing here fires anywhere near as fast as a dragged slider). */
const STATS_SAVE_DEBOUNCE_MS = 800;
const ACCUMULATE_INTERVAL_MS = 1000;
/** How long a freshly-unlocked medallion stays in `justUnlocked` before the
 * celebratory banner clears itself. */
const CELEBRATION_DURATION_MS = 6000;

/**
 * useFocusStats — the React seam between the pure derivation logic in
 * engine/growth.ts and the dashboard/medallion-picker UI. Takes the
 * metronome's live `isPlaying`/`band` as inputs (rather than owning its own
 * notion of "is audio running") so it stays a pure consumer of
 * useMetronomeEngine's state, the same relationship MetronomeVisual has to
 * it.
 */
export function useFocusStats(isPlaying: boolean, band: BrainwaveBand) {
  const [stats, setStats] = useState<PersistedStats>(loadStats);
  const lastTickRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  // Accumulate REAL elapsed wall-clock time (not a fixed "1 tick = 1
  // second" assumption) into the currently active band's total and today's
  // daily-watering log, once a second while actually playing. Measuring
  // elapsed time rather than counting ticks means a delayed/throttled
  // interval callback (e.g. a backgrounded tab) still credits the correct
  // amount instead of silently under-counting — the same "derive from real
  // elapsed time against a reference, don't assume a fixed cadence"
  // principle behind computeSwingSegment/computeSessionPhase elsewhere in
  // this app.
  useEffect(() => {
    if (!isPlaying) {
      lastTickRef.current = null;
      return;
    }
    lastTickRef.current = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const prev = lastTickRef.current ?? now;
      const deltaSec = Math.max(0, (now - prev) / 1000);
      lastTickRef.current = now;
      if (deltaSec <= 0) return;

      setStats((current) => {
        const todayKey = dateKeyFor(new Date());
        return {
          ...current,
          totalSecondsByBand: {
            ...current.totalSecondsByBand,
            [band]: (current.totalSecondsByBand[band] ?? 0) + deltaSec,
          },
          dailySeconds: {
            ...current.dailySeconds,
            [todayKey]: (current.dailySeconds[todayKey] ?? 0) + deltaSec,
          },
        };
      });
    }, ACCUMULATE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      lastTickRef.current = null;
    };
  }, [isPlaying, band]);

  // Debounced save, mirroring useMetronomeEngine's settings-save effect.
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveStats(stats), STATS_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [stats]);

  // Flush any pending save on unmount (via statsRef, not the possibly-stale
  // `stats` a mount-only effect would otherwise close over) so a tab close
  // right inside the debounce window doesn't drop the last few seconds of
  // a session.
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveStats(statsRef.current);
      }
    };
  }, []);

  const today = new Date();
  const streak = computeStreak(stats.dailySeconds, today);
  const unlockedIds = computeUnlockedMedallions(stats, today);
  const totalMinutes = totalMinutesAllBands(stats.totalSecondsByBand);
  const growth = computeGrowth(totalMinutes);
  const treeStage = currentTreeStage(totalMinutes);

  // Celebrate newly-unlocked medallions: diff this render's unlocked set
  // against the previous one and surface whatever's new for a few seconds,
  // so a listener sees the MOMENT they earn something rather than just
  // stumbling on it later in the collection grid. `unlockedIds` is a fresh
  // array every render (nothing here memoizes it — it's cheap, ~15 items),
  // so the effect keys off its joined-string content rather than array
  // identity, which would otherwise "change" every render regardless of
  // whether the actual set of ids did.
  const prevUnlockedRef = useRef<Set<MedallionId> | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<MedallionId[]>([]);
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockedKey = unlockedIds.join(',');

  useEffect(() => {
    const prev = prevUnlockedRef.current;
    prevUnlockedRef.current = new Set(unlockedIds);
    // First render establishes the baseline (whatever's already unlocked
    // from a previous visit) without treating all of it as "just" earned.
    if (prev === null) return;
    const fresh = unlockedIds.filter((id) => !prev.has(id));
    if (fresh.length === 0) return;
    setJustUnlocked((current) => [...current, ...fresh]);
    if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    celebrationTimeoutRef.current = setTimeout(() => setJustUnlocked([]), CELEBRATION_DURATION_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockedKey]);

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    };
  }, []);

  /** Re-validates against a FRESH snapshot inside the updater (rather than
   * trusting the `unlockedIds` closed over at call time, which could be a
   * render behind) — so a click that's technically stale still can't
   * select something not actually unlocked. */
  const setSelectedMedallionId = useCallback((id: MedallionId) => {
    setStats((current) => {
      const def = MEDALLIONS.find((m) => m.id === id);
      if (!def) return current;
      const streakNow = computeStreak(current.dailySeconds, new Date());
      if (!isMedallionUnlocked(def, current, streakNow)) return current;
      return { ...current, selectedMedallionId: id };
    });
  }, []);

  const dismissCelebration = useCallback(() => setJustUnlocked([]), []);

  return {
    stats,
    streak,
    unlockedIds,
    totalMinutes,
    growth,
    treeStage,
    justUnlocked,
    selectedMedallionId: stats.selectedMedallionId,
    setSelectedMedallionId,
    dismissCelebration,
  };
}
