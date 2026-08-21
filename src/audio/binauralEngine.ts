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
    this.oscLeft?.stop();
    this.oscRight?.stop();
    this.noiseSource?.stop();
    this.oscLeft = null;
    this.oscRight = null;
    this.noiseSource = null;
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
   * Re-balance the two drone channels for the pendulum's CURRENT position.
   * Called every animation frame from the visual (see MetronomeVisual),
   * using the exact same swing interpolation that drives the arm's
   * rotation — so the ear balance moves in lockstep with what's on screen,
   * never a separate/approximate timer.
   *
   * `panValue` is -1 (pendulum at the left hemisphere) to 1 (right). At
   * panModulationDepth 0 the split stays 50/50 regardless of position
   * (modulation off); at 1 it swings fully between 100/0 and 0/100. The
   * two channels always sum to droneVolume, so total loudness never pumps
   * up or down — only the balance between ears moves.
   */
  updateDroneBalance(panValue: number): void {
    this.lastPanValue = clampPan(panValue);
    this.applyDroneBalance();
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

  /**
   * Play one metronome tick at a precise pre-scheduled AudioContext time —
   * never "now" (see src/engine/timing.ts's TimeDomainSync for why
   * real-time scheduling matters). `matchSide` is the ear the pendulum's
   * arm just arrived at; where the tick actually fires depends on
   * `tickEarMode` (see resolveTickPan()).
   */
  playTick(matchSide: 'left' | 'right', atTimeSec: number): void {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = this.resolveTickPan(matchSide);

    osc.connect(gain).connect(panner).connect(this.tickGain);

    switch (this.params.tickSound) {
      case 'wood':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, atTimeSec);
        osc.frequency.exponentialRampToValueAtTime(100, atTimeSec + 0.03);
        gain.gain.setValueAtTime(0.8, atTimeSec);
        gain.gain.exponentialRampToValueAtTime(0.001, atTimeSec + 0.03);
        osc.start(atTimeSec);
        osc.stop(atTimeSec + 0.03);
        break;
      case 'kick':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, atTimeSec);
        osc.frequency.exponentialRampToValueAtTime(30, atTimeSec + 0.12);
        gain.gain.setValueAtTime(1.0, atTimeSec);
        gain.gain.exponentialRampToValueAtTime(0.001, atTimeSec + 0.12);
        osc.start(atTimeSec);
        osc.stop(atTimeSec + 0.12);
        break;
      case 'hihat':
        osc.type = 'square';
        osc.frequency.setValueAtTime(4000, atTimeSec);
        gain.gain.setValueAtTime(0.3, atTimeSec);
        gain.gain.exponentialRampToValueAtTime(0.001, atTimeSec + 0.02);
        osc.start(atTimeSec);
        osc.stop(atTimeSec + 0.02);
        break;
      case 'soft':
      default:
        osc.type = 'sine';
        osc.frequency.setValueAtTime(this.params.carrierHz, atTimeSec);
        gain.gain.setValueAtTime(0.7, atTimeSec);
        gain.gain.exponentialRampToValueAtTime(0.001, atTimeSec + 0.08);
        osc.start(atTimeSec);
        osc.stop(atTimeSec + 0.08);
        break;
    }
  }

  close(): void {
    this.stop();
    void this.context.close();
  }
}
