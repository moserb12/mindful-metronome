import { BAND_ORDER, type BrainwaveBand } from '../data/bands';
import { MEDALLIONS, type MedallionDef, type MedallionId } from '../data/medallions';

// ============================================================================
// growth.ts — pure derivation logic for the whole "focus dashboard": how
// many minutes have been logged per band, whether today counts as
// "watered," the current daily streak, which medallions are unlocked, and
// how grown the fractal tree is. Nothing here touches localStorage, React,
// or the system clock directly (every function that cares about "today"
// takes it as a parameter) — same reasoning as computeSwingSegment/
// computeSessionPhase in useMetronomeEngine.ts: keep anything derivable
// from a snapshot of state as a pure function, so it's directly unit-
// testable with plain numbers and stays correct by construction rather
// than by careful incremental bookkeeping.
//
// A deliberate consequence: nothing here is ever "un-derived." Total
// seconds per band only ever grows (accumulated while playing — see
// useFocusStats.ts), so every unlock computed from it is monotonic: once
// true, always true. Streaks CAN lapse (missing a day resets the CURRENT
// streak), but unlocks gated on a streak check the LONGEST streak ever
// reached, not the current one — a medallion earned by a 7-day streak
// stays earned even after the streak later breaks. Nothing in this app
// ever takes a medallion away.
// ============================================================================

/** Persisted, band-keyed accumulation — the source of truth both for the
 * "duration by beat type" stats the dashboard shows and for every
 * band-orb medallion's unlock check. */
export type SecondsByBand = Record<BrainwaveBand, number>;

/** One entry per calendar day (local time), keyed "YYYY-MM-DD" ->
 * total seconds of playback that day, across all bands. This is BOTH the
 * daily-watering log (see WATER_THRESHOLD_SEC) and, summed, must always
 * equal the total across SecondsByBand — see useFocusStats.ts, which
 * writes to both in the same tick so they can never drift apart. */
export type DailySecondsLog = Record<string, number>;

export interface FocusStats {
  totalSecondsByBand: SecondsByBand;
  dailySeconds: DailySecondsLog;
  /** How many mystery fruits have been harvested (see engine/mysteryFruits.ts)
   * — feeds the 'mystery-harvest' unlock rule below. Optional, defaulting to
   * 0, purely so every existing FocusStats literal in growth.test.ts (and
   * any other caller that predates the mystery-fruit feature) stays valid
   * without an edit — the same "missing entry falls back to a safe default"
   * tolerance sanitizeSecondsByBand already applies per-band. */
  mysteryHarvestCount?: number;
}

export function emptySecondsByBand(): SecondsByBand {
  return { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
}

/** A day counts as "watered" once this much total playback happened that
 * day — deliberately low (one minute) so a quick check-in is enough to
 * keep a streak alive; this is meant to encourage showing up daily, not to
 * gate the streak behind a full session. */
export const WATER_THRESHOLD_SEC = 60;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local-time "YYYY-MM-DD" key for a date — deliberately NOT
 * `toISOString()` (that's UTC, so it would roll over at the wrong moment
 * for anyone not in UTC) and not `toLocaleDateString` (locale-dependent
 * format, awkward to parse back). Plain field access + manual padding
 * keeps this dependency-free and exactly reversible by dateFromKey(). */
export function dateKeyFor(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function utcDayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function totalSecondsAllBands(totalSecondsByBand: SecondsByBand): number {
  return BAND_ORDER.reduce((sum, band) => sum + (totalSecondsByBand[band] ?? 0), 0);
}

export function totalMinutesAllBands(totalSecondsByBand: SecondsByBand): number {
  return totalSecondsAllBands(totalSecondsByBand) / 60;
}

export function bandMinutes(totalSecondsByBand: SecondsByBand, band: BrainwaveBand): number {
  return (totalSecondsByBand[band] ?? 0) / 60;
}

export interface StreakInfo {
  /** Consecutive watered days counting back from today (or from yesterday,
   * if today hasn't been watered yet — a streak from yesterday is still
   * "current" until a full day passes with nothing logged). */
  current: number;
  /** The longest run of consecutive watered days ever recorded, including
   * the current run. Never decreases — see the file comment on why streak
   * medallions check this instead of `current`. */
  longest: number;
  wateredToday: boolean;
}

/**
 * Derives the daily-watering streak from the log alone. `today` is a
 * parameter (not read from `new Date()` internally) purely so this stays a
 * pure, directly-testable function — callers pass the real current date.
 */
export function computeStreak(dailySeconds: DailySecondsLog, today: Date): StreakInfo {
  const isWatered = (key: string) => (dailySeconds[key] ?? 0) >= WATER_THRESHOLD_SEC;
  const todayKey = dateKeyFor(today);
  const wateredToday = isWatered(todayKey);

  let current = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!wateredToday) cursor.setDate(cursor.getDate() - 1);
  while (isWatered(dateKeyFor(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Longest-ever run: walk every watered date in chronological order and
  // track the longest span of calendar-consecutive days. Uses UTC day
  // numbers purely as a stable "days since epoch" integer for the gap
  // check (== 1 day apart) — no timezone conversion is happening, since
  // both keys were produced by the same local dateKeyFor().
  const wateredKeysSorted = Object.keys(dailySeconds).filter(isWatered).sort();
  let longest = 0;
  let run = 0;
  let prevDay: number | null = null;
  for (const key of wateredKeysSorted) {
    const day = utcDayNumber(key);
    run = prevDay !== null && day - prevDay === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevDay = day;
  }
  longest = Math.max(longest, current);

  return { current, longest, wateredToday };
}

export function isMedallionUnlocked(def: MedallionDef, stats: FocusStats, streak: StreakInfo): boolean {
  switch (def.unlock.type) {
    case 'default':
      return true;
    case 'band-minutes':
      return bandMinutes(stats.totalSecondsByBand, def.unlock.band) >= def.unlock.minutes;
    case 'total-minutes':
      return totalMinutesAllBands(stats.totalSecondsByBand) >= def.unlock.minutes;
    case 'streak-days':
      return streak.longest >= def.unlock.days;
    case 'mystery-harvest':
      return (stats.mysteryHarvestCount ?? 0) >= def.unlock.count;
  }
}

/** Every currently-unlocked medallion id, in catalog order. Recomputed
 * fresh from `stats` every call rather than cached/stored — see the file
 * comment for why nothing here is persisted as its own "unlocked" list. */
export function computeUnlockedMedallions(stats: FocusStats, today: Date): MedallionId[] {
  const streak = computeStreak(stats.dailySeconds, today);
  return MEDALLIONS.filter((m) => isMedallionUnlocked(m, stats, streak)).map((m) => m.id);
}

export interface TreeStageInfo {
  key: string;
  label: string;
  minMinutes: number;
}

export const TREE_STAGES: TreeStageInfo[] = [
  { key: 'seed', label: 'Seed', minMinutes: 0 },
  { key: 'sprout', label: 'Sprout', minMinutes: 5 },
  { key: 'sapling', label: 'Sapling', minMinutes: 20 },
  { key: 'young-tree', label: 'Young Tree', minMinutes: 60 },
  { key: 'full-tree', label: 'Full Tree', minMinutes: 180 },
  { key: 'ancient-tree', label: 'Ancient Tree', minMinutes: 600 },
];

/** Total minutes at which the fractal tree is considered fully mature
 * (`computeGrowth` saturates at 1). 20 hours — generous enough that the
 * tree keeps visibly filling out for a long time, never a quick grind. */
export const MAX_GROWTH_MINUTES = 1200;

/** 0 (seed) .. 1 (fully mature) — drives both the fractal tree's branch
 * count/length (see engine/fractalTree.ts) and, indirectly via
 * currentTreeStage(), the label shown under it. */
export function computeGrowth(totalMinutes: number): number {
  return Math.max(0, Math.min(1, totalMinutes / MAX_GROWTH_MINUTES));
}

export function currentTreeStage(totalMinutes: number): TreeStageInfo {
  let stage = TREE_STAGES[0];
  for (const s of TREE_STAGES) {
    if (totalMinutes >= s.minMinutes) stage = s;
  }
  return stage;
}
