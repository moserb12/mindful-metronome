// ============================================================================
// Custom preset persistence — its own storage key, deliberately separate
// from settingsStorage.ts: this is a growing COLLECTION, not a settings
// scalar, and must never be touched by anything that saves/loads the
// scalar settings blob (so a future "reset settings" affordance, if one is
// ever added, can't accidentally wipe out saved presets).
// ============================================================================

import type { NoiseType, TickEarMode, TickSound } from '../audio/binauralEngine';
import { MAX_BEAT_HZ, MAX_BPM, MAX_CARRIER_HZ, MIN_BEAT_HZ, MIN_BPM, MIN_CARRIER_HZ } from '../data/bands';
import type { CustomPreset } from '../data/customPresets';

const STORAGE_KEY = 'mindful-metronome:custom-presets:v1';

const TICK_SOUNDS: TickSound[] = ['soft', 'wood', 'kick', 'hihat'];
const NOISE_TYPES: NoiseType[] = ['pink', 'white', 'brown'];
const TICK_EAR_MODES: TickEarMode[] = ['MATCH', 'OPPOSITE', 'BOTH'];

function isUnitVolume(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** Whether a single parsed item is a well-formed CustomPreset. Applied
 * per-item on load (see loadCustomPresets) so ONE corrupt saved preset
 * never takes down the whole list — it's just filtered out. */
function isValidCustomPreset(v: unknown): v is CustomPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.startsWith('custom-') &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.carrierHz === 'number' &&
    p.carrierHz >= MIN_CARRIER_HZ &&
    p.carrierHz <= MAX_CARRIER_HZ &&
    typeof p.beatHz === 'number' &&
    p.beatHz >= MIN_BEAT_HZ &&
    p.beatHz <= MAX_BEAT_HZ &&
    typeof p.bpm === 'number' &&
    p.bpm >= MIN_BPM &&
    p.bpm <= MAX_BPM &&
    isUnitVolume(p.masterVolume) &&
    isUnitVolume(p.droneVolume) &&
    isUnitVolume(p.tickVolume) &&
    isUnitVolume(p.noiseVolume) &&
    typeof p.noiseType === 'string' &&
    NOISE_TYPES.includes(p.noiseType as NoiseType) &&
    typeof p.tickSound === 'string' &&
    TICK_SOUNDS.includes(p.tickSound as TickSound) &&
    isUnitVolume(p.panModulationDepth) &&
    typeof p.tickEarMode === 'string' &&
    TICK_EAR_MODES.includes(p.tickEarMode as TickEarMode) &&
    typeof p.createdAt === 'number'
  );
}

export function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidCustomPreset);
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: CustomPreset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage disabled/full/private-mode — nothing to do.
  }
}
