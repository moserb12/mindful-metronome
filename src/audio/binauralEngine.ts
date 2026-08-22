// ============================================================================
// BinauralEngine — the audio heart of Mindful Metronome.
//
// Three independent layers, each real Web Audio, each routed through its
// own GainNode (per-channel volume, same principle Brain Bridging Beats
// uses for its feedback channels: a listener should be able to bring any
// one layer down to zero without touching the others):
//
//   - DRONE: a continuous binaural pair — one sine in each ear, offset by
//     `beatHz`. The brain never actually receives that difference tone; it's
//     synthesized in the auditory brainstem from two real, steady pitches.
//     This is the "flow state" background layer. The LEFT and RIGHT
//     oscillators are each panned hard to their own ear permanently — that
//     fixed separation is what makes the beat perceivable at all — but
//     each has its OWN gain, continuously re-balanced every animation frame
//     to follow the pendulum's live position (see updateDroneBalance()).
//     The two gains always sum to `droneVolume`, so the total loudness
//     stays constant; only the LR balance moves.
//   - TICK: short, percussive ticks fired once per beat by a BeatScheduler
//     (src/engine/timing.ts) at a precise AudioContext time. Which ear (or
//     both) a tick fires into is controlled by `tickEarMode` — see
//     resolveTickPan() below.
//   - NOISE SHIELD: a quiet ambience layer behind both, panned center.
//     Selectable between pink/white/brown (see NoiseType) — see
//     buildPinkNoiseBuffer/buildWhiteNoiseBuffer/buildBrownNoiseBuffer for
//     how each is synthesized, and their scaling constants (chosen by
//     matching RMS/peak across all three, not eyeballed) for why switching
//     type mid-session doesn't jump in loudness.
//
// All three channel gains feed the shared `analyser` (so the acoustic
// visualizer always sees the true combined mix), and analyser output then
// passes through ONE final `masterGain` before the destination — an overall
// trim on top of the mix, not a substitute for the per-channel gains above.
// Turning master down still leaves each channel's own balance untouched;
// turning it back up restores the exact mix that was there before.
//
// Nothing in this file assumes React or the DOM beyond the Web Audio API
// and StereoPannerNode; src/hooks/useMetronomeEngine.ts is the thin React
// wrapper around it.
// ============================================================================

import { pendulumEase } from '../engine/motion';

export type TickSound = 'soft' | 'wood' | 'kick' | 'hihat';

/** Which noise-shield texture plays behind the drone/tick layers. See
 * src/data/noiseShields.ts for the user-facing description of each and
 * which brainwave bands/tempos it pairs well with. */
export type NoiseType = 'pink' | 'white' | 'brown';

/** How a tick's stereo placement relates to the drone's live L/R balance:
 *   - MATCH: fires in whichever ear the pendulum just arrived at — the ear
 *     the drone is CURRENTLY favoring (its gain share is highest there).
 *   - OPPOSITE: fires in the other ear — the one the drone is currently
 *     quietest in. A call-and-response between the two layers.
 *   - BOTH: fires centered, equally in both ears, regardless of the
 *     pendulum's position. */
export type TickEarMode = 'MATCH' | 'OPPOSITE' | 'BOTH';

/** WHEN ticks fire relative to the pendulum's swing cycle — orthogonal to
 * TickEarMode above (WHICH EAR a tick is routed to). 'ENDS' is today's
 * exact original behavior: a tick only when the pendulum arrives at a
 * side. The center/"&" tick this adds ALWAYS fires dead-center (pan 0)
 * regardless of TickEarMode — see playCenterTick(). Lives entirely in
 * scheduling (useMetronomeEngine.ts's handleBeatScheduled), not in
 * MetronomeParams — BinauralEngine itself never needs to know the current
 * pattern, only how to play an end-tick or a center-tick when told to. */
export type TickSubdivision = 'ENDS' | 'ENDS_AND_CENTER' | 'CENTER';

/** Gain scale applied to the center/"&" tick relative to the main tick's
 * own peak gain — confirmed with the builder: quieter (~50-60%) so the
 * downbeat still reads as primary, kept at this SAME scale in every
 * tickSubdivision mode (including CENTER-only) for one consistent,
 * recognizable subdivision-click character rather than "turned up to
 * compensate" when it's the only sound playing. */
const CENTER_TICK_GAIN_SCALE = 0.55;

/** Extra time, past each tickSound's own decay, spent linearly ramping
 * the gain the rest of the way down to an exact 0 before the oscillator
 * is stopped — see fireTickOscillator()'s doc comment for why this needs
 * to reach TRUE silence, not just "quiet," to avoid an audible click.
 * Short enough to be inaudible as its own event on any tickSound. */
const TICK_RELEASE_TAIL_SEC = 0.005;

/** How long stop() spends fading the drone + noise gains to true silence
 * before stopping their oscillators/buffer source — see stop()'s doc
 * comment. Short enough to feel instant (this is still the "manual
 * Pause/Stop is audio-instant" behavior, not a graceful fade like a
 * session's own beginSessionFadeOut()), long enough to guarantee a
 * click-free stop regardless of waveform phase. */
const DRONE_STOP_RELEASE_SEC = 0.03;

/** How many points sample pendulumEase()'s curve per scheduled swing
 * segment in scheduleDroneSwing() — enough to render the eased shape
 * smoothly (Web Audio linearly interpolates BETWEEN curve samples) at
 * any tempo this app supports, without generating an excessive number of
 * automation points every beat. */
const DRONE_SWING_CURVE_SAMPLES = 24;

export interface MetronomeParams {
  carrierHz: number;
  beatHz: number;
  masterVolume: number; // 0-1, final trim after every channel is mixed together
  droneVolume: number; // 0-1, total combined loudness of both drone channels
  tickVolume: number; // 0-1
  noiseVolume: number; // 0-1
  noiseType: NoiseType;
  tickSound: TickSound;
  /** 0 = drone always split 50/50 regardless of pendulum position
   * (modulation off). 1 = full swing, 100/0 at one extreme to 0/100 at the
   * other. 0.6 lands on an 80/20 <-> 20/80 swing. See updateDroneBalance(). */
  panModulationDepth: number;
  tickEarMode: TickEarMode;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampPan(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

/** Generates a buffer of pink noise (Paul Kellet's refined method — the
 * same filter cascade used by countless Web Audio noise generators). Pink
 * noise, unlike white, has equal energy per octave, which reads as much
 * softer/warmer texture to the ear. */
function buildPinkNoiseBuffer(context: AudioContext, seconds = 2): AudioBuffer {
  const bufferSize = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;

  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.03;
    b6 = white * 0.115926;
  }
  return buffer;
}

/** Generates a buffer of white noise — equal energy at every frequency, the
 * brightest/most even of the three shields. Scaling constant (0.09) was
 * chosen by matching RMS against buildPinkNoiseBuffer's output (both land
 * within ~1% of each other), not eyeballed — so switching shield type
 * mid-session doesn't jump in perceived loudness. */
function buildWhiteNoiseBuffer(context: AudioContext, seconds = 2): AudioBuffer {
  const bufferSize = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = (Math.random() * 2 - 1) * 0.09;
  }
  return buffer;
}

/** Generates a buffer of brown (Brownian/red) noise via a leaky integrator
 * over white noise — much steeper low-pass than pink, reads as a deep,
 * distant rumble. `leak`/`scale` were tuned together (same RMS-matching
 * process as buildWhiteNoiseBuffer) so this lands at the same loudness as
 * pink and white despite the very different generation method. */
function buildBrownNoiseBuffer(context: AudioContext, seconds = 2): AudioBuffer {
  const bufferSize = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  const leak = 0.02;
  const scale = 0.9;
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + leak * white) / (1 + leak);
    output[i] = lastOut * scale;
  }
  return buffer;
}

export class BinauralEngine {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;

  private oscLeft: OscillatorNode | null = null;
  private oscRight: OscillatorNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private readonly noiseBuffers: Record<NoiseType, AudioBuffer>;

  /** Per-ear drone gain, so the L/R balance can move independently of the
   * master droneVolume. Their values always sum to droneVolume. */
  private readonly droneGainLeft: GainNode;
  private readonly droneGainRight: GainNode;
  private readonly tickGain: GainNode;
  private readonly noiseGain: GainNode;
  /** Final trim applied AFTER analyser, on top of the already-mixed signal
   * — see the file-level comment for why this doesn't replace the
   * per-channel gains above. */
  private readonly masterGain: GainNode;

  private params: MetronomeParams;
  private playing = false;
  /** Most recent pendulum position, -1 (full left) to 1 (full right).
   * Retained so setVolumes()/setPanModulationDepth() can immediately
   * reapply the correct balance without waiting for the next animation
   * frame's updateDroneBalance() call. */
  private lastPanValue = 0;

  constructor(initialParams: MetronomeParams) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new AudioCtx();
    this.params = initialParams;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = clamp01(initialParams.masterVolume);
    this.analyser.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

    this.droneGainLeft = this.context.createGain();
    this.droneGainRight = this.context.createGain();
    this.droneGainLeft.gain.value = initialParams.droneVolume / 2;
    this.droneGainRight.gain.value = initialParams.droneVolume / 2;
    this.droneGainLeft.connect(this.analyser);
    this.droneGainRight.connect(this.analyser);

    this.tickGain = this.context.createGain();
    this.tickGain.gain.value = initialParams.tickVolume;
    this.tickGain.connect(this.analyser);

    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = initialParams.noiseVolume;
    this.noiseGain.connect(this.analyser);

    this.noiseBuffers = {
      pink: buildPinkNoiseBuffer(this.context),
      white: buildWhiteNoiseBuffer(this.context),
      brown: buildBrownNoiseBuffer(this.context),
    };
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Start the continuous drone + noise shield. Must be called from a real
   * user gesture (browsers block AudioContext otherwise) — the caller
   * should also `resume()` a suspended context first. Idempotent: calling
   * twice in a row while already playing is a no-op. */
  start(): void {
    if (this.playing) return;
    this.playing = true;

    this.oscLeft = this.context.createOscillator();
    this.oscLeft.type = 'sine';
    this.oscLeft.frequency.value = this.params.carrierHz;
    const panLeft = this.context.createStereoPanner();
    panLeft.pan.value = -1;
    this.oscLeft.connect(panLeft).connect(this.droneGainLeft);

    this.oscRight = this.context.createOscillator();
    this.oscRight.type = 'sine';
    this.oscRight.frequency.value = this.params.carrierHz + this.params.beatHz;
    const panRight = this.context.createStereoPanner();
    panRight.pan.value = 1;
    this.oscRight.connect(panRight).connect(this.droneGainRight);

    this.oscLeft.start();
    this.oscRight.start();

    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffers[this.params.noiseType];
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start();

    this.applyDroneBalance();
  }

  /** Stop the drone + noise. The tick layer is unaffected — it's driven
   * externally by BeatScheduler and each tick is a one-shot regardless. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;

    // Fade each channel's gain to TRUE silence before stopping the
    // oscillator/buffer source feeding it — `oscLeft.stop()` etc. used to
    // be called with no scheduled time at all, cutting the drone's
    // continuous tones (and the noise buffer) off at whatever waveform
    // amplitude they happened to be at that exact instant. That's an
    // audible click every single time Pause/Stop is pressed, the same
    // root cause as the tick-release fix above — a genuine discontinuity
    // in the waveform, not just a loudness question. `cancelScheduledValues`
    // + re-pinning the current value first (rather than a bare ramp call)
    // matches this file's existing pattern elsewhere (see masterGain's
    // handling below) for correctly interrupting any automation already
    // in flight — the drone's own live swing-pan curve (scheduleDroneSwing())
    // included.
    const now = this.context.currentTime;
    const stopAtSec = now + DRONE_STOP_RELEASE_SEC;
    [this.droneGainLeft, this.droneGainRight, this.noiseGain].forEach((gainNode) => {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, stopAtSec);
    });
    this.oscLeft?.stop(stopAtSec);
    this.oscRight?.stop(stopAtSec);
    this.noiseSource?.stop(stopAtSec);
    this.oscLeft = null;
    this.oscRight = null;
    this.noiseSource = null;

    // Unconditionally re-prime masterGain to the slider's real value.
    // `masterGain` is created once in the constructor and persists across
    // stop/start cycles — nothing else ever resets it. Without this, a
    // session that faded it to ~0 via beginSessionFadeOut() (see below)
    // would leave the NEXT start() beginning silently, since the ramp
    // automation from the previous session is still in effect on this
    // same GainNode.
    this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
    this.masterGain.gain.setValueAtTime(this.params.masterVolume, this.context.currentTime);
  }

  /**
   * Ramp `masterGain` smoothly to silence over `fadeDurationSec`, starting
   * from whatever it's currently at. Deliberately does NOT touch
   * `params.masterVolume` — that's the slider's source of truth, and stays
   * exactly where the user left it; only the live AudioParam is overridden
   * temporarily. `stop()` (above) is what re-primes it afterward, so the
   * next session starts at full volume again rather than picking up from
   * wherever this ramp left off.
   */
  beginSessionFadeOut(fadeDurationSec: number): void {
    const now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0.0001, now + fadeDurationSec);
  }

  /** Cancels any in-flight session fade-out ramp and snaps `masterGain`
   * back to the slider's real value immediately — used when a NEW session
   * is armed (a duration is re-picked mid-play) while an OLDER session's
   * fade-out ramp is still running, so that stale automation can't keep
   * silently pulling the volume toward zero underneath a session that now
   * thinks it's freshly 'active'. */
  cancelSessionFade(): void {
    const now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.params.masterVolume, now);
  }

  /**
   * A soft closing tone for a session ending naturally — NOT played on a
   * manual pause/stop, only when a timed session's own countdown reaches
   * its fade window. Root/fifth/octave stack derived from the current
   * carrierHz, so it's always tonally related to whatever's playing,
   * rather than a fixed jingle. Routed to `analyser` — the SAME point
   * drone/tick/noise feed into, upstream of `masterGain` — so it rides the
   * same fade-out ramp instead of sounding after everything else has
   * already gone quiet. Slow attack + a few seconds of decay, same
   * per-oscillator envelope style as playTick()'s switch statement below,
   * just with a much longer tail.
   */
  playClosingChime(): void {
    const now = this.context.currentTime;
    const root = this.params.carrierHz;
    const intervals = [1, 1.5, 2]; // root, fifth, octave
    const chimeGain = this.context.createGain();
    chimeGain.connect(this.analyser);
    chimeGain.gain.setValueAtTime(0, now);
    chimeGain.gain.linearRampToValueAtTime(0.35, now + 0.3);
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 4);

    intervals.forEach((ratio) => {
      const osc = this.context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = root * ratio;
      osc.connect(chimeGain);
      osc.start(now);
      osc.stop(now + 4.1);
    });
  }

  /** Smoothly retune the drone to a new carrier/beat pair without a click —
   * safe to call continuously while a slider drags. */
  setFrequencies(carrierHz: number, beatHz: number): void {
    this.params.carrierHz = carrierHz;
    this.params.beatHz = beatHz;
    if (this.oscLeft && this.oscRight) {
      this.oscLeft.frequency.setTargetAtTime(carrierHz, this.context.currentTime, 0.05);
      this.oscRight.frequency.setTargetAtTime(carrierHz + beatHz, this.context.currentTime, 0.05);
    }
  }

  setVolumes(droneVolume: number, tickVolume: number, noiseVolume: number): void {
    this.params.droneVolume = droneVolume;
    this.params.tickVolume = tickVolume;
    this.params.noiseVolume = noiseVolume;
    this.applyDroneBalance();
    this.tickGain.gain.setTargetAtTime(clamp01(tickVolume), this.context.currentTime, 0.03);
    this.noiseGain.gain.setTargetAtTime(clamp01(noiseVolume), this.context.currentTime, 0.03);
  }

  /** Final trim on top of the already-mixed signal — turning this down
   * (even to 0) never touches the individual drone/tick/noise balances, so
   * bringing it back up restores exactly the mix that was there before. */
  setMasterVolume(masterVolume: number): void {
    this.params.masterVolume = clamp01(masterVolume);
    this.masterGain.gain.setTargetAtTime(this.params.masterVolume, this.context.currentTime, 0.03);
  }

  /** Swap the noise-shield texture. `AudioBufferSourceNode.buffer` can only
   * be assigned before `start()` is called — once a source node is
   * playing, the spec makes further buffer reassignment throw — so a
   * live swap replaces the node itself rather than mutating the running
   * one, carrying over the same `noiseGain` routing (and therefore the
   * same volume/mute state) without any click, since both types were
   * loudness-matched at generation time. */
  setNoiseType(noiseType: NoiseType): void {
    this.params.noiseType = noiseType;
    if (this.playing && this.noiseSource) {
      this.noiseSource.stop();
      const next = this.context.createBufferSource();
      next.buffer = this.noiseBuffers[noiseType];
      next.loop = true;
      next.connect(this.noiseGain);
      next.start();
      this.noiseSource = next;
    }
  }

  setTickSound(tickSound: TickSound): void {
    this.params.tickSound = tickSound;
  }

  setTickEarMode(mode: TickEarMode): void {
    this.params.tickEarMode = mode;
  }

  setPanModulationDepth(depth: number): void {
    this.params.panModulationDepth = clamp01(depth);
    this.applyDroneBalance();
  }

  /**
   * Pre-schedules the ENTIRE drone L/R balance curve for one swing
   * segment (one beat's worth of pendulum travel), sampling
   * `pendulumEase()`'s exact shape into native Web Audio automation
   * curves via `setValueCurveAtTime` — called once per beat from
   * `handleBeatScheduled` (`useMetronomeEngine.ts`), the SAME trigger
   * that already reliably schedules ticks in the background, rather than
   * being pushed continuously from the visual's `requestAnimationFrame`
   * loop every frame (the previous design). That distinction is what
   * makes the drone's stereo balance keep oscillating even when the tab
   * is backgrounded: `requestAnimationFrame` is throttled to near-zero
   * (or fully paused) in a hidden tab, but a curve committed ahead of
   * time to the audio graph plays out entirely on the audio rendering
   * thread, immune to ANY main-thread timer throttling — including the
   * throttling that eventually catches even `setInterval` in a long-
   * hidden tab (which is why this needed to be genuine audio-graph
   * automation, not just a `setInterval`-driven fallback).
   *
   * `fromPan`/`toPan` are -1 (left hemisphere) to 1 (right) — the same
   * convention the visual's swing math already uses. `hangWeight` is
   * `pendulumEase()`'s own shape parameter, computed by the caller from
   * the current band's mood + live tempo, matching the visual exactly.
   */
  scheduleDroneSwing(fromPan: number, toPan: number, hangWeight: number, fromTimeSec: number, toTimeSec: number): void {
    const duration = toTimeSec - fromTimeSec;
    if (duration <= 0) return;
    const total = clamp01(this.params.droneVolume);
    const leftCurve = new Float32Array(DRONE_SWING_CURVE_SAMPLES);
    const rightCurve = new Float32Array(DRONE_SWING_CURVE_SAMPLES);
    for (let i = 0; i < DRONE_SWING_CURVE_SAMPLES; i++) {
      const t = i / (DRONE_SWING_CURVE_SAMPLES - 1);
      const eased = pendulumEase(t, hangWeight);
      const panValue = clampPan(fromPan + (toPan - fromPan) * eased);
      const rightShare = 0.5 + 0.5 * this.params.panModulationDepth * panValue;
      leftCurve[i] = total * (1 - rightShare);
      rightCurve[i] = total * rightShare;
    }
    this.droneGainLeft.gain.setValueCurveAtTime(leftCurve, fromTimeSec, duration);
    this.droneGainRight.gain.setValueCurveAtTime(rightCurve, fromTimeSec, duration);
    // Kept fresh (best-effort — a beat behind at worst) so
    // setVolumes()/setPanModulationDepth() below have a reasonable value
    // to immediately reapply from when a slider's dragged mid-play,
    // without needing a live per-frame push of their own.
    this.lastPanValue = toPan;
  }

  private applyDroneBalance(): void {
    const rightShare = 0.5 + 0.5 * this.params.panModulationDepth * this.lastPanValue;
    const leftShare = 1 - rightShare;
    const total = clamp01(this.params.droneVolume);
    this.droneGainLeft.gain.setTargetAtTime(total * leftShare, this.context.currentTime, 0.05);
    this.droneGainRight.gain.setTargetAtTime(total * rightShare, this.context.currentTime, 0.05);
  }

  /** Which ear(s) the tick fires into, given `matchSide` — the ear the
   * pendulum just arrived at (the drone's currently-favored ear). Resolves
   * `tickEarMode` into an actual pan value: -1 full left, 0 centered/both,
   * 1 full right. */
  private resolveTickPan(matchSide: 'left' | 'right'): number {
    switch (this.params.tickEarMode) {
      case 'BOTH':
        return 0;
      case 'OPPOSITE':
        return matchSide === 'left' ? 1 : -1;
      case 'MATCH':
      default:
        return matchSide === 'left' ? -1 : 1;
    }
  }

  /** Builds and fires one tick oscillator at a precise pre-scheduled
   * AudioContext time — never "now" (see src/engine/timing.ts's
   * TimeDomainSync for why real-time scheduling matters). Shared by
   * `playTick()` (the main end-of-swing tick, pan resolved from
   * `tickEarMode`) and `playCenterTick()` (the "&" off-beat tick, always
   * centered) so the 4-case tickSound switch is never duplicated between
   * them. `gainScale` multiplies each sound's own peak gain — 1 for the
   * main tick, CENTER_TICK_GAIN_SCALE for the center tick. */
  private fireTickOscillator(atTimeSec: number, panValue: number, gainScale: number): void {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = clampPan(panValue);

    osc.connect(gain).connect(panner).connect(this.tickGain);

    let duration: number;
    switch (this.params.tickSound) {
      case 'wood':
        duration = 0.03;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, atTimeSec);
        osc.frequency.exponentialRampToValueAtTime(100, atTimeSec + duration);
        gain.gain.setValueAtTime(0.8 * gainScale, atTimeSec);
        break;
      case 'kick':
        duration = 0.12;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, atTimeSec);
        osc.frequency.exponentialRampToValueAtTime(30, atTimeSec + duration);
        gain.gain.setValueAtTime(1.0 * gainScale, atTimeSec);
        break;
      case 'hihat':
        duration = 0.02;
        osc.type = 'square';
        osc.frequency.setValueAtTime(4000, atTimeSec);
        gain.gain.setValueAtTime(0.3 * gainScale, atTimeSec);
        break;
      case 'soft':
      default:
        duration = 0.08;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(this.params.carrierHz, atTimeSec);
        gain.gain.setValueAtTime(0.7 * gainScale, atTimeSec);
        break;
    }

    // Click-free release, shared by every tickSound: ride the exponential
    // decay down close to silence, then finish with a short LINEAR ramp
    // to an exact 0 (an exponential ramp can only ever approach zero,
    // never reach it — the old code stopped the oscillator right at the
    // exponential ramp's end, which meant `osc.stop()` cut the waveform
    // off at whatever nonzero amplitude the oscillator's own phase
    // happened to be at that instant — a genuine discontinuity, audible
    // as a click regardless of how quiet the gain had gotten). Stopping
    // only once the gain has actually reached true silence removes that
    // discontinuity entirely.
    const stopAtSec = atTimeSec + duration;
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAtSec);
    gain.gain.linearRampToValueAtTime(0, stopAtSec + TICK_RELEASE_TAIL_SEC);
    osc.start(atTimeSec);
    osc.stop(stopAtSec + TICK_RELEASE_TAIL_SEC);
  }

  /**
   * Play one metronome tick at a precise pre-scheduled AudioContext time.
   * `matchSide` is the ear the pendulum's arm just arrived at; where the
   * tick actually fires depends on `tickEarMode` (see resolveTickPan()).
   */
  playTick(matchSide: 'left' | 'right', atTimeSec: number): void {
    this.fireTickOscillator(atTimeSec, this.resolveTickPan(matchSide), 1);
  }

  /** The "&" off-beat tick (see TickSubdivision) — ALWAYS dead-center
   * (pan 0), regardless of TickEarMode, and always at
   * CENTER_TICK_GAIN_SCALE — both confirmed, not configurable. */
  playCenterTick(atTimeSec: number): void {
    this.fireTickOscillator(atTimeSec, 0, CENTER_TICK_GAIN_SCALE);
  }

  close(): void {
    this.stop();
    void this.context.close();
  }
}
