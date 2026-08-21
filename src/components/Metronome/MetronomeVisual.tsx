import { useEffect, useRef } from 'react';
import { BANDS, type BrainwaveBand } from '../../data/bands';
import type { SwingState } from '../../hooks/useMetronomeEngine';

// ============================================================================
// MetronomeVisual — the "quantum metronome": an eye at the center of a
// pyramid, two neuron clusters (one per hemisphere), and a pendulum arm
// swinging between the pyramid's two base corners. This is not decoration
// around the instrument — it IS the instrument. The eye is the pivot the
// arm hangs from; each base corner is a "hemisphere"; a soft waveform ring
// breathes around the eye, color-coded by the current brainwave band.
//
// Sync strategy: the arm's rotation and the waveform ring are both written
// directly to DOM/canvas inside one requestAnimationFrame loop, reading
// live AudioContext time — never React state, never a CSS animation with a
// guessed duration. That's what keeps the visual PERFECTLY locked to the
// audio regardless of frame jank, exactly like Brain Bridging Beats' own
// beat-driven visuals. The loop only runs while playing, so an idle tab
// costs nothing.
// ============================================================================

const VIEW = 400;
const PIVOT = { x: 200, y: 92 };
const BASE_LEFT = { x: 62, y: 322 };
const BASE_RIGHT = { x: 338, y: 322 };
const EYE = { x: 200, y: 224 };

function angleToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  // Degrees, 0 = straight down, positive = toward the right.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

const LEFT_ANGLE = angleToward(PIVOT, BASE_LEFT);
const RIGHT_ANGLE = angleToward(PIVOT, BASE_RIGHT);
const ARM_LENGTH = Math.hypot(BASE_LEFT.x - PIVOT.x, BASE_LEFT.y - PIVOT.y);

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

interface NeuronClusterProps {
  side: 'left' | 'right';
  color: string;
  pulseToken: string;
}

/** A handful of small nodes along one side of the pyramid, connected to the
 * eye by thin lines. Re-keyed by `pulseToken` so it remounts (replaying its
 * CSS pulse animation) only when THIS side's tick just sounded. */
function NeuronCluster({ side, color, pulseToken }: NeuronClusterProps) {
  const base = side === 'left' ? BASE_LEFT : BASE_RIGHT;
  const nodes = [0.28, 0.5, 0.7].map((t) => ({
    x: PIVOT.x + (base.x - PIVOT.x) * t + (side === 'left' ? -18 : 18) * t,
    y: PIVOT.y + (base.y - PIVOT.y) * t,
  }));

  return (
    <g key={pulseToken} className="neuron-cluster">
      {nodes.map((n, i) => (
        <g key={i}>
          <line x1={EYE.x} y1={EYE.y} x2={n.x} y2={n.y} stroke={color} strokeWidth={0.6} opacity={0.35} />
          <circle className="neuron-node" cx={n.x} cy={n.y} r={3.2} fill={color} style={{ animationDelay: `${i * 70}ms` }} />
        </g>
      ))}
    </g>
  );
}

interface MetronomeVisualProps {
  isPlaying: boolean;
  band: BrainwaveBand;
  swingRef: React.RefObject<SwingState | null>;
  getAudioTimeSec: () => number;
  getAnalyser: () => AnalyserNode | null;
  lastTickSide: 'left' | 'right' | null;
  tickCount: number;
}

export function MetronomeVisual({
  isPlaying,
  band,
  swingRef,
  getAudioTimeSec,
  getAnalyser,
  lastTickSide,
  tickCount,
}: MetronomeVisualProps) {
  const armRef = useRef<SVGGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<number[] | null>(null);
  const rafRef = useRef<number | null>(null);

  const bandInfo = BANDS[band];

  useEffect(() => {
    if (!isPlaying) {
      // Resting pose: arm hangs straight down, no animation loop running.
      if (armRef.current) armRef.current.style.transform = `rotate(0deg)`;
      return;
    }

    function frame() {
      const arm = armRef.current;
      const swing = swingRef.current;
      const now = getAudioTimeSec();

      if (arm) {
        let angle = 0;
        let wiggle = 0;
        if (swing) {
          const span = swing.toTimeSec - swing.fromTimeSec;
          const t = span > 0 ? Math.min(1, Math.max(0, (now - swing.fromTimeSec) / span)) : 1;
          const eased = easeInOutSine(t);
          const fromDeg = swing.fromSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
          const toDeg = swing.toSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
          angle = fromDeg + (toDeg - fromDeg) * eased;

          // A short, decaying vibration layered on top the instant the tip
          // arrives at a side (when the tick actually sounds) — the
          // "wiggle" the tone triggers, distinct from the smooth swing.
          const sinceArrival = now - swing.toTimeSec;
          if (sinceArrival >= 0 && sinceArrival < 0.35) {
            wiggle = Math.exp(-sinceArrival * 14) * Math.sin(sinceArrival * 60) * 4;
          }
        }
        arm.style.transform = `rotate(${angle + wiggle}deg)`;
      }

      drawWaveform();
      rafRef.current = requestAnimationFrame(frame);
    }

    function drawWaveform() {
      const canvas = canvasRef.current;
      const analyser = getAnalyser();
      if (!canvas || !analyser) return;

      const dpr = window.devicePixelRatio || 1;
      const size = canvas.clientWidth;
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const bufferLength = analyser.frequencyBinCount;
      const data = new Uint8Array(bufferLength);
      analyser.getByteTimeDomainData(data);

      // Heavily smoothed + downsampled ring — "chilled", not a jagged
      // oscilloscope. Exponential smoothing per point across frames gives
      // it a slow, breathing quality even though the underlying signal
      // updates every frame.
      const points = 64;
      if (!smoothedRef.current || smoothedRef.current.length !== points) {
        smoothedRef.current = new Array(points).fill(0);
      }
      const smoothed = smoothedRef.current;

      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.34;
      const amp = size * 0.05;

      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const idx = Math.floor((i % points) * (bufferLength / points));
        const sample = (data[idx] - 128) / 128;
        smoothed[i % points] = smoothed[i % points] * 0.9 + sample * 0.1;
        const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
        const r = baseRadius + smoothed[i % points] * amp;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = bandInfo.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, bandInfo.color]);

  return (
    <div className="metronome-visual" style={{ '--band-color': bandInfo.color, '--band-glow': bandInfo.glow } as React.CSSProperties}>
      <canvas ref={canvasRef} className="metronome-waveform" aria-hidden="true" />
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="metronome-svg" role="img" aria-label="Mindful Metronome visual">
        <path
          d={`M ${PIVOT.x} 48 L ${BASE_RIGHT.x} ${BASE_RIGHT.y} L ${BASE_LEFT.x} ${BASE_LEFT.y} Z`}
          className="pyramid-outline"
        />

        <NeuronCluster side="left" color={bandInfo.color} pulseToken={lastTickSide === 'left' ? `L${tickCount}` : 'L-idle'} />
        <NeuronCluster side="right" color={bandInfo.color} pulseToken={lastTickSide === 'right' ? `R${tickCount}` : 'R-idle'} />

        <g ref={armRef} className="metronome-arm" style={{ transformOrigin: `${PIVOT.x}px ${PIVOT.y}px` }}>
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y + ARM_LENGTH} className="metronome-arm-line" />
          <circle cx={PIVOT.x} cy={PIVOT.y + ARM_LENGTH} r={7} className="metronome-arm-tip" />
        </g>

        <circle cx={PIVOT.x} cy={PIVOT.y} r={5} className="metronome-pivot-dot" />

        <g className="metronome-eye">
          <circle cx={EYE.x} cy={EYE.y} r={38} className="eye-outer" />
          <circle cx={EYE.x} cy={EYE.y} r={22} className="eye-iris" />
          <circle cx={EYE.x} cy={EYE.y} r={9} className="eye-pupil" />
        </g>
      </svg>
    </div>
  );
}
