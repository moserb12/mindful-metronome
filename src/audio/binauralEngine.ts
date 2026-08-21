// ============================================================================
// BinauralEngine — the audio heart of Mindful Metronome.
//
// Two independent layers, both real Web Audio, both routed through their
// own GainNode (never one master volume — same principle Brain Bridging
// Beats uses for its feedback channels: a listener should be able to bring
// either layer down to zero without touching the other):
//
//   - DRONE: a continuous binaural pair — one sine in each ear, offset by
//     `beatHz`. The brain never actually receives that difference tone; it's
//     synthesized in the auditory brainstem from two real, steady pitches.
//     This is the "flow state" background layer.
//   - TICK: short, percussive ticks that alternate ears in time with the
//     BPM — the literal metronome. Each tick is scheduled at a precise
//     AudioContext time by a BeatScheduler (src/engine/timing.ts), and
//     which ear it fires into alternates with the beat index, so the
//     audio always agrees with the visual arm swinging between the two
//     "hemisphere" sides.
//
// A third, quiet PINK NOISE layer is optional texture ("shield") behind
// both — pure ambience, panned center.
//
// Nothing in this file assumes React or the DOM beyond the Web Audio API
// and StereoPannerNode; src/hooks/useMetronomeEngine.ts is the thin React
// wrapper around it.
// ============================================================================

export type TickSound = 'soft' | 'wood' | 'kick' | 'hihat';

export interface MetronomeParams {
  carrierHz: number;
  beatHz: number;
  droneVolume: number; // 0-1
  tickVolume: number; // 0-1
  noiseVolume: number; // 0-1
  tickSound: TickSound;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
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

export class BinauralEngine {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;

  private oscLeft: OscillatorNode | null = null;
  private oscRight: OscillatorNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private readonly pinkNoiseBuffer: AudioBuffer;

  private readonly droneGain: GainNode;
  private readonly tickGain: GainNode;
  private readonly noiseGain: GainNode;

  private params: MetronomeParams;
  private playing = false;

  constructor(initialParams: MetronomeParams) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new AudioCtx();
    this.params = initialParams;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.connect(this.context.destination);

    this.droneGain = this.context.createGain();
    this.droneGain.gain.value = initialParams.droneVolume;
    this.droneGain.connect(this.analyser);

    this.tickGain = this.context.createGain();
    this.tickGain.gain.value = initialParams.tickVolume;
    this.tickGain.connect(this.analyser);

    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = initialParams.noiseVolume;
    this.noiseGain.connect(this.analyser);

    this.pinkNoiseBuffer = buildPinkNoiseBuffer(this.context);
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
    this.oscLeft.connect(panLeft).connect(this.droneGain);

    this.oscRight = this.context.createOscillator();
    this.oscRight.type = 'sine';
    this.oscRight.frequency.value = this.params.carrierHz + this.params.beatHz;
    const panRight = this.context.createStereoPanner();
    panRight.pan.value = 1;
    this.oscRight.connect(panRight).connect(this.droneGain);

    this.oscLeft.start();
    this.oscRight.start();

    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = this.pinkNoiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start();
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
    this.droneGain.gain.setTargetAtTime(clamp01(droneVolume), this.context.currentTime, 0.03);
    this.tickGain.gain.setTargetAtTime(clamp01(tickVolume), this.context.currentTime, 0.03);
    this.noiseGain.gain.setTargetAtTime(clamp01(noiseVolume), this.context.currentTime, 0.03);
  }

  setTickSound(tickSound: TickSound): void {
    this.params.tickSound = tickSound;
  }

  /**
   * Play one metronome tick, panned fully to `side`, at a precise
   * pre-scheduled AudioContext time — never "now" (see
   * src/engine/timing.ts's TimeDomainSync for why real-time scheduling
   * matters). This is what makes the ear alternate in sync with the visual
   * arm: the caller decides left/right from the same beat index driving
   * the arm's swing.
   */
  playTick(side: 'left' | 'right', atTimeSec: number): void {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    panner.pan.value = side === 'left' ? -1 : 1;

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
