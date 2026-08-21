import { useCallback, useEffect, useRef, useState } from 'react';
import { BeatScheduler } from '../engine/timing';
import { BinauralEngine, type TickSound } from '../audio/binauralEngine';
import { classifyBeatFrequency, DEFAULT_PRESET, type MetronomePreset } from '../data/bands';

// ============================================================================
// useMetronomeEngine — the React seam between the plain-TS audio/scheduling
// engines and the visual metronome component.
//
// Two very different update rates live side by side on purpose:
//   - `swingRef` is a plain ref, written every time a beat is SCHEDULED
//     (roughly every quarter second at most, well before it sounds). The
//     visual component reads it inside its own requestAnimationFrame loop
//     to compute a smooth 60fps swing angle. Driving that through React
//     state would mean a re-render on every animation frame — exactly the
//     kind of thing that makes an app unusable on an older tablet, which
//     matters here since this needs to run on "as many platforms as
//     possible" just like Brain Bridging Beats did.
//   - `lastTickSide`/`tickCount` ARE React state, but only flip once per
//     beat, and only at the moment the tick actually SOUNDS (delayed via
//     setTimeout from the scheduling callback, which fires ~100ms ahead) —
//     that's cheap, and it's what the wiggle animation and any other
//     discrete per-tick UI keys off.
// ============================================================================

export interface SwingState {
  fromSide: 'left' | 'right';
  fromTimeSec: number;
  toSide: 'left' | 'right';
  toTimeSec: number;
}

export function useMetronomeEngine() {
  const [carrierHz, setCarrierHzState] = useState(DEFAULT_PRESET.carrierHz);
  const [beatHz, setBeatHzState] = useState(DEFAULT_PRESET.beatHz);
  const [bpm, setBpmState] = useState(DEFAULT_PRESET.bpm);
  const [tickSound, setTickSoundState] = useState<TickSound>('soft');
  const [droneVolume, setDroneVolumeState] = useState(0.55);
  const [tickVolume, setTickVolumeState] = useState(0.7);
  const [noiseVolume, setNoiseVolumeState] = useState(0.08);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastTickSide, setLastTickSide] = useState<'left' | 'right' | null>(null);
  const [tickCount, setTickCount] = useState(0);

  const engineRef = useRef<BinauralEngine | null>(null);
  const schedulerRef = useRef<BeatScheduler | null>(null);
  const swingRef = useRef<SwingState | null>(null);
  const paramsRef = useRef({ carrierHz, beatHz, bpm, tickSound, droneVolume, tickVolume, noiseVolume });
  const wiggleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  paramsRef.current = { carrierHz, beatHz, bpm, tickSound, droneVolume, tickVolume, noiseVolume };

  function ensureEngine(): BinauralEngine {
    if (!engineRef.current) {
      engineRef.current = new BinauralEngine({
        carrierHz: paramsRef.current.carrierHz,
        beatHz: paramsRef.current.beatHz,
        droneVolume: paramsRef.current.droneVolume,
        tickVolume: paramsRef.current.tickVolume,
        noiseVolume: paramsRef.current.noiseVolume,
        tickSound: paramsRef.current.tickSound,
      });
    }
    return engineRef.current;
  }

  const handleBeatScheduled = useCallback((beat: { beatIndex: number; timeSec: number }) => {
    const engine = engineRef.current;
    if (!engine) return;
    const side: 'left' | 'right' = beat.beatIndex % 2 === 0 ? 'left' : 'right';
    const secondsPerBeat = 60 / paramsRef.current.bpm;

    const prev = swingRef.current;
    swingRef.current = {
      fromSide: prev ? prev.toSide : side === 'left' ? 'right' : 'left',
      fromTimeSec: prev ? prev.toTimeSec : beat.timeSec - secondsPerBeat,
      toSide: side,
      toTimeSec: beat.timeSec,
    };

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
    swingRef.current = null;

    const scheduler = new BeatScheduler(() => engine.context.currentTime, paramsRef.current.bpm, handleBeatScheduled);
    schedulerRef.current = scheduler;
    scheduler.start(engine.context.currentTime + 0.15);
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
    applyPreset,
  };
}
