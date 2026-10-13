import { describe, expect, it } from 'vitest';
import { NOISE_SHIELD_ORDER, normalizeNoiseShieldType } from './noiseShields';

describe('selectable noise shields', () => {
  it('only offers the three steady noise colors', () => {
    expect(NOISE_SHIELD_ORDER).toEqual(['pink', 'white', 'brown']);
  });

  it('migrates a legacy environmental texture to pink', () => {
    expect(normalizeNoiseShieldType('rainyForest')).toBe('pink');
    expect(normalizeNoiseShieldType('tinRoof')).toBe('pink');
    expect(normalizeNoiseShieldType('drippyCavern')).toBe('pink');
  });
});
