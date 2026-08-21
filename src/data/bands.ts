// ============================================================================
// Brainwave band data — the five classic EEG bands, each mapped to a beat
// (binaural offset) frequency range, a preset carrier/beat pair, and a
// color used throughout the UI (the waveform, the neuron glow, preset
// chips). Ported and adapted from a prototype binaural-beat lab; the ranges
// and preset numbers match that prototype's values.
// ============================================================================

export type BrainwaveBand = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';

export interface BandInfo {
  id: BrainwaveBand;
  label: string;
  rangeLabel: string;
  /** Inclusive upper bound of this band's beat frequency, in Hz. Gamma has
   * no upper bound here (anything above beta's ceiling). */
  maxBeatHz: number;
  color: string;
  glow: string;
  blurb: string;
}

export const BANDS: Record<BrainwaveBand, BandInfo> = {
  delta: {
    id: 'delta',
    label: 'Delta',
    rangeLabel: '0.5–4 Hz',
    maxBeatHz: 4,
    color: '#a78bfa',
    glow: 'rgba(167, 139, 250, 0.45)',
    blurb: 'Deep rest & recovery',
  },
  theta: {
    id: 'theta',
    label: 'Theta',
    rangeLabel: '4–8 Hz',
    maxBeatHz: 8,
    color: '#22d3ee',
    glow: 'rgba(34, 211, 238, 0.45)',
    blurb: 'Meditation & intuition',
  },
  alpha: {
    id: 'alpha',
    label: 'Alpha',
    rangeLabel: '8–13 Hz',
    maxBeatHz: 13,
    color: '#34d399',
    glow: 'rgba(52, 211, 153, 0.45)',
    blurb: 'Relaxed, flowing focus',
  },
  beta: {
    id: 'beta',
    label: 'Beta',
    rangeLabel: '14–30 Hz',
    maxBeatHz: 30,
    color: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.45)',
    blurb: 'Active, alert thinking',
  },
  gamma: {
    id: 'gamma',
    label: 'Gamma',
    rangeLabel: '30–50 Hz',
    maxBeatHz: Infinity,
    color: '#f472b6',
    glow: 'rgba(244, 114, 182, 0.45)',
    blurb: 'Peak binding & insight',
  },
};

export const BAND_ORDER: BrainwaveBand[] = ['delta', 'theta', 'alpha', 'beta', 'gamma'];

/** Which band a given beat (binaural offset) frequency falls into. */
export function classifyBeatFrequency(beatHz: number): BrainwaveBand {
  for (const id of BAND_ORDER) {
    if (beatHz <= BANDS[id].maxBeatHz) return id;
  }
  return 'gamma';
}

export interface MetronomePreset {
  id: BrainwaveBand;
  name: string;
  carrierHz: number;
  beatHz: number;
  bpm: number;
  blurb: string;
}

/** Five ready-to-use starting points, one per band — carrier/beat pairs
 * match the source prototype; BPM is a sensible tempo for each state
 * (slower for deep/rest bands, brisker for alert ones). */
export const PRESETS: MetronomePreset[] = [
  { id: 'delta', name: 'Deep Rest', carrierHz: 200, beatHz: 2.5, bpm: 48, blurb: BANDS.delta.blurb },
  { id: 'theta', name: 'Meditation', carrierHz: 200, beatHz: 6.0, bpm: 56, blurb: BANDS.theta.blurb },
  { id: 'alpha', name: 'Flow State', carrierHz: 200, beatHz: 10.0, bpm: 64, blurb: BANDS.alpha.blurb },
  { id: 'beta', name: 'Active Focus', carrierHz: 200, beatHz: 18.0, bpm: 84, blurb: BANDS.beta.blurb },
  { id: 'gamma', name: 'Peak Clarity', carrierHz: 200, beatHz: 40.0, bpm: 100, blurb: BANDS.gamma.blurb },
];

export const DEFAULT_PRESET = PRESETS[2]; // Alpha / Flow State
