// ============================================================================
// Shareable-link URL state — encodes only the "core tuning" of a setup
// (carrier Hz, beat/binaural offset Hz, tempo, noise-shield type) into the
// URL's search params, deliberately EXCLUDING volumes/tick sound/tick-ear
// mode: a shared link is meant to hand someone a specific carrier/beat/
// tempo/texture combination, not silently overwrite their own mix
// preferences. Those stay whatever the recipient already has saved locally
// (see storage/settingsStorage.ts) — see resolveInitialSettings() in
// hooks/useMetronomeEngine.ts for the exact per-field merge order
// (defaults < localStorage < URL).
// ============================================================================

import type { NoiseType } from './audio/binauralEngine';
import { MAX_BEAT_HZ, MAX_BPM, MAX_CARRIER_HZ, MIN_BEAT_HZ, MIN_BPM, MIN_CARRIER_HZ } from './data/bands';

export interface CoreTuning {
  carrierHz: number;
  beatHz: number;
  bpm: number;
  noiseType: NoiseType;
}

const NOISE_TYPES: NoiseType[] = ['pink', 'white', 'brown'];

function parseBoundedNumber(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

/** Decodes whatever recognized, in-range core-tuning fields are present.
 * A malformed, partial, or hand-edited link degrades gracefully — any
 * invalid/missing field is simply omitted, never treated as a load error. */
export function decodeSettingsFromSearchParams(search: string): Partial<CoreTuning> {
  const params = new URLSearchParams(search);
  const result: Partial<CoreTuning> = {};

  const carrierHz = parseBoundedNumber(params.get('c'), MIN_CARRIER_HZ, MAX_CARRIER_HZ);
  if (carrierHz !== undefined) result.carrierHz = carrierHz;

  const beatHz = parseBoundedNumber(params.get('b'), MIN_BEAT_HZ, MAX_BEAT_HZ);
  if (beatHz !== undefined) result.beatHz = beatHz;

  const bpm = parseBoundedNumber(params.get('t'), MIN_BPM, MAX_BPM);
  if (bpm !== undefined) result.bpm = bpm;

  const noiseType = params.get('n');
  if (noiseType && NOISE_TYPES.includes(noiseType as NoiseType)) {
    result.noiseType = noiseType as NoiseType;
  }

  return result;
}

/** Always call with LIVE current state — never a stale snapshot — so a
 * "Copy Link" button can't hand out a config that's gone stale mid-session. */
export function encodeSettingsToSearchParams(tuning: CoreTuning): URLSearchParams {
  const params = new URLSearchParams();
  params.set('c', String(tuning.carrierHz));
  params.set('b', String(tuning.beatHz));
  params.set('t', String(tuning.bpm));
  params.set('n', tuning.noiseType);
  return params;
}

/** Whether any recognized core-tuning param is present at all — used to
 * decide whether to clean the address bar via history.replaceState once
 * URL overrides have been adopted into state. */
export function hasAnyCoreTuningParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('c') || params.has('b') || params.has('t') || params.has('n');
}
