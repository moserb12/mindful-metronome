import { useCallback, useEffect, useRef, useState } from 'react';
import { BeatScheduler } from '../engine/timing';
import { BinauralEngine, type TickEarMode, type TickSound } from '../audio/binauralEngine';
import { classifyBeatFrequency, DEFAULT_PRESET, type MetronomePreset } from '../data/bands';

/** How far ahead the audio scheduler keeps its tick queue filled — see the
 * comment where this is used, in start(). Deliberately much larger than
 * timing.ts's 0.1s audio-only default. */
const BACKGROUND_SAFE_LOOKAHEAD_SEC = 3;

// ============================================================================
// useMetronomeEngine — the React seam between the plain-TS audio/scheduling
// engines and the visual metronome component.
//
// Two very different update rates live side by side on purpose:
//   - `swingRef` is a plain ref carrying a SINGLE fixed reference point
//     (one beat's time + side + the tempo in effect from it) rather than
//     an explicit from/to pair. The visual computes which segment "now"
//     falls into, and how far through it, by pure elapsed-time arithmetic
//     every animation frame — see computeSwingSegment() in
//     MetronomeVisual.tsx. This is a deliberate redesign: an earlier
//     version re-pointed swingRef's from/to boundaries every time a beat
//     was SCHEDULED (via BeatScheduler's lookahead callback, which fires
//     only ~100ms before a beat sounds). That sounds like plenty of lead
//     time but isn't: a swing segment actually STARTS a full beat
//     interval earlier, at the PREVIOUS beat's arrival, so the arm sat
//     frozen at each extreme for most of the beat and then had to jump to
//     ~90% through its eased curve the instant the next segment arrived —
//     a visible freeze-then-snap instead of a smooth swing. Deriving the
//     segment from elapsed time relative to a fixed reference removes the
//     dependency on scheduler notification timing entirely.
//   - `lastTickSide`/`tickCount` ARE React state, but only flip once per
//     beat, and only at the moment the tick actually SOUNDS (delayed via
//     setTimeout from the scheduling callback, which fires ~100ms ahead) —
//     that's cheap, and it's what the wiggle animation and any other
//     discrete per-tick UI keys off. This part is unaffected by the redesign
//     above — audio ticks still come from BeatScheduler as before.
// ============================================================================

export interface SwingState {
  /** AudioContext time some beat with `referenceSide` sounded (or, for the
   * very first reference right after start(), WILL sound). */
  referenceTimeSec: number;
  referenceSide: 'left' | 'right';
  /** Tempo in effect from this reference point forward. Kept alongside the
   * reference (rather than read live from React state) so a mid-play BPM
   * change can never retroactively distort segments computed before it. */
  secondsPerBeat: number;
}

export interface SwingSegment {
  fromSide: 'left' | 'right';
  fromTimeSec: number;
  toSide: 'left' | 'right';
  toTimeSec: number;
}

function oppositeSide(side: 'left' | 'right'): 'left' | 'right' {
  return side === 'left' ? 'right' : 'left';
}

/**
 * Pure function: given the fixed reference point and the current time,
 * compute which swing segment "now" falls into and its exact boundaries.
 * Called every animation frame by the visual (see MetronomeVisual.tsx) —
 * this is what makes the swing smooth: no waiting on a scheduler callback,
 * just elapsed-time arithmetic against one fixed anchor. Also used once by
 * setBpm() below to find a continuity point when the tempo changes
 * mid-play.
 */
export function computeSwingSegment(nowSec: number, ref: SwingState): SwingSegment {
  const { referenceTimeSec, referenceSide, secondsPerBeat } = ref;
  const segmentIndex = Math.floor((nowSec - referenceTimeSec) / secondsPerBeat);
  const segmentEndSec = referenceTimeSec + (segmentIndex + 1) * secondsPerBeat;
  const segmentStartSec = segmentEndSec - secondsPerBeat;
  // JS's `%` keeps the sign of the dividend, so normalize before checking
  // parity — segmentIndex can legitimately be negative (now before the
  // reference point, e.g. during the lead-in).
  const isOddSegment = ((segmentIndex % 2) + 2) % 2 === 1;
  const toSide = isOddSegment ? referenceSide : oppositeSide(referenceSide);
  return { fromSide: oppositeSide(toSide), fromTimeSec: segmentStartSec, toSide, toTimeSec: segmentEndSec };
}

export function useMetronomeEngine() {
  const [carrierHz, setCarrierHzState] = useState(DEFAULT_PRESET.carrierHz);
  const [beatHz, setBeatHzState] = useState(DEFAULT_PRESET.beatHz);
  const [bpm, setBpmState] = useState(DEFAULT_PRESET.bpm);
  const [tickSound, setTickSoundState] = useState<TickSound>('soft');
  const [droneVolume, setDroneVolumeState] = useState(0.55);
  const [tickVolume, setTickVolumeState] = useState(0.7);
  const [noiseVolume, setNoiseVolumeState] = useState(0.08);
  const [panModulationDepth, setPanModulationDepthState] = useState(0.6); // 80/20 <-> 20/80 at the extremes, by default
  const [tickEarMode, setTickEarModeState] = useState<TickEarMode>('MATCH');
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastTickSide, setLastTickSide] = useState<'left' | 'right' | null>(null);
  const [tickCount, setTickCount] = useState(0);

  const engineRef = useRef<BinauralEngine | null>(null);
  const schedulerRef = useRef<BeatScheduler | null>(null);
  const swingRef = useRef<SwingState | null>(null);
  const paramsRef = useRef({
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    droneVolume,
    tickVolume,
    noiseVolume,
    panModulationDepth,
    tickEarMode,
  });
  const wiggleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  paramsRef.current = {
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    droneVolume,
    tickVolume,
    noiseVolume,
    panModulationDepth,
    tickEarMode,
  };

  function ensureEngine(): BinauralEngine {
    if (!engineRef.current) {
      engineRef.current = new BinauralEngine({
        carrierHz: paramsRef.current.carrierHz,
        beatHz: paramsRef.current.beatHz,
        droneVolume: paramsRef.current.droneVolume,
        tickVolume: paramsRef.current.tickVolume,
        noiseVolume: paramsRef.current.noiseVolume,
        tickSound: paramsRef.current.tickSound,
        panModulationDepth: paramsRef.current.panModulationDepth,
        tickEarMode: paramsRef.current.tickEarMode,
      });
    }
    return engineRef.current;
  }

  const handleBeatScheduled = useCallback((beat: { beatIndex: number; timeSec: number }) => {
    const engine = engineRef.current;
    if (!engine) return;
    const side: 'left' | 'right' = beat.beatIndex % 2 === 0 ? 'left' : 'right';

    engine.playTick(side, beat.timeSec);

    // Flip the wiggle/React-state trigger at the moment the tick actually
    // SOUNDS, not when it was merely scheduled (which is ~100ms early) —
    // a few ms of setTimeout jitter is invisible on a cosmetic wiggle, and
    // this is not clinical timing data.
    const delayMs = Math.max(0, (beat.timeSec - engine.context.currentTime) * 1000);
    setTimeout(() => {
      setLastTickSide(side);
      setTickCount((c) => c + 1);
    }, delayMs);
  }, []);

  const stop = useCallback(() => {
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    engineRef.current?.stop();
    if (wiggleTimeoutRef.current) clearTimeout(wiggleTimeoutRef.current);
    setIsPlaying(false);
  }, []);

  const start = useCallback(() => {
    const engine = ensureEngine();
    if (engine.context.state === 'suspended') void engine.context.resume();
    engine.start();

    const firstBeatAtSec = engine.context.currentTime + 0.15;
    // beatIndex 0 is always 'left' (see handleBeatScheduled) — anchor the
    // visual's reference point to that same first beat so the swing and
    // the audio ticks can never disagree about which side is "now".
    swingRef.current = { referenceTimeSec: firstBeatAtSec, referenceSide: 'left', secondsPerBeat: 60 / paramsRef.current.bpm };

    // A generous lookahead (vs. timing.ts's 0.1s audio-only default) so
    // playback survives the tab being backgrounded: browsers throttle
    // setInterval in hidden tabs (commonly clamped to a 1s minimum), and
    // BeatScheduler only refills its queue when this callback actually
    // fires. Already-scheduled ticks keep sounding regardless (they're
    // baked into the audio graph as exact AudioContext times), but the
    // queue would otherwise run dry within ~100ms of the tab losing focus.
    // A few seconds of lookahead comfortably outlasts typical throttling.
    const scheduler = new BeatScheduler(
      () => engine.context.currentTime,
      paramsRef.current.bpm,
      handleBeatScheduled,
      BACKGROUND_SAFE_LOOKAHEAD_SEC
    );
    schedulerRef.current = scheduler;
    scheduler.start(firstBeatAtSec);
    setIsPlaying(true);
  }, [handleBeatScheduled]);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else start();
  }, [isPlaying, start, stop]);

  const setCarrierHz = useCallback((hz: number) => {
    setCarrierHzState(hz);
    engineRef.current?.setFrequencies(hz, paramsRef.current.beatHz);
  }, []);

  const setBeatHz = useCallback((hz: number) => {
    setBeatHzState(hz);
    engineRef.current?.setFrequencies(paramsRef.current.carrierHz, hz);
  }, []);

  const setBpm = useCallback((next: number) => {
    setBpmState(next);
    schedulerRef.current?.setBpm(next);

    // Re-anchor the visual's reference point at the moment the tempo
    // changes, so segments computed before this instant are never
    // retroactively stretched/compressed by the new secondsPerBeat. Picks
    // up mid-swing exactly where the arm currently is (whichever side it
    // was already heading toward), just continuing at the new pace.
    const engine = engineRef.current;
    if (engine && swingRef.current) {
      const now = engine.context.currentTime;
      const segment = computeSwingSegment(now, swingRef.current);
      swingRef.current = { referenceTimeSec: segment.toTimeSec, referenceSide: segment.toSide, secondsPerBeat: 60 / next };
    }
  }, []);

  const setTickSound = useCallback((sound: TickSound) => {
    setTickSoundState(sound);
    engineRef.current?.setTickSound(sound);
  }, []);

  const setVolumes = useCallback((next: { droneVolume?: number; tickVolume?: number; noiseVolume?: number }) => {
    const merged = {
      droneVolume: next.droneVolume ?? paramsRef.current.droneVolume,
      tickVolume: next.tickVolume ?? paramsRef.current.tickVolume,
      noiseVolume: next.noiseVolume ?? paramsRef.current.noiseVolume,
    };
    if (next.droneVolume !== undefined) setDroneVolumeState(next.droneVolume);
    if (next.tickVolume !== undefined) setTickVolumeState(next.tickVolume);
    if (next.noiseVolume !== undefined) setNoiseVolumeState(next.noiseVolume);
    engineRef.current?.setVolumes(merged.droneVolume, merged.tickVolume, merged.noiseVolume);
  }, []);

  const setPanModulationDepth = useCallback((depth: number) => {
    setPanModulationDepthState(depth);
    engineRef.current?.setPanModulationDepth(depth);
  }, []);

  const setTickEarMode = useCallback((mode: TickEarMode) => {
    setTickEarModeState(mode);
    engineRef.current?.setTickEarMode(mode);
  }, []);

  /** Called every animation frame by the visual, using the exact swing
   * position that also drives the arm's rotation — see the long comment at
   * the top of this file for why this bypasses React state entirely. */
  const updateDroneBalance = useCallback((panValue: number) => {
    engineRef.current?.updateDroneBalance(panValue);
  }, []);

  const applyPreset = useCallback(
    (preset: MetronomePreset) => {
      setCarrierHz(preset.carrierHz);
      setBeatHz(preset.beatHz);
      setBpm(preset.bpm);
    },
    [setCarrierHz, setBeatHz, setBpm]
  );

  useEffect(() => {
    return () => {
      schedulerRef.current?.stop();
      engineRef.current?.close();
      if (wiggleTimeoutRef.current) clearTimeout(wiggleTimeoutRef.current);
    };
  }, []);

  return {
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    droneVolume,
    tickVolume,
    noiseVolume,
    panModulationDepth,
    tickEarMode,
    isPlaying,
    band: classifyBeatFrequency(beatHz),
    lastTickSide,
    tickCount,
    swingRef,
    getAnalyser: () => engineRef.current?.analyser ?? null,
    getAudioTimeSec: () => engineRef.current?.context.currentTime ?? 0,
    toggle,
    setCarrierHz,
    setBeatHz,
    setBpm,
    setTickSound,
    setVolumes,
    setPanModulationDepth,
    setTickEarMode,
    updateDroneBalance,
    applyPreset,
  };
}
