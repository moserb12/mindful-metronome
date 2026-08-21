import { useEffect, useRef } from 'react';
import { BANDS, type BrainwaveBand } from '../../data/bands';
import { computeSwingSegment, type SwingState } from '../../hooks/useMetronomeEngine';

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

/** How far the pupil can drift from the iris's center while tracking the
 * pendulum, in SVG units. Iris radius is 22, pupil radius 9 — this keeps
 * the pupil comfortably inside the iris at full deflection. */
const PUPIL_MAX_OFFSET = 10;

interface MetronomeVisualProps {
  isPlaying: boolean;
  band: BrainwaveBand;
  swingRef: React.RefObject<SwingState | null>;
  getAudioTimeSec: () => number;
  getAnalyser: () => AnalyserNode | null;
  lastTickSide: 'left' | 'right' | null;
  tickCount: number;
  /** Called every animation frame with the pendulum's current position
   * (-1 full left .. 1 full right), so the drone's L/R balance can track
   * it continuously — see BinauralEngine.updateDroneBalance(). */
  onSwingUpdate: (panValue: number) => void;
}

export function MetronomeVisual({
  isPlaying,
  band,
  swingRef,
  getAudioTimeSec,
  getAnalyser,
  lastTickSide,
  tickCount,
  onSwingUpdate,
}: MetronomeVisualProps) {
  const armRef = useRef<SVGGElement | null>(null);
  const pupilRef = useRef<SVGCircleElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<number[] | null>(null);
  const rafRef = useRef<number | null>(null);

  const bandInfo = BANDS[band];

  useEffect(() => {
    if (!isPlaying) {
      // Resting pose: arm hangs straight down, eye looks front, no
      // animation loop running.
      if (armRef.current) armRef.current.setAttribute('transform', `rotate(0 ${PIVOT.x} ${PIVOT.y})`);
      if (pupilRef.current) {
        pupilRef.current.setAttribute('cx', String(EYE.x));
        pupilRef.current.setAttribute('cy', String(EYE.y));
      }
      onSwingUpdate(0);
      return;
    }

    function frame() {
      const arm = armRef.current;
      const swing = swingRef.current;
      const now = getAudioTimeSec();

      let angle = 0;
      let wiggle = 0;
      let panValue = 0;
      if (swing) {
        // computeSwingSegment derives which segment "now" falls into (and
        // how far through it) by pure elapsed-time arithmetic against a
        // fixed reference point — see the long comment on SwingState in
        // useMetronomeEngine.ts for why this replaced an earlier version
        // that re-pointed from/to boundaries only when a beat was
        // SCHEDULED. That approach left the arm frozen at each extreme for
        // most of a beat, then jumping to ~90% through its eased curve the
        // instant the next segment arrived — a visible freeze-then-snap
        // instead of a smooth swing.
        const segment = computeSwingSegment(now, swing);
        const span = segment.toTimeSec - segment.fromTimeSec;
        const t = span > 0 ? Math.min(1, Math.max(0, (now - segment.fromTimeSec) / span)) : 1;
        const eased = easeInOutSine(t);
        const fromDeg = segment.fromSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
        const toDeg = segment.toSide === 'left' ? LEFT_ANGLE : RIGHT_ANGLE;
        angle = fromDeg + (toDeg - fromDeg) * eased;

        const fromPan = segment.fromSide === 'left' ? -1 : 1;
        const toPan = segment.toSide === 'left' ? -1 : 1;
        panValue = fromPan + (toPan - fromPan) * eased;

        // A short, decaying vibration layered on top the instant the tip
        // arrives at a side (when the tick actually sounds) — the
        // "wiggle" the tone triggers, distinct from the smooth swing.
        const sinceArrival = now - segment.toTimeSec;
        if (sinceArrival >= 0 && sinceArrival < 0.35) {
          wiggle = Math.exp(-sinceArrival * 14) * Math.sin(sinceArrival * 60) * 4;
        }
      }

      // Native SVG `transform` attribute, not a CSS transform — CSS
      // transform/transform-origin on SVG elements is an inconsistently
      // implemented corner of the platform across browsers (units, default
      // transform-box, and compositing behavior all vary). The SVG
      // attribute form (`rotate(deg, cx, cy)`) has been unambiguous since
      // SVG 1.1: it always operates in the element's own user-unit
      // coordinate system, so there's nothing left to disagree about.
      const totalAngle = angle + wiggle;
      if (arm) arm.setAttribute('transform', `rotate(${totalAngle} ${PIVOT.x} ${PIVOT.y})`);
      onSwingUpdate(panValue);

      // The eye watches the pendulum: look toward wherever the tip
      // currently is, using the SAME angle (including the wiggle) that
      // just moved the arm, so the eye reacts to the tick too. Setting
      // cx/cy directly (rather than a CSS translate) sidesteps the same
      // transform-box ambiguity noted above — cx/cy are always plain SVG
      // user units, so this can never come out mirrored or scaled wrong.
      if (pupilRef.current) {
        const angleRad = (totalAngle * Math.PI) / 180;
        const tipX = PIVOT.x + ARM_LENGTH * Math.sin(angleRad);
        const tipY = PIVOT.y + ARM_LENGTH * Math.cos(angleRad);
        const dx = tipX - EYE.x;
        const dy = tipY - EYE.y;
        const dist = Math.hypot(dx, dy) || 1;
        const offsetX = (dx / dist) * PUPIL_MAX_OFFSET;
        const offsetY = (dy / dist) * PUPIL_MAX_OFFSET;
        pupilRef.current.setAttribute('cx', String(EYE.x + offsetX));
        pupilRef.current.setAttribute('cy', String(EYE.y + offsetY));
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
  }, [isPlaying, bandInfo.color, onSwingUpdate]);

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

        <g ref={armRef} className="metronome-arm">
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y + ARM_LENGTH} className="metronome-arm-line" />
          <circle cx={PIVOT.x} cy={PIVOT.y + ARM_LENGTH} r={7} className="metronome-arm-tip" />
        </g>

        <circle cx={PIVOT.x} cy={PIVOT.y} r={5} className="metronome-pivot-dot" />

        <g className="metronome-eye">
          <circle cx={EYE.x} cy={EYE.y} r={38} className="eye-outer" />
          <circle cx={EYE.x} cy={EYE.y} r={22} className="eye-iris" />
          <circle ref={pupilRef} cx={EYE.x} cy={EYE.y} r={9} className="eye-pupil" />
        </g>
      </svg>
    </div>
  );
}
