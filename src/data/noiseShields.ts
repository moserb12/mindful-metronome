// ============================================================================
// Noise shield data — user-facing description of each texture the "Noise
// shield" layer can play (see BinauralEngine's buildPinkNoiseBuffer /
// buildWhiteNoiseBuffer / buildBrownNoiseBuffer for the synthesis, and its
// file-level comment for why all three were loudness-matched so switching
// between them mid-session doesn't jump in volume). Pairing guidance below
// follows the same brightness-to-alertness logic as the noise itself: the
// brighter/higher-energy the shield, the better it suits the more alert
// bands and brisker tempos; the deeper/bassier the shield, the better it
// suits the slower, more restful ones. Pink sits in the middle, which is
// also why it's the default.
// ============================================================================

import type { BrainwaveBand } from './bands';
import type { NoiseType } from '../audio/binauralEngine';

export interface NoiseShieldInfo {
  id: NoiseType;
  label: string;
  description: string;
  pairsWithBands: BrainwaveBand[];
  tempoHint: string;
}

export const NOISE_SHIELDS: Record<NoiseType, NoiseShieldInfo> = {
  pink: {
    id: 'pink',
    label: 'Pink',
    description:
      'Softer and warmer than white, with more energy in the low end — close to steady rain or wind. The most broadly comfortable shield for long sessions.',
    pairsWithBands: ['alpha', 'theta'],
    tempoHint: 'moderate tempos (60–84 BPM)',
  },
  white: {
    id: 'white',
    label: 'White',
    description:
      'Equal energy across every frequency — the brightest, most even shield. Best at masking sudden background noise when you need to stay alert.',
    pairsWithBands: ['beta', 'gamma'],
    tempoHint: 'brisker tempos (84–160 BPM)',
  },
  brown: {
    id: 'brown',
    label: 'Brown',
    description:
      'Deep and rumbling, with even more bass than pink and almost no high end — like a distant waterfall. The most soothing shield for winding down.',
    pairsWithBands: ['delta', 'theta'],
    tempoHint: 'slower tempos (30–56 BPM)',
  },
  rainyForest: {
    id: 'rainyForest',
    label: 'Rainy Forest',
    description:
      'A soft pink-noise bed with scattered droplets falling through leaves — organic and textured rather than pure static. A gentle backdrop that still feels alive.',
    pairsWithBands: ['alpha', 'theta'],
    tempoHint: 'moderate tempos (60–84 BPM)',
  },
  tinRoof: {
    id: 'tinRoof',
    label: 'Tin Roof',
    description:
      'Sparse, bright pings landing at their own pace — like rain on a metal roof. Enough texture to hold attention without competing with the beat.',
    pairsWithBands: ['beta', 'gamma'],
    tempoHint: 'brisker tempos (84–160 BPM)',
  },
  drippyCavern: {
    id: 'drippyCavern',
    label: 'Drippy Cavern',
    description:
      'A near-silent rumble with the occasional echoing drip, each one trailing off into the dark. The deepest, most spacious shield for winding all the way down.',
    pairsWithBands: ['delta', 'theta'],
    tempoHint: 'slower tempos (30–56 BPM)',
  },
};

export const NOISE_SHIELD_ORDER: NoiseType[] = ['pink', 'white', 'brown', 'rainyForest', 'tinRoof', 'drippyCavern'];
