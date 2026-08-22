import { beforeEach, describe, expect, it } from 'vitest';
import { loadCustomPresets, saveCustomPresets } from './customPresetsStorage';
import type { CustomPreset } from '../data/customPresets';

const PRESET: CustomPreset = {
  id: 'custom-abc123',
  name: 'My Focus Mix',
  carrierHz: 220,
  beatHz: 10,
  bpm: 64,
  masterVolume: 0.9,
  droneVolume: 0.5,
  tickVolume: 0.6,
  noiseVolume: 0.1,
  noiseType: 'brown',
  tickSound: 'wood',
  panModulationDepth: 0.4,
  tickEarMode: 'OPPOSITE',
  tickSubdivision: 'ENDS_AND_CENTER',
  createdAt: 1700000000000,
};

describe('customPresetsStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a valid list of presets', () => {
    saveCustomPresets([PRESET]);
    expect(loadCustomPresets()).toEqual([PRESET]);
  });

  it('returns an empty array when nothing is stored', () => {
    expect(loadCustomPresets()).toEqual([]);
  });

  it('returns an empty array for unparseable JSON, without throwing', () => {
    window.localStorage.setItem('mindful-metronome:custom-presets:v1', 'not json{{{');
    expect(loadCustomPresets()).toEqual([]);
  });

  it('returns an empty array if the stored value is not an array', () => {
    window.localStorage.setItem('mindful-metronome:custom-presets:v1', JSON.stringify({ not: 'an array' }));
    expect(loadCustomPresets()).toEqual([]);
  });

  it('filters out one corrupt entry while keeping the valid ones', () => {
    const corrupt = { ...PRESET, id: 'custom-bad', bpm: 99999 };
    window.localStorage.setItem('mindful-metronome:custom-presets:v1', JSON.stringify([PRESET, corrupt]));
    expect(loadCustomPresets()).toEqual([PRESET]);
  });
});
