import { describe, expect, it } from 'vitest';
import { makeSwingBuffer, makeTickBuffer, type RhythmSettings } from './continuousRhythm';
import { crossfadeLoop } from './loopSeam';
import { pendulumEase } from '../engine/motion';
import { mixHeadroom } from './mixHeadroom';

// These tests inspect sample data only. qa/audio.html separately renders
// the actual production nodes through the browser's OfflineAudioContext.
const context = {
  sampleRate: 48000,
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, sampleRate, duration: length / sampleRate, getChannelData: (channel: number) => data[channel] };
  },
} as BaseAudioContext;
const settings: RhythmSettings = {
  secondsPerBeat: 60 / 64, firstSide: -1, hangWeight: 0.5,
  tickSound: 'soft', tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200,
};

describe('native looping rhythm buffers', () => {
  it('follows exactly the visual easing and has a continuous loop seam', () => {
    const data = makeSwingBuffer(context, -1, 0.5).getChannelData(0);
    for (const phase of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]) {
      const expected = (phase < 1 ? -1 : 1) * (1 - 2 * pendulumEase(phase % 1, 0.5));
      expect(data[phase * 8000]).toBeCloseTo(expected, 6);
    }
    expect(Math.abs(data[0] - data[data.length - 1])).toBeLessThan(0.000001);
  });
  it.each(['soft', 'wood', 'kick', 'hihat'] as const)('%s starts and ends at zero and alternates ears', tickSound => {
    const buffer = makeTickBuffer(context, { ...settings, tickSound });
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    expect(left[0]).toBe(0);
    expect(left[left.length - 1]).toBe(0);
    expect(Math.max(...left.slice(0, 7000))).toBeGreaterThan(0.01);
    expect(Math.max(...right.slice(0, 7000))).toBeLessThan(1e-8);
    expect(Math.max(...right.slice(buffer.length / 2, buffer.length / 2 + 7000))).toBeGreaterThan(0.01);
  });
  it.each(['BOTH', 'OPPOSITE'] as const)('respects tick ear mode %s', tickEarMode => {
    const buffer = makeTickBuffer(context, { ...settings, tickEarMode });
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    if (tickEarMode === 'BOTH') {
      for (let i = 0; i < left.length; i++) expect(left[i]).toBeCloseTo(right[i], 6);
    } else {
      expect(Math.max(...left.slice(0, 7000))).toBeLessThan(1e-8);
      expect(Math.max(...right.slice(0, 7000))).toBeGreaterThan(0.01);
    }
  });
  it('center-only ticks are silent at the ends and equally centered', () => {
    const buffer = makeTickBuffer(context, { ...settings, tickSubdivision: 'CENTER' });
    expect(Math.max(...buffer.getChannelData(0).slice(0, 7000))).toBe(0);
    const offset = Math.round(buffer.length / 4);
    expect(Math.max(...buffer.getChannelData(0).slice(offset, offset + 7000))).toBeGreaterThan(0.01);
    expect(buffer.getChannelData(0)).toEqual(buffer.getChannelData(1));
  });
});

describe('noise loop seam', () => {
  it('joins adjacent source samples across the wrap, with a smooth crossfade exit', () => {
    const original = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 50));
    const loop = crossfadeLoop(original, 100);
    expect(loop.length).toBe(900);
    expect(loop[loop.length - 1]).toBe(original[899]);
    expect(loop[0]).toBe(original[900]);
    expect(loop[99]).toBe(original[99]);
    expect(loop[100]).toBe(original[100]);
  });
});

it('reserves headroom at every supported mixer level without altering ear balance', () => {
  for (const drone of [0, 0.55, 1]) for (const tick of [0, 0.7, 1]) for (const noise of [0, 0.08, 1]) {
    const maxPeak = drone + 1.2 * tick + noise + 1.35;
    expect(maxPeak * mixHeadroom(drone, tick, noise)).toBeCloseTo(0.95);
  }
});
