// ============================================================================
// Settings persistence — the whole app previously reset to its defaults on
// every reload (zero localStorage/sessionStorage usage anywhere). This is a
// deliberately small, dependency-free load/save pair: one JSON blob under
// one key, validated FIELD BY FIELD on load so a single corrupt/out-of-
// range value (a future schema change, a hand-edited value, a browser
// storage quirk) degrades gracefully instead of invalidating the whole
// saved configuration.
//
// Custom presets (see data/customPresets.ts) deliberately live under a
// SEPARATE storage key — they're a growing collection, not a settings
// scalar, and shouldn't be touched by anything that manipulates this blob.
// ============================================================================

import type { NoiseType, TickEarMode, TickSound, TickSubdivision } from '../audio/binauralEngine';
import { MAX_BEAT_HZ, MAX_BPM, MAX_CARRIER_HZ, MIN_BEAT_HZ, MIN_BPM, MIN_CARRIER_HZ } from '../data/bands';

const STORAGE_KEY = 'mindful-metronome:settings:v1';

export interface PersistedSettings {
  carrierHz: number;
  beatHz: number;
  bpm: number;
  tickSound: TickSound;
  masterVolume: number;
  droneVolume: number;
  tickVolume: number;
  noiseVolume: number;
  noiseType: NoiseType;
  panModulationDepth: number;
  tickEarMode: TickEarMode;
  tickSubdivision: TickSubdivision;
  hapticsEnabled: boolean;
  /** The last duration picked in the Practice section's session timer —
   * `null` means Open-ended (no auto-fade). Only the PREFERENCE persists,
   * never an in-progress countdown's elapsed time: reloading tears down
   * the whole AudioContext anyway, so "resuming" a session across a
   * reload isn't meaningful. */
  lastSelectedSessionDurationMinutes: number | null;
}

const TICK_SOUNDS: TickSound[] = ['soft', 'wood', 'kick', 'hihat'];
const NOISE_TYPES: NoiseType[] = ['pink', 'white', 'brown'];
const TICK_EAR_MODES: TickEarMode[] = ['MATCH', 'OPPOSITE', 'BOTH'];
const TICK_SUBDIVISIONS: TickSubdivision[] = ['ENDS', 'ENDS_AND_CENTER', 'CENTER'];

function isUnitVolume(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** One validator per field — every field is checked independently, so a
 * corrupt value in ONE field never disqualifies the others. */
const FIELD_VALIDATORS: { [K in keyof PersistedSettings]: (v: unknown) => boolean } = {
  carrierHz: (v) => typeof v === 'number' && Number.isFinite(v) && v >= MIN_CARRIER_HZ && v <= MAX_CARRIER_HZ,
  beatHz: (v) => typeof v === 'number' && Number.isFinite(v) && v >= MIN_BEAT_HZ && v <= MAX_BEAT_HZ,
  bpm: (v) => typeof v === 'number' && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM,
  tickSound: (v) => typeof v === 'string' && TICK_SOUNDS.includes(v as TickSound),
  masterVolume: isUnitVolume,
  droneVolume: isUnitVolume,
  tickVolume: isUnitVolume,
  noiseVolume: isUnitVolume,
  noiseType: (v) => typeof v === 'string' && NOISE_TYPES.includes(v as NoiseType),
  panModulationDepth: isUnitVolume,
  tickEarMode: (v) => typeof v === 'string' && TICK_EAR_MODES.includes(v as TickEarMode),
  tickSubdivision: (v) => typeof v === 'string' && TICK_SUBDIVISIONS.includes(v as TickSubdivision),
  hapticsEnabled: (v) => typeof v === 'boolean',
  lastSelectedSessionDurationMinutes: (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0),
};

/** Reads whatever validates from localStorage. Never throws — Safari
 * private browsing (and any environment with storage disabled) throws on
 * `localStorage` access itself, not just on read/write, so this is
 * wrapped end to end. Returns a partial object; callers fall back to
 * their own defaults for anything missing/invalid. */
export function loadSettings(): Partial<PersistedSettings> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const source = parsed as Record<string, unknown>;
    const result: Partial<PersistedSettings> = {};
    (Object.keys(FIELD_VALIDATORS) as (keyof PersistedSettings)[]).forEach((key) => {
      const value = source[key];
      if (FIELD_VALIDATORS[key](value)) {
        (result as Record<string, unknown>)[key] = value;
      }
    });
    return result;
  } catch {
    return {};
  }
}

export function saveSettings(settings: PersistedSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage disabled/full/private-mode — nothing to do; the app just
    // keeps working without persistence for this session.
  }
}
