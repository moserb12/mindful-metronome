import { describe, expect, it } from 'vitest';
import { buildSmoothPath, clamp, pendulumEase, waveOffset } from './motion';

describe('clamp', () => {
  it('passes through values already in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('clamps below the minimum', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it('clamps above the maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('pendulumEase', () => {
  it('starts at 0 and ends at 1 regardless of hangWeight', () => {
    for (const hangWeight of [0, 0.3, 0.5, 0.85, 1]) {
      expect(pendulumEase(0, hangWeight)).toBeCloseTo(0, 10);
      expect(pendulumEase(1, hangWeight)).toBeCloseTo(1, 10);
    }
  });

  it('reduces to plain ease-in-out-sine when hangWeight is 1', () => {
    const sine = -(Math.cos(Math.PI * 0.25) - 1) / 2;
    expect(pendulumEase(0.25, 1)).toBeCloseTo(sine, 10);
  });

  it('reduces to plain cubic-in-out when hangWeight is 0', () => {
    const cubic = 4 * 0.25 * 0.25 * 0.25; // t < 0.5 branch
    expect(pendulumEase(0.25, 0)).toBeCloseTo(cubic, 10);
  });

  it('is monotonically increasing across t for a mid-range hangWeight', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = pendulumEase(t, 0.5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('passes through 0.5 at t=0.5 for any hangWeight (both curves are symmetric)', () => {
    for (const hangWeight of [0, 0.4, 1]) {
      expect(pendulumEase(0.5, hangWeight)).toBeCloseTo(0.5, 10);
    }
  });
});

describe('waveOffset', () => {
  const armLength = 269.07;

  it('is exactly zero at the pivot (s=0)', () => {
    expect(waveOffset(0, armLength, 1.3, 2.5)).toBeCloseTo(0, 9);
  });

  it('is exactly zero at the tip (s=armLength)', () => {
    expect(waveOffset(armLength, armLength, 1.3, 2.5)).toBeCloseTo(0, 9);
  });

  it('scales linearly with amplitude', () => {
    const a = waveOffset(100, armLength, 0.7, 3);
    const b = waveOffset(100, armLength, 0.7, 6);
    expect(b).toBeCloseTo(a * 2, 9);
  });

  it('is zero everywhere when amplitude is zero', () => {
    for (let s = 0; s <= armLength; s += 30) {
      expect(waveOffset(s, armLength, 1.9, 0)).toBeCloseTo(0, 9);
    }
  });
});

describe('buildSmoothPath', () => {
  it('returns empty string for zero points', () => {
    expect(buildSmoothPath([])).toBe('');
  });

  it('returns a single moveto for one point', () => {
    expect(buildSmoothPath([{ x: 5, y: 10 }])).toBe('M 5 10');
  });

  it('starts with M at the first point and ends with L at the last point', () => {
    const d = buildSmoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('L 20 0')).toBe(true);
    expect(d).toContain('Q');
  });
});
