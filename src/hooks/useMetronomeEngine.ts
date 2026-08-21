import { useCallback, useEffect, useRef, useState } from 'react';
import { BeatScheduler } from '../engine/timing';
import { BinauralEngine, type NoiseType, type TickEarMode, type TickSound } from '../audio/binauralEngine';
import { classifyBeatFrequency, DEFAULT_PRESET } from '../data/bands';
import { loadSettings, saveSettings } from '../storage/settingsStorage';
import { decodeSettingsFromSearchParams, encodeSettingsToSearchParams, hasAnyCoreTuningParams } from '../urlState';

/** How far ahead the audio scheduler keeps its tick queue filled — see the
 * comment where this is used, in start(). Deliberately much larger than
 * timing.ts's 0.1s audio-only default. */
const BACKGROUND_SAFE_LOOKAHEAD_SEC = 3;

/** Debounce window for saving settings to localStorage — range inputs fire
 * `onChange` continuously while being dragged, so saving on every change
 * would mean dozens of writes per second during a drag. */
const SETTINGS_SAVE_DEBOUNCE_MS = 400;

/** How long a timed session's graceful fade-out + closing chime take,
 * counted BACKWARD from the requested duration — so total elapsed time
 * (audible + fade) always equals exactly what was picked, rather than
 * tacking the fade on top of it. */
const SESSION_FADE_DURATION_SEC = 8;
/** How often the session countdown is checked against its fixed reference
 * — see computeSessionPhase() below. A countdown label doesn't need
 * animation-frame precision, so this is a plain setInterval, not a second
 * rAF loop competing with the visual's. */
const SESSION_POLL_INTERVAL_MS = 250;
/** How long `sessionPhase` stays `'ended'` after a session completes
 * naturally, before resetting to `'idle'` — long enough for the session-
 * end glow bloom + the closing chime's tail to actually read as a
 * completed moment, not be wiped out instantly by tearing the session
 * state down the same tick it ends. */
const SESSION_END_MOMENT_MS = 3000;

/**
 * Merges every source of initial state, per field, in this exact order:
 * hardcoded defaults < saved localStorage settings < URL query params.
 * A shared link only carries "core tuning" (carrier/beat/bpm/noiseType —
 * see urlState.ts's file comment for why), so a URL override NEVER
 * clobbers a field it doesn't itself encode — someone's own saved
 * master/drone/tick/noise volumes and tick-ear mode survive opening a
 * shared link untouched. Computed once (called from a lazy `useState`
 * initializer below, which React guarantees only runs on mount), not on
 * every render — it does real localStorage/URL reads.
 */
function resolveInitialSettings() {
  const stored = loadSettings();
  const urlOverrides =
    typeof window !== 'undefined' ? decodeSettingsFromSearchParams(window.location.search) : {};
  return {
    carrierHz: urlOverrides.carrierHz ?? stored.carrierHz ?? DEFAULT_PRESET.carrierHz,
    beatHz: urlOverrides.beatHz ?? stored.beatHz ?? DEFAULT_PRESET.beatHz,
    bpm: urlOverrides.bpm ?? stored.bpm ?? DEFAULT_PRESET.bpm,
    tickSound: stored.tickSound ?? ('soft' as TickSound),
    masterVolume: stored.masterVolume ?? 0.85,
    droneVolume: stored.droneVolume ?? 0.55,
    tickVolume: stored.tickVolume ?? 0.7,
    noiseVolume: stored.noiseVolume ?? 0.08,
    noiseType: urlOverrides.noiseType ?? stored.noiseType ?? ('pink' as NoiseType),
    panModulationDepth: stored.panModulationDepth ?? 0.6,
    tickEarMode: stored.tickEarMode ?? ('MATCH' as TickEarMode),
    // Default ON wherever the Vibration API actually exists (desktop
    // browsers don't have it at all, so this is moot there) — haptics are
    // opt-OUT, not opt-in, matching how every other feedback channel in
    // this app defaults to audible/visible unless a listener turns it off.
    hapticsEnabled: stored.hapticsEnabled ?? (typeof navigator !== 'undefined' && 'vibrate' in navigator),
    lastSelectedSessionDurationMinutes: stored.lastSelectedSessionDurationMinutes ?? null,
    hadUrlOverrides: typeof window !== 'undefined' && hasAnyCoreTuningParams(window.location.search),
  };
}

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

/**
 * What applyPreset() accepts — a superset of both preset shapes in the
 * app. The 5 built-in presets (data/bands.ts's MetronomePreset) only ever
 * define carrierHz/beatHz/bpm; a saved custom preset (data/
 * customPresets.ts's CustomPreset) defines every field. applyPreset()
 * applies whichever fields are actually present, so both preset kinds
 * flow through the exact same code path — a built-in preset simply leaves
 * the optional fields untouched.
 */
export interface ApplyablePresetFields {
  carrierHz: number;
  beatHz: number;
  bpm: number;
  masterVolume?: number;
  droneVolume?: number;
  tickVolume?: number;
  noiseVolume?: number;
  noiseType?: NoiseType;
  tickSound?: TickSound;
  panModulationDepth?: number;
  tickEarMode?: TickEarMode;
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

export interface SessionState {
  /** AudioContext time the session began. */
  startTimeSec: number;
  /** Total requested length, audible + fade, in seconds. */
  durationSec: number;
  fadeDurationSec: number;
}

export interface SessionPhase {
  phase: 'active' | 'fading' | 'ended';
  remainingSec: number;
}

/**
 * Pure function, modeled directly on computeSwingSegment() above: derive
 * a timed session's current phase from elapsed time against ONE fixed
 * reference point, rather than a naive setInterval countdown that would
 * accumulate drift or double-fire. Polled every SESSION_POLL_INTERVAL_MS
 * by the hook below — see the long comment there for why fade/end are
 * each guarded by a "has this threshold already passed and we haven't
 * fired yet" boolean rather than trying to catch an exact instant, which
 * a polled (rather than scheduled) check can't guarantee anyway.
 */
export function computeSessionPhase(nowSec: number, s: SessionState): SessionPhase {
  const elapsedSec = nowSec - s.startTimeSec;
  const remainingSec = Math.max(0, s.durationSec - elapsedSec);
  if (elapsedSec >= s.durationSec) return { phase: 'ended', remainingSec: 0 };
  if (elapsedSec >= s.durationSec - s.fadeDurationSec) return { phase: 'fading', remainingSec };
  return { phase: 'active', remainingSec };
}

/** `sessionPhase` at the hook level adds `'idle'` on top of
 * computeSessionPhase()'s three — covering both "not currently playing"
 * and "playing, but Open-ended (no duration armed), so no countdown will
 * ever fire." */
export type SessionPlaybackPhase = 'idle' | 'active' | 'fading' | 'ended';

export function useMetronomeEngine() {
  // Computed exactly once (React guarantees a useState lazy initializer
  // only runs on mount) — every field below seeds its own useState from
  // this single resolved object rather than re-deriving defaults
  // separately, so there's one source of truth for "what did we load."
  const [initialSettings] = useState(resolveInitialSettings);

  const [carrierHz, setCarrierHzState] = useState(initialSettings.carrierHz);
  const [beatHz, setBeatHzState] = useState(initialSettings.beatHz);
  const [bpm, setBpmState] = useState(initialSettings.bpm);
  const [tickSound, setTickSoundState] = useState<TickSound>(initialSettings.tickSound);
  const [masterVolume, setMasterVolumeState] = useState(initialSettings.masterVolume);
  const [droneVolume, setDroneVolumeState] = useState(initialSettings.droneVolume);
  const [tickVolume, setTickVolumeState] = useState(initialSettings.tickVolume);
  const [noiseVolume, setNoiseVolumeState] = useState(initialSettings.noiseVolume);
  const [noiseType, setNoiseTypeState] = useState<NoiseType>(initialSettings.noiseType);
  const [panModulationDepth, setPanModulationDepthState] = useState(initialSettings.panModulationDepth); // 80/20 <-> 20/80 at the extremes, by default
  const [tickEarMode, setTickEarModeState] = useState<TickEarMode>(initialSettings.tickEarMode);
  const [hapticsEnabled, setHapticsEnabledState] = useState(initialSettings.hapticsEnabled);
  const [sessionDurationMinutes, setSessionDurationMinutesState] = useState<number | null>(
    initialSettings.lastSelectedSessionDurationMinutes
  );
  const [sessionPhase, setSessionPhase] = useState<SessionPlaybackPhase>('idle');
  const [sessionRemainingSec, setSessionRemainingSec] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastTickSide, setLastTickSide] = useState<'left' | 'right' | null>(null);
  const [tickCount, setTickCount] = useState(0);

  const engineRef = useRef<BinauralEngine | null>(null);
  const schedulerRef = useRef<BeatScheduler | null>(null);
  const swingRef = useRef<SwingState | null>(null);
  const sessionRef = useRef<SessionState | null>(null);
  const sessionPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionEndGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionFiredFadeRef = useRef(false);
  const sessionFiredEndRef = useRef(false);
  // A dedicated ref (not folded into paramsRef, which only holds fields
  // BinauralEngine's constructor/methods need) — kept in sync every render
  // so start() can read the CURRENT picked duration without needing it in
  // its own useCallback deps.
  const sessionDurationMinutesRef = useRef(sessionDurationMinutes);
  sessionDurationMinutesRef.current = sessionDurationMinutes;
  const paramsRef = useRef({
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    masterVolume,
    droneVolume,
    tickVolume,
    noiseVolume,
    noiseType,
    panModulationDepth,
    tickEarMode,
    hapticsEnabled,
  });
  const wiggleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  paramsRef.current = {
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    masterVolume,
    droneVolume,
    tickVolume,
    noiseVolume,
    noiseType,
    panModulationDepth,
    tickEarMode,
    hapticsEnabled,
  };

  function ensureEngine(): BinauralEngine {
    if (!engineRef.current) {
      engineRef.current = new BinauralEngine({
        carrierHz: paramsRef.current.carrierHz,
        beatHz: paramsRef.current.beatHz,
        masterVolume: paramsRef.current.masterVolume,
        droneVolume: paramsRef.current.droneVolume,
        tickVolume: paramsRef.current.tickVolume,
        noiseVolume: paramsRef.current.noiseVolume,
        noiseType: paramsRef.current.noiseType,
        tickSound: paramsRef.current.tickSound,
        panModulationDepth: paramsRef.current.panModulationDepth,
        tickEarMode: paramsRef.current.tickEarMode,
      });
    }
    return engineRef.current;
  }

  function clearSessionPolling() {
    if (sessionPollIntervalRef.current) {
      clearInterval(sessionPollIntervalRef.current);
      sessionPollIntervalRef.current = null;
    }
    if (sessionEndGraceTimeoutRef.current) {
      clearTimeout(sessionEndGraceTimeoutRef.current);
      sessionEndGraceTimeoutRef.current = null;
    }
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
      // Same delayed-to-real-sounding-time callback the wiggle/neuron-pulse
      // already use — riding that existing mechanism is what guarantees the
      // haptic pulse lands in sync with the audible tick, without inventing
      // a second timing path. Fire-and-forget, feature-detected: desktop
      // browsers simply don't have `vibrate` at all.
      if (paramsRef.current.hapticsEnabled && 'vibrate' in navigator) {
        navigator.vibrate(15);
      }
    }, delayMs);
  }, []);

  /** Tears down audio/scheduler playback WITHOUT touching session state —
   * used both by the public, manual `stop()` below (which DOES also reset
   * session state to 'idle' immediately) and by the natural-end path in
   * pollSession (which needs `sessionPhase` to stay 'ended' for a few
   * seconds afterward, driving the session-end glow/chime, rather than
   * being wiped the same instant playback stops). A plain function, not a
   * useCallback, matching ensureEngine() above — it only touches refs and
   * the stable setIsPlaying setter, so a stale closure over it (from
   * within pollSession's memoized callback) behaves identically to a
   * fresh one. */
  function stopPlaybackInternal() {
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    engineRef.current?.stop();
    if (wiggleTimeoutRef.current) clearTimeout(wiggleTimeoutRef.current);
    clearSessionPolling();
    setIsPlaying(false);
  }

  /** Manual Pause/Stop — always instant, per the builder's explicit
   * choice: the graceful fade+chime+glow is reserved for a session ending
   * on its own, never for a deliberate stop. Immediately resets session
   * state to 'idle' (no lingering 'ended' display, unlike the natural-end
   * path). */
  const stop = useCallback(() => {
    stopPlaybackInternal();
    sessionRef.current = null;
    setSessionPhase('idle');
    setSessionRemainingSec(null);
  }, []);

  /**
   * Polled every SESSION_POLL_INTERVAL_MS while a session is armed —
   * see computeSessionPhase()'s doc comment for why this is a polled
   * threshold check rather than pre-scheduled Web Audio automation times:
   * a poll can fire up to ~250ms late, so `fired*Ref` guards ensure each
   * transition only acts once regardless of exactly when it's noticed.
   */
  const pollSession = useCallback(() => {
    const engine = engineRef.current;
    const session = sessionRef.current;
    if (!engine || !session) return;
    const now = engine.context.currentTime;
    const phase = computeSessionPhase(now, session);
    setSessionRemainingSec(Math.ceil(phase.remainingSec));

    if (phase.phase === 'fading' && !sessionFiredFadeRef.current) {
      sessionFiredFadeRef.current = true;
      setSessionPhase('fading');
      engine.beginSessionFadeOut(session.fadeDurationSec);
      engine.playClosingChime();
    }

    if (phase.phase === 'ended' && !sessionFiredEndRef.current) {
      sessionFiredEndRef.current = true;
      setSessionPhase('ended');
      setSessionRemainingSec(0);
      stopPlaybackInternal();
      // Hold 'ended' for a few seconds so the glow bloom + chime tail
      // actually read as a completed moment, THEN reset to idle so the
      // duration chips become pickable again for a fresh session. Tracked
      // in a ref so a quick manual restart within this window (see stop()
      // and the arming branch of start()) can cancel it — otherwise this
      // stale timeout would fire mid-way through a brand-new session and
      // incorrectly wipe it back to 'idle'.
      sessionEndGraceTimeoutRef.current = setTimeout(() => {
        sessionRef.current = null;
        setSessionPhase('idle');
        sessionEndGraceTimeoutRef.current = null;
      }, SESSION_END_MOMENT_MS);
    }
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

    // Arm (or leave disarmed) this playthrough's session timer. Cancels
    // any stale grace-timeout from a PREVIOUS session that just ended —
    // without this, a quick restart right after a natural session end
    // could have that old timeout fire mid-way through the new session
    // and incorrectly reset it back to 'idle'.
    clearSessionPolling();
    sessionFiredFadeRef.current = false;
    sessionFiredEndRef.current = false;
    const minutes = sessionDurationMinutesRef.current;
    if (minutes !== null) {
      sessionRef.current = { startTimeSec: engine.context.currentTime, durationSec: minutes * 60, fadeDurationSec: SESSION_FADE_DURATION_SEC };
      setSessionPhase('active');
      setSessionRemainingSec(minutes * 60);
      sessionPollIntervalRef.current = setInterval(pollSession, SESSION_POLL_INTERVAL_MS);
    } else {
      sessionRef.current = null;
      setSessionPhase('idle');
      setSessionRemainingSec(null);
    }

    setIsPlaying(true);
  }, [handleBeatScheduled, pollSession]);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else start();
  }, [isPlaying, start, stop]);

  /** Picking a new duration (or Open-ended) is just a PREFERENCE while
   * idle — it only takes effect on the next start(). While already
   * playing, it re-arms the session immediately: "changing duration mid-
   * session restarts the countdown at the new full duration, from right
   * now" — the simplest, most predictable behavior, rather than trying to
   * preserve elapsed time against a changed total. Always cancels any
   * in-flight fade-out ramp first (cancelSessionFade()), so re-picking a
   * duration WHILE a previous session is mid-fade can't leave that old
   * ramp silently still pulling the volume toward zero underneath the
   * freshly-armed one. */
  const setSessionDurationMinutes = useCallback((minutes: number | null) => {
    setSessionDurationMinutesState(minutes);
    const engine = engineRef.current;
    if (!engine || !isPlaying) return;

    engine.cancelSessionFade();
    clearSessionPolling();
    sessionFiredFadeRef.current = false;
    sessionFiredEndRef.current = false;
    if (minutes === null) {
      sessionRef.current = null;
      setSessionPhase('idle');
      setSessionRemainingSec(null);
    } else {
      sessionRef.current = { startTimeSec: engine.context.currentTime, durationSec: minutes * 60, fadeDurationSec: SESSION_FADE_DURATION_SEC };
      setSessionPhase('active');
      setSessionRemainingSec(minutes * 60);
      sessionPollIntervalRef.current = setInterval(pollSession, SESSION_POLL_INTERVAL_MS);
    }
  }, [isPlaying, pollSession]);

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

  const setMasterVolume = useCallback((volume: number) => {
    setMasterVolumeState(volume);
    engineRef.current?.setMasterVolume(volume);
  }, []);

  const setNoiseType = useCallback((type: NoiseType) => {
    setNoiseTypeState(type);
    engineRef.current?.setNoiseType(type);
  }, []);

  const setPanModulationDepth = useCallback((depth: number) => {
    setPanModulationDepthState(depth);
    engineRef.current?.setPanModulationDepth(depth);
  }, []);

  const setTickEarMode = useCallback((mode: TickEarMode) => {
    setTickEarModeState(mode);
    engineRef.current?.setTickEarMode(mode);
  }, []);

  const setHapticsEnabled = useCallback((enabled: boolean) => {
    setHapticsEnabledState(enabled);
  }, []);

  /** Called every animation frame by the visual, using the exact swing
   * position that also drives the arm's rotation — see the long comment at
   * the top of this file for why this bypasses React state entirely. */
  const updateDroneBalance = useCallback((panValue: number) => {
    engineRef.current?.updateDroneBalance(panValue);
  }, []);

  const applyPreset = useCallback(
    (preset: ApplyablePresetFields) => {
      setCarrierHz(preset.carrierHz);
      setBeatHz(preset.beatHz);
      setBpm(preset.bpm);
      if (preset.masterVolume !== undefined) setMasterVolume(preset.masterVolume);
      if (preset.droneVolume !== undefined || preset.tickVolume !== undefined || preset.noiseVolume !== undefined) {
        setVolumes({
          droneVolume: preset.droneVolume,
          tickVolume: preset.tickVolume,
          noiseVolume: preset.noiseVolume,
        });
      }
      if (preset.noiseType !== undefined) setNoiseType(preset.noiseType);
      if (preset.tickSound !== undefined) setTickSound(preset.tickSound);
      if (preset.panModulationDepth !== undefined) setPanModulationDepth(preset.panModulationDepth);
      if (preset.tickEarMode !== undefined) setTickEarMode(preset.tickEarMode);
    },
    [
      setCarrierHz,
      setBeatHz,
      setBpm,
      setMasterVolume,
      setVolumes,
      setNoiseType,
      setTickSound,
      setPanModulationDepth,
      setTickEarMode,
    ]
  );

  /** Always reads LIVE current state via paramsRef — never a stale
   * snapshot from whenever the button was rendered — so a "Copy Link"
   * click can't hand out a config that's gone stale mid-session. Encodes
   * only "core tuning" (see urlState.ts's file comment for why volumes/
   * tick sound/tick-ear mode are deliberately excluded). */
  const getShareableLink = useCallback(() => {
    const params = encodeSettingsToSearchParams({
      carrierHz: paramsRef.current.carrierHz,
      beatHz: paramsRef.current.beatHz,
      bpm: paramsRef.current.bpm,
      noiseType: paramsRef.current.noiseType,
    });
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }, []);

  // Once, on mount: if the page loaded with any core-tuning query params,
  // they've already been folded into initial state above — clean the
  // address bar now so a reload of THIS tab doesn't keep re-adopting the
  // same link on every future visit, and so the config flows into the
  // debounced save effect below like any other change, becoming the new
  // persisted baseline.
  useEffect(() => {
    if (initialSettings.hadUrlOverrides) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced localStorage save — range inputs fire onChange continuously
  // while being dragged, so this waits for a pause rather than writing on
  // every single event.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveSettings({
        carrierHz,
        beatHz,
        bpm,
        tickSound,
        masterVolume,
        droneVolume,
        tickVolume,
        noiseVolume,
        noiseType,
        panModulationDepth,
        tickEarMode,
        hapticsEnabled,
        lastSelectedSessionDurationMinutes: sessionDurationMinutes,
      });
    }, SETTINGS_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    masterVolume,
    droneVolume,
    tickVolume,
    noiseVolume,
    noiseType,
    panModulationDepth,
    tickEarMode,
    hapticsEnabled,
    sessionDurationMinutes,
  ]);

  useEffect(() => {
    return () => {
      schedulerRef.current?.stop();
      engineRef.current?.close();
      if (wiggleTimeoutRef.current) clearTimeout(wiggleTimeoutRef.current);
      clearSessionPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    carrierHz,
    beatHz,
    bpm,
    tickSound,
    masterVolume,
    droneVolume,
    tickVolume,
    noiseVolume,
    noiseType,
    panModulationDepth,
    tickEarMode,
    hapticsEnabled,
    sessionDurationMinutes,
    sessionPhase,
    sessionRemainingSec,
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
    setMasterVolume,
    setNoiseType,
    setPanModulationDepth,
    setTickEarMode,
    setHapticsEnabled,
    setSessionDurationMinutes,
    updateDroneBalance,
    applyPreset,
    getShareableLink,
  };
}
