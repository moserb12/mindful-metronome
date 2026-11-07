import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANDS, type BrainwaveBand } from '../../data/bands';
import { MetronomeVisual } from './MetronomeVisual';

describe('vibe ring lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: ComponentProps<typeof MetronomeVisual>;
  let frame: FrameRequestCallback;
  let trace: Array<[number, number]>;
  let context: CanvasRenderingContext2D;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    trace = [];
    context = {
      setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(), stroke: vi.fn(),
      moveTo: (x: number, y: number) => trace.push([x, y]),
      lineTo: (x: number, y: number) => trace.push([x, y]),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    props = {
      isPlaying: false, band: 'alpha', swingRef: { current: null },
      getAudioTimeSec: () => 2, getAnalyser: vi.fn(() => null),
      lastTickSide: null, tickCount: 0, bpm: 64, onSetBpm: vi.fn(),
      sessionPhase: 'idle', sessionRef: { current: null }, tickSubdivision: 'ENDS',
      selectedMedallionId: 'spark', unlockedMedallionIds: ['spark'], onSelectMedallion: vi.fn(),
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  function render(changes: Partial<typeof props> = {}) {
    props = { ...props, ...changes };
    act(() => root.render(<MetronomeVisual {...props} />));
  }

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the ring on first load without creating or reading an audio engine', () => {
    render();
    expect(host.querySelector('.audio-ring-idle')?.getAttribute('stroke')).toBe(BANDS.alpha.color);
    expect(host.querySelector('canvas')!.hidden).toBe(true);
    expect(props.getAnalyser).not.toHaveBeenCalled();
  });

  it('immediately follows every vibe color before playback', () => {
    for (const band of Object.keys(BANDS) as BrainwaveBand[]) {
      render({ band });
      expect(host.querySelector('.audio-ring-idle')?.getAttribute('stroke')).toBe(BANDS[band].color);
    }
    expect(props.getAnalyser).not.toHaveBeenCalled();
  });

  it('switches to a stronger bounded audio trace, then restores the selected idle color on pause', () => {
    let audioTime = 2;
    const analyser = {
      fftSize: 2048,
      getFloatTimeDomainData: (samples: Float32Array) => samples.fill(6),
    } as unknown as AnalyserNode;
    render({ isPlaying: true, getAnalyser: () => analyser, getAudioTimeSec: () => audioTime });
    expect(host.querySelector('.audio-ring-idle')).toBeNull();
    const canvas = host.querySelector('canvas')!;
    Object.defineProperty(canvas, 'clientWidth', { value: 600 });
    expect(canvas.hidden).toBe(false);
    act(() => frame(0));
    const radius = Math.hypot(trace[0][0] - 300, trace[0][1] - 300);
    // The faster attack already travels farther than the old first frame.
    expect(radius).toBeGreaterThan(230);
    expect(radius).toBeLessThan(300);
    expect(context.strokeStyle).toBe(BANDS.alpha.color);
    audioTime += 0.25;
    trace.length = 0;
    act(() => frame(16));
    const peakRadius = Math.hypot(trace[0][0] - 300, trace[0][1] - 300);
    // Previous maximum radius was (0.34 + 0.075) * 600 = 249px.
    expect(peakRadius).toBeGreaterThan(249);
    expect(peakRadius).toBeLessThan(280);
    expect(trace).toHaveLength(193);
    const radii = trace.map(([x, y]) => Math.hypot(x - 300, y - 300));
    for (let point = 0; point < 64; point++) {
      expect(radii[point]).toBeCloseTo(radii[point + 64], 5);
      expect(radii[point]).toBeCloseTo(radii[point + 128], 5);
    }
    render({ band: 'gamma' });
    act(() => frame(16));
    expect(context.strokeStyle).toBe(BANDS.gamma.color);
    render({ isPlaying: false, band: 'theta' });
    expect(canvas.hidden).toBe(true);
    expect(host.querySelector('.audio-ring-idle')?.getAttribute('stroke')).toBe(BANDS.theta.color);
    render({ band: 'beta' });
    expect(host.querySelector('.audio-ring-idle')?.getAttribute('stroke')).toBe(BANDS.beta.color);
  });
});
