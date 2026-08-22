// ============================================================================
// Custom saved presets — a student/listener's own tuned combination,
// stored locally alongside (never mixed into) the 5 built-in Delta/Theta/
// Alpha/Beta/Gamma presets in bands.ts. Unlike a shareable link (see
// urlState.ts), a saved preset is private to this browser and stores a
// FULL snapshot — every setting, including volumes/tick sound/tick-ear
// mode — since there's no reason to leave anything out of something only
// you will ever recall.
// ============================================================================

import type { NoiseType, TickEarMode, TickSound, TickSubdivision } from '../audio/binauralEngine';

export interface CustomPreset {
  /** `custom-<id>` — deliberately a different scheme from the built-in
   * presets' `BrainwaveBand`-typed ids, so the two can never collide or be
   * confused for one another. */
  id: `custom-${string}`;
  name: string;
  carrierHz: number;
  beatHz: number;
  bpm: number;
  masterVolume: number;
  droneVolume: number;
  tickVolume: number;
  noiseVolume: number;
  noiseType: NoiseType;
  tickSound: TickSound;
  panModulationDepth: number;
  tickEarMode: TickEarMode;
  tickSubdivision: TickSubdivision;
  createdAt: number;
}

/** `crypto.randomUUID()` isn't guaranteed present in every test/runtime
 * environment, so this falls back to a short random string rather than
 * adding a uuid dependency for what only needs to be locally unique. */
export function generateCustomPresetId(): CustomPreset['id'] {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `custom-${rand}`;
}
