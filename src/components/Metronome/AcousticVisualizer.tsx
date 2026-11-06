import { useEffect, useRef, useState } from 'react';

// ============================================================================
// AcousticVisualizer — a literal, technical reading of the combined signal
// (drone + tick + noise, everything hitting the speakers/headphones at
// once), as an oscilloscope or a frequency spectrum. Adapted from a
// prototype the builder liked specifically for this piece.
//
// Deliberately separate from the "chill" smoothed ring drawn on the eye in
// MetronomeVisual — that ring is ambient decoration built into the
// instrument itself; this panel is the opposite: an honest, unsmoothed
// acoustic reading, useful for actually seeing the interference pattern
// between the two binaural tones. Both read from the same AnalyserNode
// (BinauralEngine.analyser), just rendered differently.
// ============================================================================

type VisualizerMode = 'oscilloscope' | 'spectrum';

interface AcousticVisualizerProps {
  isPlaying: boolean;
  getAnalyser: () => AnalyserNode | null;
  bandColor: string;
}

export function AcousticVisualizer({ isPlaying, getAnalyser, bandColor }: AcousticVisualizerProps) {
  const [mode, setMode] = useState<VisualizerMode>('oscilloscope');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    if (!isPlaying) return;

    let waveform = new Float32Array(0);
    let spectrum = new Uint8Array(0);

    function draw() {
      const canvas = canvasRef.current;
      const analyser = getAnalyser();
      if (!canvas || !analyser) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (modeRef.current === 'oscilloscope') {
        // This analyser is before the mix trim, so boosted samples can
        // exceed +/-1. Byte samples would clip them into flat plateaus.
        if (waveform.length !== analyser.fftSize) waveform = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(waveform);
        let peak = 1;
        for (const sample of waveform) peak = Math.max(peak, Math.abs(sample));
        // One linear scale for the entire trace preserves its shape and
        // leaves 5% clearance at each edge, including loud transients.
        const amplitude = height * 0.45 / peak;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = bandColor;
        ctx.beginPath();
        const sliceWidth = width / (waveform.length - 1);
        for (let i = 0; i < waveform.length; i++) {
          const x = i * sliceWidth;
          const y = height / 2 + waveform[i] * amplitude;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        const bufferLength = analyser.frequencyBinCount;
        if (spectrum.length !== bufferLength) spectrum = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(spectrum);
        const bars = 96;
        const barWidth = width / bars;
        for (let i = 0; i < bars; i++) {
          const idx = Math.floor((i / bars) * bufferLength);
          const barHeight = (spectrum[idx] / 255) * height;
          const t = i / bars;
          const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
          gradient.addColorStop(0, `color-mix(in srgb, ${bandColor} ${30 + t * 40}%, transparent)`);
          gradient.addColorStop(1, bandColor);
          ctx.fillStyle = gradient;
          ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, getAnalyser, bandColor]);

  return (
    <div className="visualizer-panel">
      <div className="visualizer-panel-head">
        <span className="control-label">Acoustic interference waveform</span>
        <div className="visualizer-mode-toggle" style={{ '--chip-color': bandColor } as React.CSSProperties}>
          <button
            type="button"
            className={mode === 'oscilloscope' ? 'active' : ''}
            onClick={() => setMode('oscilloscope')}
          >
            Oscilloscope
          </button>
          <button type="button" className={mode === 'spectrum' ? 'active' : ''} onClick={() => setMode('spectrum')}>
            Spectrum
          </button>
        </div>
      </div>
      <div className="visualizer-canvas-wrap">
        <canvas ref={canvasRef} className="visualizer-canvas" aria-hidden="true" />
        {!isPlaying && <span className="visualizer-inactive-note">Audio engine inactive</span>}
      </div>
    </div>
  );
}
