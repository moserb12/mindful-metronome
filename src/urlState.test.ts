import { describe, expect, it } from 'vitest';
import { decodeSettingsFromSearchParams, encodeSettingsToSearchParams, hasAnyCoreTuningParams } from './urlState';

describe('urlState', () => {
  it('round-trips a valid core-tuning encode/decode', () => {
    const params = encodeSettingsToSearchParams({ carrierHz: 220, beatHz: 10, bpm: 64, noiseType: 'brown' });
    const decoded = decodeSettingsFromSearchParams(`?${params.toString()}`);
    expect(decoded).toEqual({ carrierHz: 220, beatHz: 10, bpm: 64, noiseType: 'brown' });
  });

  it('decodes nothing from an empty query string', () => {
    expect(decodeSettingsFromSearchParams('')).toEqual({});
  });

  it('drops out-of-range fields instead of clamping or throwing', () => {
    const decoded = decodeSettingsFromSearchParams('?c=99999&b=10&t=64&n=pink');
    expect(decoded.carrierHz).toBeUndefined();
    expect(decoded.beatHz).toBe(10);
  });

  it('drops a non-numeric field instead of throwing', () => {
    const decoded = decodeSettingsFromSearchParams('?c=not-a-number&t=64');
    expect(decoded.carrierHz).toBeUndefined();
    expect(decoded.bpm).toBe(64);
  });

  it('drops an unrecognized noise type', () => {
    const decoded = decodeSettingsFromSearchParams('?n=ultraviolet');
    expect(decoded.noiseType).toBeUndefined();
  });

  it('decodes a partial link (only some fields present)', () => {
    expect(decodeSettingsFromSearchParams('?t=90')).toEqual({ bpm: 90 });
  });

  it('hasAnyCoreTuningParams is true for any single recognized field', () => {
    expect(hasAnyCoreTuningParams('?n=white')).toBe(true);
    expect(hasAnyCoreTuningParams('?unrelated=1')).toBe(false);
    expect(hasAnyCoreTuningParams('')).toBe(false);
  });
});
