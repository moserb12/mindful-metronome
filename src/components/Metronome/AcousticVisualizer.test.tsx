import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcousticVisualizer } from './AcousticVisualizer';

describe('oscilloscope drawing', () => {
  let root: Root;
  let host: HTMLDivElement;
  let frame: FrameRequestCallback;
  let points: Array<[number, number]>;
  let samples: number[];
  let analyser: AnalyserNode;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    points = [];
    samples = [0, 1, 2, 1, 0, -1, -2, -1];
    const context = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
      moveTo: (x: number, y: number) => points.push([x, y]),
      lineTo: (x: number, y: number) => points.push([x, y]),
      createLinearGradient: () => ({ addColorStop: vi.fn() }), fillRect: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    analyser = {
      fftSize: 8,
      frequencyBinCount: 4,
      getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.set(samples)),
      getByteTimeDomainData: vi.fn(),
      getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
    } as unknown as AnalyserNode;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<AcousticVisualizer isPlaying getAnalyser={() => analyser} bandColor="#ffffff" />));
    Object.defineProperties(host.querySelector('canvas')!, {
      clientWidth: { value: 200 }, clientHeight: { value: 100 },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves distinct peaks above full scale and fits the whole trace inside the canvas', () => {
    frame(0);
    expect(analyser.getByteTimeDomainData).not.toHaveBeenCalled();
    expect(points).toHaveLength(samples.length);
    expect(points[0]).toEqual([0, 50]);
    expect(points[1][1]).toBeCloseTo(72.5);
    expect(points[2][1]).toBeCloseTo(95);
    expect(points[5][1]).toBeCloseTo(27.5);
    expect(points[6][1]).toBeCloseTo(5);
    expect(points[points.length - 1][0]).toBeCloseTo(200);
    for (const [, y] of points) {
      expect(y).toBeGreaterThanOrEqual(5);
      expect(y).toBeLessThanOrEqual(95);
    }
  });

  it('keeps quiet signals smaller and draws silence along the center', () => {
    samples = samples.map(sample => sample / 4);
    frame(0);
    expect(points[2][1]).toBeCloseTo(72.5);
    expect(points[6][1]).toBeCloseTo(27.5);
    samples.fill(0);
    points.length = 0;
    frame(16);
    expect(points.every(([, y]) => y === 50)).toBe(true);
  });

  it('reuses the sample buffer while fitting a louder transient on the next frame', () => {
    frame(0);
    samples = samples.map(sample => sample * 4);
    points.length = 0;
    frame(16);
    const reads = vi.mocked(analyser.getFloatTimeDomainData).mock.calls;
    expect(reads[0][0]).toBe(reads[1][0]);
    expect(points[2][1]).toBeCloseTo(95);
    expect(points[6][1]).toBeCloseTo(5);
  });

  it('continues to read frequency data when switched to Spectrum', () => {
    act(() => host.querySelectorAll('button')[1].click());
    frame(0);
    expect(analyser.getByteFrequencyData).toHaveBeenCalledOnce();
    expect(analyser.getFloatTimeDomainData).not.toHaveBeenCalled();
  });
});
