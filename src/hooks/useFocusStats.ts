import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainwaveBand } from '../data/bands';
import { MEDALLIONS, type MedallionId } from '../data/medallions';
import type { MysteryMedallionId } from '../data/mysteryMedallions';
import {
  computeGrowth,
  computeStreak,
  computeUnlockedMedallions,
  currentTreeStage,
  dateKeyFor,
  isMedallionUnlocked,
  totalMinutesAllBands,
  WATER_THRESHOLD_SEC,
  type FocusStats,
} from '../engine/growth';
import { pendingMysteryFruitCount, rollMysteryMedallion } from '../engine/mysteryFruits';
import { loadStats, saveStats, type PersistedStats } from '../storage/statsStorage';

/** growth.ts's unlock checks (including the new 'mystery-harvest' rule) want
 * a `mysteryHarvestCount` alongside the band/daily totals PersistedStats
 * already carries — derived here rather than stored a second time, same
 * "derive, don't duplicate" reasoning as everything else in this file. */
function toFocusStats(stats: PersistedStats): FocusStats {
  return { ...stats, mysteryHarvestCount: stats.mysteryUnlockedIds.length };
}

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
  const bandRef = useRef(band);
  bandRef.current = band;

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
    lastTickRef.current = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const prev = lastTickRef.current ?? now;
      const deltaSec = Math.max(0, (now - prev) / 1000);
      lastTickRef.current = now;
      if (deltaSec <= 0) return;

      const band = bandRef.current;
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
  }, [isPlaying]);

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
  const goalUnlockedIds = computeUnlockedMedallions(toFocusStats(stats), today);
  // Every goal-driven unlock PLUS every mystery medallion ever harvested —
  // this is what the pendant/picker/fractal-tree fruit all treat as "owned,
  // equip-or-display-able," regardless of which of the two systems earned
  // it. The achievements grid below still iterates MEDALLIONS (goal-only)
  // directly, so the extra mystery ids in this combined list are simply
  // irrelevant there, not a leak between the two families.
  const unlockedIds: MedallionId[] = [...goalUnlockedIds, ...stats.mysteryUnlockedIds];
  const totalMinutes = totalMinutesAllBands(stats.totalSecondsByBand);
  const growth = computeGrowth(totalMinutes);
  const treeStage = currentTreeStage(totalMinutes);
  const pendingMysteryCount = pendingMysteryFruitCount(totalMinutes, stats.mysteryUnlockedIds.length, stats.wateringBonusFruits);

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
   * select something not actually unlocked. Mystery ids take a different
   * check (already harvested?) since they're not in MEDALLIONS/
   * isMedallionUnlocked at all — that whole pure-unlock-rule machinery is
   * goal-driven-only, by design (see data/medallions.ts's file comment). */
  const setSelectedMedallionId = useCallback((id: MedallionId) => {
    setStats((current) => {
      if (id.startsWith('mystery-')) {
        if (!current.mysteryUnlockedIds.includes(id as MysteryMedallionId)) return current;
        return { ...current, selectedMedallionId: id };
      }
      const def = MEDALLIONS.find((m) => m.id === id);
      if (!def) return current;
      const streakNow = computeStreak(current.dailySeconds, new Date());
      if (!isMedallionUnlocked(def, toFocusStats(current), streakNow)) return current;
      return { ...current, selectedMedallionId: id };
    });
  }, []);

  const dismissCelebration = useCallback(() => setJustUnlocked([]), []);

  /** Harvests ONE pending mystery fruit: rolls a weighted-random medallion
   * from everything not already owned, appends it to mysteryUnlockedIds
   * (immediately — the roll itself is final the instant this is called, not
   * once a caller's reveal animation finishes; see MysteryRollModal.tsx),
   * and returns what was won so the caller can show it.
   *
   * The random roll deliberately happens OUTSIDE the setStats updater, not
   * inside it — a setState updater must stay pure (React can and does
   * invoke it more than once, e.g. under StrictMode, to catch exactly this
   * kind of impurity), so calling Math.random()-based logic in there could
   * silently roll twice per click. Reading statsRef.current up front (the
   * same ref the debounced-save effect already relies on to avoid a stale
   * closure) keeps the actual roll a single, real event-handler-time call,
   * and the updater itself just appends the already-decided result. */
  const harvestMysteryFruit = useCallback((): MysteryMedallionId | null => {
    const current = statsRef.current;
    const totalMinutesNow = totalMinutesAllBands(current.totalSecondsByBand);
    const pendingNow = pendingMysteryFruitCount(totalMinutesNow, current.mysteryUnlockedIds.length, current.wateringBonusFruits);
    if (pendingNow <= 0) return null;
    const rolled = rollMysteryMedallion(new Set(current.mysteryUnlockedIds));
    if (!rolled) return null;
    setStats((latest) => (latest.mysteryUnlockedIds.includes(rolled) ? latest : { ...latest, mysteryUnlockedIds: [...latest.mysteryUnlockedIds, rolled] }));
    return rolled;
  }, []);

  /** Waters the tree for today — marks today's dailySeconds at or above
   * WATER_THRESHOLD_SEC, the exact same threshold real practice uses, so
   * `wateredToday`/the streak treat a can-click identically to a genuine
   * session. Deliberately does NOT touch totalSecondsByBand: that field
   * drives tree growth and mystery-fruit timing, and both need to stay an
   * honest reflection of real practice, not something a click can inflate.
   *
   * If today wasn't already watered by ANY means (real practice or an
   * earlier click today), this is the day's first watering — it also
   * grants one bonus mystery fruit (wateringBonusFruits), independent of
   * the normal time-based growth schedule. Returns whether THIS call was
   * that first watering, so the caller can react immediately (e.g. play a
   * "fruit fell" flourish) without waiting on a re-render.
   *
   * The "was it already watered" read happens outside the setStats
   * updater (same reasoning as harvestMysteryFruit's pendingNow check —
   * an updater can run more than once under StrictMode, so anything that
   * shouldn't happen twice needs to be decided once, synchronously, from
   * statsRef.current). The updater itself re-derives the same check from
   * `latest` before incrementing, so it stays idempotent no matter how
   * many times React invokes it. */
  const waterTree = useCallback((): boolean => {
    const current = statsRef.current;
    const todayKey = dateKeyFor(new Date());
    const wasWateredToday = (current.dailySeconds[todayKey] ?? 0) >= WATER_THRESHOLD_SEC;
    setStats((latest) => {
      const latestTodayKey = dateKeyFor(new Date());
      const latestWasWatered = (latest.dailySeconds[latestTodayKey] ?? 0) >= WATER_THRESHOLD_SEC;
      return {
        ...latest,
        dailySeconds: {
          ...latest.dailySeconds,
          [latestTodayKey]: Math.max(latest.dailySeconds[latestTodayKey] ?? 0, WATER_THRESHOLD_SEC),
        },
        wateringBonusFruits: latestWasWatered ? latest.wateringBonusFruits : latest.wateringBonusFruits + 1,
      };
    });
    return !wasWateredToday;
  }, []);

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
    mysteryOwnedIds: stats.mysteryUnlockedIds,
    pendingMysteryCount,
    harvestMysteryFruit,
    waterTree,
  };
}
