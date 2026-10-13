import { describe, expect, it } from 'vitest';
import { computeDroneEarGains, formatPanSplit } from './dronePanning';

describe('drone panning', () => {
  it('creates a left-favored 90/10 split at the left extreme', () => {
    expect(formatPanSplit(0.8)).toBe('90/10');
    const gains = computeDroneEarGains(-1, 0.8, 1);
    expect(gains.left).toBeCloseTo(0.9);
    expect(gains.right).toBeCloseTo(0.1);
  });

  it('mirrors the levels at the right extreme', () => {
    const gains = computeDroneEarGains(1, 0.8, 1);
    expect(gains.left).toBeCloseTo(0.1);
    expect(gains.right).toBeCloseTo(0.9);
  });

  it('keeps both ears equal at center without changing total loudness', () => {
    const leftExtreme = computeDroneEarGains(-1, 0.8, 0.7);
    const center = computeDroneEarGains(0, 0.8, 0.7);
    const rightExtreme = computeDroneEarGains(1, 0.8, 0.7);

    expect(center.left).toBeCloseTo(center.right);
    expect(center.left + center.right).toBeCloseTo(leftExtreme.left + leftExtreme.right);
    expect(center.left + center.right).toBeCloseTo(rightExtreme.left + rightExtreme.right);
  });

  it('clamps values outside the supported ranges', () => {
    expect(computeDroneEarGains(-2, 2, 2)).toEqual({ left: 1, right: 0 });
    expect(computeDroneEarGains(2, -1, -1)).toEqual({ left: 0, right: 0 });
  });
});
