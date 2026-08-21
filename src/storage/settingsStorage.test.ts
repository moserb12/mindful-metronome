import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, type PersistedSettings } from './settingsStorage';

const VALID: PersistedSettings = {
  carrierHz: 220,
  beatHz: 10,
  bpm: 64,
  tickSound: 'wood',
  masterVolume: 0.9,
  droneVolume: 0.5,
  tickVolume: 0.6,
  noiseVolume: 0.1,
  noiseType: 'brown',
  panModulationDepth: 0.4,
  tickEarMode: 'OPPOSITE',
  hapticsEnabled: true,
  lastSelectedSessionDurationMinutes: 20,
};

describe('settingsStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a full valid settings object', () => {
    saveSettings(VALID);
    expect(loadSettings()).toEqual(VALID);
  });

  it('returns an empty object when nothing is stored', () => {
    expect(loadSettings()).toEqual({});
  });

  it('returns an empty object for unparseable JSON, without throwing', () => {
    window.localStorage.setItem('mindful-metronome:settings:v1', 'not json{{{');
    expect(loadSettings()).toEqual({});
  });

  it('drops only the corrupt field, keeping every other valid field', () => {
    const corrupted = { ...VALID, bpm: 9999, noiseType: 'ultraviolet' };
    window.localStorage.setItem('mindful-metronome:settings:v1', JSON.stringify(corrupted));
    const loaded = loadSettings();
    expect(loaded.bpm).toBeUndefined();
    expect(loaded.noiseType).toBeUndefined();
    expect(loaded.carrierHz).toBe(VALID.carrierHz);
    expect(loaded.tickEarMode).toBe(VALID.tickEarMode);
  });

  it('accepts null (Open-ended) for the session duration field', () => {
    saveSettings({ ...VALID, lastSelectedSessionDurationMinutes: null });
    expect(loadSettings().lastSelectedSessionDurationMinutes).toBe(null);
  });

  it('ignores unknown extra fields without error', () => {
    window.localStorage.setItem(
      'mindful-metronome:settings:v1',
      JSON.stringify({ ...VALID, someFutureField: 'whatever' })
    );
    expect(loadSettings()).toEqual(VALID);
  });
});
