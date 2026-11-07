import { describe, expect, it } from 'vitest';
import { AUDIO_RING_MAX_DISTORTION, audioRingOffset, updateAudioRingLevels } from './audioRing';

function tone(amplitude: number, phase = 0): Float32Array {
  return Float32Array.from({ length: 2048 }, (_, i) => amplitude * Math.sin(i * Math.PI / 16 + phase));
}

describe('audio ring response', () => {
  it('visibly responds to quiet tones within a single frame', () => {
    const levels = new Float32Array(64);
    updateAudioRingLevels(tone(0.02), levels, 1 / 60);
    // At 600px this produces over a pixel of movement on the first frame.
    expect(Math.min(...levels) * 600 * AUDIO_RING_MAX_DISTORTION).toBeGreaterThan(1);
  });

  it('retains motion when the waveform reverses phase between frames', () => {
    const levels = new Float32Array(64);
    updateAudioRingLevels(tone(0.1), levels, 1 / 60);
    const first = levels[0];
    updateAudioRingLevels(tone(0.1, Math.PI), levels, 1 / 60);
    expect(levels[0]).toBeGreaterThan(first);
  });

  it('keeps silence still and releases naturally after a loud tick', () => {
    const silence = new Float32Array(2048);
    const levels = new Float32Array(64);
    updateAudioRingLevels(silence, levels, 1 / 60);
    expect(levels.every(level => level === 0)).toBe(true);
    const tick = new Float32Array(2048);
    tick[0] = 0.8;
    updateAudioRingLevels(tick, levels, 1 / 60);
    const peak = levels[0];
    expect(peak).toBeGreaterThan(0.2);
    updateAudioRingLevels(silence, levels, 1 / 60);
    expect(levels[0]).toBeGreaterThan(peak * 0.8);
    updateAudioRingLevels(silence, levels, 0.6);
    expect(levels[0]).toBeLessThan(peak * 0.05);
  });

  it('remains bounded for boosted audio and behaves equally at different frame rates', () => {
    const slow = new Float32Array(64), fast = new Float32Array(64);
    const loud = tone(6);
    for (let frame = 0; frame < 30; frame++) updateAudioRingLevels(loud, slow, 1 / 30);
    for (let frame = 0; frame < 120; frame++) updateAudioRingLevels(loud, fast, 1 / 120);
    for (let point = 0; point < slow.length; point++) {
      expect(slow[point]).toBeCloseTo(fast[point], 5);
      expect(slow[point]).toBeGreaterThan(0);
      expect(slow[point]).toBeLessThanOrEqual(1);
    }
  });
});

describe('three-section ring shape', () => {
  it('has exactly three smooth peaks, repeating every third of a turn', () => {
    const offsets = Array.from({ length: 720 }, (_, i) => audioRingOffset(i * Math.PI * 2 / 720, 0.8));
    const peaks = offsets.filter((value, i) => value > offsets[(i + 719) % 720] && value > offsets[(i + 1) % 720]);
    expect(peaks).toHaveLength(3);
    for (let i = 0; i < 240; i++) {
      expect(offsets[i]).toBeCloseTo(offsets[i + 240], 6);
      expect(offsets[i]).toBeCloseTo(offsets[i + 480], 6);
    }
    expect(audioRingOffset(0, 0.8)).toBeCloseTo(audioRingOffset(Math.PI * 2, 0.8), 6);
  });

  it('pulls inward and outward more strongly with audio, within the canvas bounds', () => {
    expect(audioRingOffset(0, 1)).toBeGreaterThan(0.10);
    expect(audioRingOffset(Math.PI / 3, 1)).toBeLessThan(0);
    expect(audioRingOffset(0, 0)).toBe(0);
    expect(audioRingOffset(0, 0.2)).toBeLessThan(audioRingOffset(0, 0.8));
    for (let i = 0; i <= 360; i++) {
      const radius = 0.34 + audioRingOffset(i * Math.PI / 180, 6);
      expect(radius).toBeGreaterThan(0.25);
      expect(radius).toBeLessThan(0.48);
    }
  });

  it('keeps audible level changes visible above the previous saturation range', () => {
    const quieter = new Float32Array(1), louder = new Float32Array(1);
    updateAudioRingLevels(tone(1), quieter, 1);
    updateAudioRingLevels(tone(2), louder, 1);
    expect(audioRingOffset(0, louder[0]) - audioRingOffset(0, quieter[0])).toBeGreaterThan(0.008);
  });
});
