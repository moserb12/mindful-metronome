import { describe, expect, it } from 'vitest';
import { buildPinkNoiseBuffer, buildWhiteNoiseBuffer, buildBrownNoiseBuffer } from './binauralEngine';
import { makeTickBuffer, type RhythmSettings } from './continuousRhythm';
import { calibrateNoiseBuffer } from './volumeCalibration';

const context = {
  sampleRate: 48000,
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, getChannelData: (channel: number) => data[channel] };
  },
} as AudioContext;

function levels(samples: Float32Array) {
  let sum = 0, peak = 0;
  for (const x of samples) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
  return { rms: Math.sqrt(sum / samples.length), peak };
}

describe('mixer source calibration', () => {
  it.each([['pink', buildPinkNoiseBuffer], ['white', buildWhiteNoiseBuffer], ['brown', buildBrownNoiseBuffer]] as const)('%s noise is similar at 50% and full level', (_name, build) => {
    const source = calibrateNoiseBuffer(build(context)).getChannelData(0);
    const { rms, peak } = levels(source);
    expect(rms).toBeGreaterThan(0.17);
    expect(rms).toBeLessThanOrEqual(0.205);
    expect(peak).toBeLessThanOrEqual(0.951);
    expect(levels(source.map(sample => sample * 0.5)).rms).toBeCloseTo(rms * 0.5, 5);
  });

  it.each(['soft', 'wood', 'kick', 'hihat'] as const)('%s tick has a controlled peak at 50% and full level', tickSound => {
    const settings: RhythmSettings = { secondsPerBeat: 60 / 64, firstSide: -1, hangWeight: 0.5, tickSound: 'soft', tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200 };
    const buffer = makeTickBuffer(context, { ...settings, tickSound });
    const source = buffer.getChannelData(0).slice(0, context.sampleRate * 0.12);
    const { peak } = levels(source);
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(0.801);
    expect(levels(source.map(sample => sample * 0.5)).peak).toBeCloseTo(peak * 0.5, 5);
  });

  it('preserves the softer offbeat accent after calibration', () => {
    const settings: RhythmSettings = { secondsPerBeat: 60 / 64, firstSide: -1, hangWeight: 0.5, tickSound: 'soft', tickEarMode: 'MATCH', tickSubdivision: 'ENDS_AND_CENTER', carrierHz: 200 };
    const buffer = makeTickBuffer(context, settings);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const endPeak = levels(left.slice(0, context.sampleRate * 0.12)).peak;
    const centerStart = Math.round(buffer.length / 4);
    const centerLeftPeak = levels(left.slice(centerStart, centerStart + context.sampleRate * 0.12)).peak;
    const centerRightPeak = levels(right.slice(centerStart, centerStart + context.sampleRate * 0.12)).peak;
    // Centered stereo tick is split equally between ears.
    const centerCombinedPeak = Math.hypot(centerLeftPeak, centerRightPeak);
    expect(centerCombinedPeak / endPeak).toBeCloseTo(0.55, 1);
  });
});
