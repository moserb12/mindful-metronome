import { MYSTERY_MEDALLIONS, RARITY_WEIGHT, type MysteryMedallionId } from '../data/mysteryMedallions';

// ============================================================================
// mysteryFruits.ts — pure logic for the RNG collectible track: when a
// mystery fruit becomes available to harvest (a function of the SAME
// cumulative practice minutes growth.ts already tracks, so this stays
// consistent with "everything derives from real logged time"), and what
// harvesting one actually gives you. Nothing here touches React or
// localStorage — same separation growth.ts and fractalTree.ts already
// establish, and for the same reason: directly unit-testable with plain
// numbers.
//
// One deliberate exception to the "derive, don't store" rule the rest of
// this app leans on: WHICH medallion a roll lands on is genuinely random,
// so unlike everything in growth.ts, that outcome has to be persisted
// (PersistedStats.mysteryUnlockedIds in storage/statsStorage.ts) rather than
// re-derived. Only the TIMING of when fruit becomes available stays a pure
// function of minutes logged.
// ============================================================================

export const MAX_MYSTERY_FRUITS = MYSTERY_MEDALLIONS.length;

/** First mystery fruit is ready after this many cumulative minutes — low on
 * purpose so a first-time listener sees the mechanic within one normal
 * session, the same "instant gratification, then a long tail" shape the
 * milestone medallions already use (compare star's 30-minute unlock). */
const BASE_GAP_MINUTES = 8;

/** Each successive fruit takes this much longer to grow than the last —
 * "progressively less often," per the builder's explicit ask. */
const GAP_GROWTH_RATE = 1.35;

/** The gap between fruits stops growing once it reaches this many minutes,
 * so working toward the full 50-piece set stays a long-term thing to look
 * forward to rather than something that effectively stops happening. */
const MAX_GAP_MINUTES = 240;

/** Cumulative-minutes thresholds at which each successive fruit becomes
 * available — thresholds[0] is the first fruit, thresholds[1] the second,
 * etc. Computed once at module load (pure function of the constants above,
 * nothing user-specific), same "compute the table once, look values up"
 * shape as TREE_STAGES in growth.ts. */
export function mysteryFruitThresholds(count: number = MAX_MYSTERY_FRUITS): number[] {
  const thresholds: number[] = [];
  let cumulative = 0;
  let gap = BASE_GAP_MINUTES;
  for (let i = 0; i < count; i++) {
    cumulative += gap;
    thresholds.push(cumulative);
    gap = Math.min(MAX_GAP_MINUTES, gap * GAP_GROWTH_RATE);
  }
  return thresholds;
}

const THRESHOLDS = mysteryFruitThresholds();

/** How many mystery fruits have grown (become available to harvest) by the
 * time `totalMinutes` have been logged — capped at the full catalogue size.
 * Monotonic in totalMinutes, exactly like every unlock in growth.ts. */
export function mysteryFruitsGrown(totalMinutes: number): number {
  let grown = 0;
  for (const threshold of THRESHOLDS) {
    if (totalMinutes < threshold) break;
    grown += 1;
  }
  return grown;
}

/** Grown-but-not-yet-harvested fruit — these are the "? balls" waiting on
 * the ground. `harvestedCount` is PersistedStats.mysteryUnlockedIds.length,
 * passed in rather than read here so this file stays free of any storage
 * dependency. */
export function pendingMysteryFruitCount(totalMinutes: number, harvestedCount: number): number {
  return Math.max(0, mysteryFruitsGrown(totalMinutes) - harvestedCount);
}

/**
 * Weighted-random pick, restricted to medallions NOT already in `ownedIds`
 * — every successful roll therefore adds something genuinely new to the
 * collection. This is a deliberate design choice, not an oversight: a real
 * gacha would allow (and often monetize) duplicate pulls, but this app has
 * no currency to spend and no reason to ever waste a listener's harvest on
 * a repeat, so the pool simply shrinks as the collection fills in — a
 * built-in soft pity that needs no separate bookkeeping (once every common
 * is owned, only uncommon-or-better remain to be rolled, and so on).
 * Returns null once the full 50-piece set is owned (nothing left to roll).
 */
export function rollMysteryMedallion(ownedIds: ReadonlySet<MysteryMedallionId>): MysteryMedallionId | null {
  const pool = MYSTERY_MEDALLIONS.filter((m) => !ownedIds.has(m.id));
  if (pool.length === 0) return null;

  const totalWeight = pool.reduce((sum, m) => sum + RARITY_WEIGHT[m.rarity], 0);
  let roll = Math.random() * totalWeight;
  for (const m of pool) {
    roll -= RARITY_WEIGHT[m.rarity];
    if (roll <= 0) return m.id;
  }
  // Floating-point rounding safety net — statistically near-impossible to
  // reach, but every real branch must return a valid id from the pool.
  return pool[pool.length - 1].id;
}
