import type { BrainwaveBand } from './bands';
import { BANDS } from './bands';
import { MYSTERY_MEDALLIONS_BY_ID, type MysteryMedallionId } from './mysteryMedallions';

// ============================================================================
// Medallions — the little collectible glyphs a listener can mount on the
// pendant at the end of the pendulum arm. Two families, two different
// things to be proud of:
//
//   - Five "band orbs," one per brainwave band, unlocked by spending real
//     time IN that band (see BAND_MINUTES_TO_UNLOCK below). These are the
//     direct payoff for the per-band duration stats the dashboard tracks —
//     "you've actually spent time here" made visible and collectible.
//   - Ten "milestone" glyphs (spark, star, raindrop, crescent moon, sun,
//     lightbulb, leaf, snowflake, yin-yang, flame), unlocked by cumulative
//     total time or by daily-practice streak length. These reward showing
//     up over the long haul rather than any one session.
//
// Deliberately NOT stored as an explicit "unlocked" list in localStorage —
// every unlock rule here is a pure function of FocusStats (total seconds
// per band, and the daily log used to derive streaks), and every one of
// those inputs only ever grows. So "is X unlocked" is always re-derived
// fresh from the numbers rather than tracked as separate mutable state that
// could drift out of sync with them — same philosophy as
// computeSwingSegment/computeSessionPhase elsewhere in this app: prefer a
// pure function over incrementally-updated state wherever the inputs are
// already available.
//
// A THIRD family lives in data/mysteryMedallions.ts: 50 "mystery" medallions
// won by a weighted RNG roll (see engine/mysteryFruits.ts), not by any rule
// expressible here. Those genuinely CAN'T be a pure function of FocusStats
// (the outcome is random) — they're the one exception to the paragraph
// above, and their result really is stored (PersistedStats.mysteryUnlockedIds
// in storage/statsStorage.ts). MedallionId below spans all three families so
// a mystery medallion can be equipped on the pendant exactly like a
// goal-driven one; MEDALLIONS/MEDALLIONS_BY_ID stay goal-driven-only (they
// back the achievements grid and computeUnlockedMedallions), while
// ALL_MEDALLIONS_BY_ID at the bottom of this file is the merged lookup
// anything family-agnostic (the pendant, MedallionIcon) needs for color/name.
// ============================================================================

export type MilestoneMedallionId =
  | 'spark'
  | 'star'
  | 'raindrop'
  | 'crescent-moon'
  | 'sun'
  | 'lightbulb'
  | 'leaf'
  | 'snowflake'
  | 'yin-yang'
  | 'flame'
  | 'question-mark';

/** A band orb's id is just `${band}-orb` — see bandOrbId(). Kept as a
 * template type (not a plain string) so callers get real autocomplete/
 * exhaustiveness rather than treating medallion ids as bare strings. */
export type BandOrbId = `${BrainwaveBand}-orb`;

export type MedallionId = MilestoneMedallionId | BandOrbId | MysteryMedallionId;

export function bandOrbId(band: BrainwaveBand): BandOrbId {
  return `${band}-orb`;
}

export type UnlockRule =
  | { type: 'default' }
  | { type: 'band-minutes'; band: BrainwaveBand; minutes: number }
  | { type: 'total-minutes'; minutes: number }
  | { type: 'streak-days'; days: number }
  | { type: 'mystery-harvest'; count: number };

export interface MedallionDef {
  id: MedallionId;
  name: string;
  /** Short line shown under the medallion once unlocked, and as the "how
   * to unlock" hint while still locked. */
  blurb: string;
  color: string;
  unlock: UnlockRule;
}

/** Minutes spent WITHIN a given band (not total across all bands) needed to
 * unlock that band's orb. Low enough that a single longer session, or a
 * couple of shorter ones, gets there — the point is "you've visited this
 * state," not a grind. */
export const BAND_MINUTES_TO_UNLOCK = 10;

const BAND_ORBS: MedallionDef[] = (['delta', 'theta', 'alpha', 'beta', 'gamma'] as BrainwaveBand[]).map((band) => ({
  id: bandOrbId(band),
  name: `${BANDS[band].label} Orb`,
  blurb: `Log ${BAND_MINUTES_TO_UNLOCK} min in ${BANDS[band].label} (${BANDS[band].rangeLabel}) — ${BANDS[band].blurb.toLowerCase()}.`,
  color: BANDS[band].color,
  unlock: { type: 'band-minutes', band, minutes: BAND_MINUTES_TO_UNLOCK },
}));

const MILESTONE_MEDALLIONS: MedallionDef[] = [
  {
    id: 'spark',
    name: 'Spark',
    blurb: 'Yours from the very first session — every collection starts somewhere.',
    color: '#e2e8f0',
    unlock: { type: 'default' },
  },
  {
    id: 'star',
    name: 'Star',
    blurb: 'Log 30 total minutes across any bands.',
    color: '#fde68a',
    unlock: { type: 'total-minutes', minutes: 30 },
  },
  {
    id: 'raindrop',
    name: 'Raindrop',
    blurb: 'Log 1 total hour — steady accumulation, drop by drop.',
    color: '#38bdf8',
    unlock: { type: 'total-minutes', minutes: 60 },
  },
  {
    id: 'crescent-moon',
    name: 'Crescent Moon',
    blurb: 'Water the tree 3 days in a row.',
    color: '#c4b5fd',
    unlock: { type: 'streak-days', days: 3 },
  },
  {
    id: 'lightbulb',
    name: 'Lightbulb',
    blurb: 'Log 3 total hours.',
    color: '#fbbf24',
    unlock: { type: 'total-minutes', minutes: 180 },
  },
  {
    id: 'sun',
    name: 'Sun',
    blurb: 'Water the tree 7 days in a row.',
    color: '#fb923c',
    unlock: { type: 'streak-days', days: 7 },
  },
  {
    id: 'leaf',
    name: 'Leaf',
    blurb: 'Log 5 total hours — the tree is thriving.',
    color: '#4ade80',
    unlock: { type: 'total-minutes', minutes: 300 },
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    blurb: 'Log 10 total hours. No two collections look alike.',
    color: '#a5f3fc',
    unlock: { type: 'total-minutes', minutes: 600 },
  },
  {
    id: 'yin-yang',
    name: 'Yin-Yang',
    blurb: 'Water the tree 14 days in a row — real balance.',
    color: '#f1f5f9',
    unlock: { type: 'streak-days', days: 14 },
  },
  {
    id: 'flame',
    name: 'Flame',
    blurb: 'Water the tree 30 days in a row. A hard-earned streak.',
    color: '#fb7185',
    unlock: { type: 'streak-days', days: 30 },
  },
  {
    id: 'question-mark',
    name: 'Question Mark',
    blurb: 'Harvest 10 mystery fruits from the Focus Garden.',
    color: '#d8b4fe',
    unlock: { type: 'mystery-harvest', count: 10 },
  },
];

/** Every medallion, band orbs first (they're the "starter" family a
 * listener will unlock earliest and most often, being per-band rather than
 * cumulative), then milestones in roughly ascending difficulty. Order here
 * is also render order in the collection grid and the fractal tree's fruit
 * placement. */
export const MEDALLIONS: MedallionDef[] = [...BAND_ORBS, ...MILESTONE_MEDALLIONS];

export const MEDALLIONS_BY_ID: Record<MedallionId, MedallionDef> = Object.fromEntries(
  MEDALLIONS.map((m) => [m.id, m])
) as Record<MedallionId, MedallionDef>;

export const DEFAULT_MEDALLION_ID: MedallionId = 'spark';

/** Minimal shape both a goal-driven MedallionDef and a MysteryMedallionDef
 * satisfy — everything that only needs to know "what does this look like
 * and what's it called" regardless of which family unlocked it (the
 * pendant, MedallionIcon's own lookup) uses this merged dict instead of
 * MEDALLIONS_BY_ID, which stays goal-driven-only for the places that
 * genuinely need to iterate just that one family (the achievements grid,
 * computeUnlockedMedallions). */
export interface MedallionColorEntry {
  id: MedallionId;
  name: string;
  color: string;
}

export const ALL_MEDALLIONS_BY_ID: Record<MedallionId, MedallionColorEntry> = {
  ...MEDALLIONS_BY_ID,
  ...MYSTERY_MEDALLIONS_BY_ID,
} as Record<MedallionId, MedallionColorEntry>;
