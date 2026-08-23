// ============================================================================
// Focus stats persistence — same philosophy as settingsStorage.ts (one
// localStorage blob, validated so a corrupt/out-of-range value degrades
// gracefully instead of invalidating everything), but one level deeper:
// `totalSecondsByBand` and `dailySeconds` are themselves small dictionaries,
// so a bad ENTRY inside either one is dropped individually rather than
// throwing the whole field away. That matters more here than in
// settingsStorage: losing one corrupt day from `dailySeconds` should never
// cost a listener their entire practice history or streak.
//
// Deliberately its own storage key, separate from settingsStorage's blob —
// same reasoning as customPresetsStorage.ts: this is a growing history, not
// a settings scalar, and shouldn't be touched by anything that only knows
// how to read/write tuning settings.
// ============================================================================

import { BAND_ORDER, type BrainwaveBand } from '../data/bands';
import { ALL_MEDALLIONS_BY_ID, DEFAULT_MEDALLION_ID, type MedallionId } from '../data/medallions';
import { MYSTERY_MEDALLIONS_BY_ID, type MysteryMedallionId } from '../data/mysteryMedallions';
import { emptySecondsByBand, type DailySecondsLog, type SecondsByBand } from '../engine/growth';

const STORAGE_KEY = 'mindful-metronome:focus-stats:v1';

export interface PersistedStats {
  totalSecondsByBand: SecondsByBand;
  dailySeconds: DailySecondsLog;
  selectedMedallionId: MedallionId;
  /** Every mystery medallion ever harvested, in harvest order — see
   * engine/mysteryFruits.ts. This is the one field in this file that isn't
   * re-derivable from the other two: WHICH medallion a roll lands on is
   * genuinely random, so unlike totalSecondsByBand/dailySeconds (which
   * everything else derives from), the outcome has to be the source of
   * truth itself. */
  mysteryUnlockedIds: MysteryMedallionId[];
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isNonNegativeFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Drops any entry whose key isn't a plausible "YYYY-MM-DD" or whose value
 * isn't a non-negative finite number — one bad day never costs the whole
 * log (and, with it, the streak it encodes). */
function sanitizeDailySeconds(raw: unknown): DailySecondsLog {
  const result: DailySecondsLog = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DATE_KEY_PATTERN.test(key) && isNonNegativeFiniteNumber(value)) {
      result[key] = value;
    }
  }
  return result;
}

/** Same per-entry tolerance as sanitizeDailySeconds — an invalid or missing
 * band just falls back to 0 rather than voiding the other four bands'
 * accumulated time. */
function sanitizeSecondsByBand(raw: unknown): SecondsByBand {
  const result = emptySecondsByBand();
  if (!raw || typeof raw !== 'object') return result;
  const source = raw as Record<string, unknown>;
  for (const band of BAND_ORDER as BrainwaveBand[]) {
    const value = source[band];
    if (isNonNegativeFiniteNumber(value)) result[band] = value;
  }
  return result;
}

function sanitizeSelectedMedallionId(raw: unknown): MedallionId {
  return typeof raw === 'string' && raw in ALL_MEDALLIONS_BY_ID ? (raw as MedallionId) : DEFAULT_MEDALLION_ID;
}

/** Keeps only real, non-duplicate mystery ids, in their original (harvest)
 * order — same per-entry tolerance as the other sanitizers, so one corrupt
 * entry can't cost the rest of a listener's mystery collection. Dedupe
 * matters because rollMysteryMedallion() only ever offers ids NOT already
 * owned, so a genuine duplicate here could only come from corrupted or
 * hand-edited storage, not normal play. */
function sanitizeMysteryUnlockedIds(raw: unknown): MysteryMedallionId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<MysteryMedallionId>();
  const result: MysteryMedallionId[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry in MYSTERY_MEDALLIONS_BY_ID && !seen.has(entry as MysteryMedallionId)) {
      seen.add(entry as MysteryMedallionId);
      result.push(entry as MysteryMedallionId);
    }
  }
  return result;
}

function emptyStats(): PersistedStats {
  return { totalSecondsByBand: emptySecondsByBand(), dailySeconds: {}, selectedMedallionId: DEFAULT_MEDALLION_ID, mysteryUnlockedIds: [] };
}

/** Reads whatever validates from localStorage. Never throws — see
 * settingsStorage.ts's loadSettings() for why (Safari private browsing and
 * similar throw on `localStorage` access itself). Always returns a
 * complete, well-formed object (unlike loadSettings' Partial<>) since every
 * field here already has an unambiguous empty/default value to fall back
 * to — there's no meaningful "field is simply absent" state to preserve. */
export function loadStats(): PersistedStats {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStats();
    const parsed: unknown = JSON.parse(raw);
    const source = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    return {
      totalSecondsByBand: sanitizeSecondsByBand(source.totalSecondsByBand),
      dailySeconds: sanitizeDailySeconds(source.dailySeconds),
      selectedMedallionId: sanitizeSelectedMedallionId(source.selectedMedallionId),
      mysteryUnlockedIds: sanitizeMysteryUnlockedIds(source.mysteryUnlockedIds),
    };
  } catch {
    return emptyStats();
  }
}

export function saveStats(stats: PersistedStats): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Storage disabled/full/private-mode — same graceful no-op as
    // settingsStorage.saveSettings(); the session just won't persist.
  }
}
