import { pendulumEase } from '../engine/motion';
import type { TickEarMode, TickSound, TickSubdivision } from './binauralEngine';

export interface RhythmSettings {
  secondsPerBeat: number;
  firstSide: -1 | 1;
  hangWeight: number;
  tickSound: TickSound;
  tickEarMode: TickEarMode;
  tickSubdivision: TickSubdivision;
  carrierHz: number;
}

/** A normalized two-second control loop, resampled by the audio engine to
 * the exact requested tempo. No rounded beat duration accumulates drift. */
export function makeSwingBuffer(context: BaseAudioContext, firstSide: number, hangWeight: number): AudioBuffer {
  const buffer = context.createBuffer(1, 16000, 8000);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const phase = 2 * i / data.length;
    const from = phase < 1 ? firstSide : -firstSide;
    data[i] = from * (1 - 2 * pendulumEase(phase % 1, hangWeight));
  }
  return buffer;
}

function wave(phase: number, frequency: number, sampleRate: number, sound: TickSound): number {
  if (sound !== 'wood' && sound !== 'hihat') return Math.sin(phase);
  // Band-limited Fourier series, avoiding aliased square/triangle edges.
  const maxHarmonic = Math.min(63, Math.floor((sampleRate * 0.48) / frequency));
  let result = 0;
  for (let n = 1; n <= maxHarmonic; n += 2) {
    result += Math.sin(n * phase) * (sound === 'hihat' ? 1 / n : (n % 4 === 1 ? 1 : -1) / (n * n));
  }
  return result * (sound === 'hihat' ? 4 / Math.PI : 8 / (Math.PI * Math.PI));
}

/** Stereo tick cycle rendered once, then looped by Web Audio indefinitely.
 * The 2ms onset and zero-valued release avoid waveform discontinuities. */
export function makeTickBuffer(context: BaseAudioContext, settings: RhythmSettings): AudioBuffer {
  const { secondsPerBeat, tickSound, carrierHz } = settings;
  const sampleRate = context.sampleRate;
  const length = Math.round(2 * secondsPerBeat * sampleRate);
  const buffer = context.createBuffer(2, length, sampleRate);
  const duration = { soft: 0.08, wood: 0.03, kick: 0.12, hihat: 0.02 }[tickSound];
  const peak = { soft: 0.7, wood: 0.8, kick: 1, hihat: 0.3 }[tickSound];
  const startHz = { soft: carrierHz, wood: 1200, kick: 150, hihat: 4000 }[tickSound];
  const endHz = { soft: carrierHz, wood: 100, kick: 30, hihat: 4000 }[tickSound];
  const ticks: Array<{ position: number; pan: number; scale: number }> = [];
  for (let beat = 0; beat < 2; beat++) {
    const side = settings.firstSide * (beat === 0 ? 1 : -1);
    if (settings.tickSubdivision !== 'CENTER') {
      ticks.push({ position: beat / 2, pan: settings.tickEarMode === 'BOTH' ? 0 :
        side * (settings.tickEarMode === 'OPPOSITE' ? -1 : 1), scale: 1 });
    }
    if (settings.tickSubdivision !== 'ENDS') ticks.push({ position: (beat + 0.5) / 2, pan: 0, scale: 0.55 });
  }
  for (const tick of ticks) {
    let phase = 0;
    for (let i = 0; i < (duration + 0.005) * sampleRate; i++) {
      const t = i / sampleRate;
      const hz = startHz * Math.pow(endHz / startHz, Math.min(t / duration, 1));
      const envelope = t < duration
        ? peak * Math.pow(0.0001 / peak, t / duration) * Math.min(1, t / 0.002)
        : 0.0001 * Math.max(0, 1 - (t - duration) / 0.005);
      const value = wave(phase, hz, sampleRate, tickSound) * envelope * tick.scale;
      phase += 2 * Math.PI * hz / sampleRate;
      const index = (Math.round(tick.position * length) + i) % length;
      buffer.getChannelData(0)[index] += value * Math.cos((tick.pan + 1) * Math.PI / 4);
      buffer.getChannelData(1)[index] += value * Math.sin((tick.pan + 1) * Math.PI / 4);
    }
  }
  return buffer;
}

/** Native looping sources keep going without any JavaScript timer refill.
 * The page scheduler remains responsible only for visual/haptic accents. */
export class ContinuousRhythm {
  private readonly swing: AudioBufferSourceNode;
  private ticks: AudioBufferSourceNode;
  private tickEnvelope: GainNode;
  private readonly preRoll: ConstantSourceNode | null;
  private stoppedAt: number | null = null;

  get finished(): boolean {
    return this.stoppedAt !== null && this.stoppedAt <= this.context.currentTime;
  }

  constructor(
    readonly context: BaseAudioContext,
    readonly startAt: number,
    readonly settings: RhythmSettings,
    leftDepth: AudioNode,
    rightDepth: AudioNode,
    private readonly tickDestination: AudioNode,
    primeFirstPosition = false,
  ) {
    this.preRoll = primeFirstPosition ? context.createConstantSource() : null;
    if (this.preRoll) {
      this.preRoll.offset.value = settings.firstSide;
      this.preRoll.connect(leftDepth);
      this.preRoll.connect(rightDepth);
      this.preRoll.onended = () => this.preRoll?.disconnect();
      this.preRoll.start();
      this.preRoll.stop(startAt);
    }
    this.swing = context.createBufferSource();
    this.swing.buffer = makeSwingBuffer(context, settings.firstSide, settings.hangWeight);
    this.swing.loop = true;
    this.swing.playbackRate.value = 1 / settings.secondsPerBeat;
    this.swing.connect(leftDepth);
    this.swing.connect(rightDepth);
    this.swing.onended = () => this.swing.disconnect();
    this.swing.start(startAt);
    [this.ticks, this.tickEnvelope] = this.createTicks(startAt, false);
  }

  private createTicks(at: number, fadeIn: boolean, buffer = makeTickBuffer(this.context, this.settings)): [AudioBufferSourceNode, GainNode] {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const rate = source.buffer.duration / (2 * this.settings.secondsPerBeat);
    source.playbackRate.value = rate;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(fadeIn ? 0 : 1, at);
    if (fadeIn) gain.gain.linearRampToValueAtTime(1, at + 0.01);
    source.connect(gain).connect(this.tickDestination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    const offset = ((at - this.startAt) % (2 * this.settings.secondsPerBeat)) * rate;
    source.start(at, Math.max(0, offset));
    return [source, gain];
  }

  updateTicks(settings: Partial<RhythmSettings>): void {
    if (this.stoppedAt !== null) return;
    Object.assign(this.settings, settings);
    // Rendering a different timbre can take measurable time on a phone.
    // Pick the shared crossfade/phase timestamp AFTER that work finishes.
    const buffer = makeTickBuffer(this.context, this.settings);
    const at = Math.max(this.context.currentTime + 0.01, this.startAt);
    this.tickEnvelope.gain.cancelScheduledValues(at);
    this.tickEnvelope.gain.setValueAtTime(this.tickEnvelope.gain.value, at);
    this.tickEnvelope.gain.linearRampToValueAtTime(0, at + 0.01);
    this.ticks.stop(at + 0.01);
    [this.ticks, this.tickEnvelope] = this.createTicks(at, true, buffer);
  }

  stop(at: number): void {
    // A subsequent manual pause must also retract a future tempo transition.
    if (this.stoppedAt !== null && this.stoppedAt <= at) return;
    this.stoppedAt = at;
    this.preRoll?.stop(Math.min(at, this.startAt));
    this.swing.stop(at);
    this.ticks.stop(at);
  }
}
