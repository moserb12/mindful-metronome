// Independent mono binaural tones -> explicit stereo merger -> analyser.
// Pendulum gain modulation and ticks loop on the audio rendering thread;
// no page timer is required to keep those layers playing. The real media
// element remains the noise source/media-focus anchor. OS interruption can
// still suspend rendering; lifecycle recovery is best effort.

import { recordAudioDiagnostic } from './audioDiagnostics';
import { BinauralVoice } from './binauralVoice';
import { ContinuousRhythm } from './continuousRhythm';
import { crossfadeLoop } from './loopSeam';
import { mixHeadroom, tickMixerGain } from './mixHeadroom';
import { scheduleSessionGate } from './sessionEnvelope';
import { calibrateNoiseBuffer } from './volumeCalibration';
import { ScheduledAudioSourceRegistry } from './scheduledAudioSources';

export type TickSound = 'soft' | 'wood' | 'kick' | 'hihat';

/** Which noise-shield texture plays behind the drone/tick layers. See
 * src/data/noiseShields.ts for the user-facing description of each and
 * which brainwave bands/tempos it pairs well with. The three "ambiance"
 * textures (rainyForest/tinRoof/drippyCavern) extend the same picker/
 * volume slider as pink/white/brown — see buildRainyForestBuffer/
 * buildTinRoofBuffer/buildDrippyCavernBuffer below for how each is
 * synthesized. */
export type NoiseType = 'pink' | 'white' | 'brown' | 'rainyForest' | 'tinRoof' | 'drippyCavern';

/** How often a listener wants a chime marking elapsed PLAY time —
 * escalating (1 ring at the first mark, 2 at the second, etc.), reset to
 * expecting "1" on every Pause/Stop. `null` is off — explicitly opt-in,
 * unlike TickSubdivision's always-on default. See playIntervalChime(). */
export type ChimeInterval = 15 | 30 | 45 | 60 | null;

/** Placement of the tick only; the two drone tones never switch ears. */
export type TickEarMode = 'MATCH' | 'OPPOSITE' | 'BOTH';

/** Tick pattern baked into the native two-beat audio loop. */
export type TickSubdivision = 'ENDS' | 'ENDS_AND_CENTER' | 'CENTER';


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


/** Duration of one chime tone, and the gap after it before the next one
 * in the same escalating ring — see playIntervalChime(). */
const INTERVAL_CHIME_TONE_SEC = 0.35;
const INTERVAL_CHIME_GAP_SEC = 0.28;

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
   * other. 0.6 lands on an 80/20 <-> 20/80 swing. See scheduleDroneSwing(). */
  panModulationDepth: number;
  tickEarMode: TickEarMode;
  tickSubdivision: TickSubdivision;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}


/** Generates a buffer of pink noise (Paul Kellet's refined method — the
 * same filter cascade used by countless Web Audio noise generators). Pink
 * noise, unlike white, has equal energy per octave, which reads as much
 * softer/warmer texture to the ear. */
export function buildPinkNoiseBuffer(context: AudioContext, seconds = 8): AudioBuffer {
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
export function buildWhiteNoiseBuffer(context: AudioContext, seconds = 8): AudioBuffer {
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
export function buildBrownNoiseBuffer(context: AudioContext, seconds = 8): AudioBuffer {
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

/** Encode a generated mono AudioBuffer as an ordinary WAV media resource.
 * Chrome on Android grants durable media focus to a playing media element,
 * while a MediaStream-backed element can be suspended after screen-off. The
 * noise layer therefore enters the Web Audio graph through a real looping
 * <audio> resource and anchors the Android notification/media session. */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const samples = crossfadeLoop(buffer.getChannelData(0), buffer.sampleRate * 0.1);
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);

  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * bytesPerSample, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return new Blob([wav], { type: 'audio/wav' });
}

/** Generates 8 seconds of "rainy forest" ambiance: a pink-noise bed (the
 * same Paul Kellet cascade as buildPinkNoiseBuffer, scaled down to ~40%
 * since it's a bed under the droplets, not the whole texture) plus
 * layered droplet transients timed by a Poisson process — each a short
 * decaying noise burst softened through a one-pole lowpass into a "plip"
 * rather than a click. The longer loop makes its transient-based seam
 * imperceptible and meets Android media-session duration requirements. */
function buildRainyForestBuffer(context: AudioContext, seconds = 8): AudioBuffer {
  const bufferSize = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  const sampleRate = context.sampleRate;

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
    output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.03 * 0.4;
    b6 = white * 0.115926;
  }

  const dropletsPerSec = 14;
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - Math.random()) / dropletsPerSec;
    if (t >= seconds) break;
    const startSample = Math.floor(t * sampleRate);
    const durationSec = 0.015 + Math.random() * 0.02; // 15-35ms
    const durationSamples = Math.floor(durationSec * sampleRate);
    const peak = 0.12 + Math.random() * 0.08;
    let lowpassState = 0;
    for (let i = 0; i < durationSamples && startSample + i < bufferSize; i++) {
      const decay = Math.exp(-i / (durationSamples * 0.35));
      const white = (Math.random() * 2 - 1) * peak * decay;
      lowpassState += (white - lowpassState) * 0.35; // one-pole lowpass softens the burst into a "plip"
      output[startSample + i] += lowpassState;
    }
  }

  return buffer;
}

/** Generates 8 seconds of "tin roof" ambiance: sparse, louder, more tonal
 * pings — each a damped sine burst in the 1800-4000 Hz range, no noise
 * bed, timed by a Poisson process. */
function buildTinRoofBuffer(context: AudioContext, seconds = 8): AudioBuffer {
  const bufferSize = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  const sampleRate = context.sampleRate;

  const pingsPerSec = 3.5;
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - Math.random()) / pingsPerSec;
    if (t >= seconds) break;
    const startSample = Math.floor(t * sampleRate);
    const freq = 1800 + Math.random() * 2200; // 1800-4000 Hz
    const durationSec = 0.06 + Math.random() * 0.05; // 60-110ms decay
    const durationSamples = Math.floor(durationSec * sampleRate);
    const peak = 0.18 + Math.random() * 0.1;
    for (let i = 0; i < durationSamples && startSample + i < bufferSize; i++) {
      const decay = Math.exp(-i / (durationSamples * 0.3));
      output[startSample + i] += Math.sin((2 * Math.PI * freq * i) / sampleRate) * peak * decay;
    }
  }

  return buffer;
}

/** Generates 8 seconds of "drippy cavern" ambiance: a near-silent rumble
 * bed (the same leaky-integrator technique as buildBrownNoiseBuffer,
 * drastically scaled down) plus very sparse plinks, each followed by 3
 * exponentially-decaying delayed repeats — a cheap "poor man's reverb"
 * rather than a real convolution reverb. */
function buildDrippyCavernBuffer(context: AudioContext, seconds = 8): AudioBuffer {
  const bufferSize = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  const sampleRate = context.sampleRate;

  const leak = 0.02;
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + leak * white) / (1 + leak);
    output[i] = lastOut * 0.15;
  }

  const plinksPerSec = 0.6;
  const repeatDelaysSec = [0, 0.09, 0.19, 0.31];
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - Math.random()) / plinksPerSec;
    if (t >= seconds) break;
    const freq = 500 + Math.random() * 400;
    const peak = 0.2 + Math.random() * 0.1;
    repeatDelaysSec.forEach((delaySec, repeatIndex) => {
      const repeatStartSec = t + delaySec;
      if (repeatStartSec >= seconds) return;
      const startSample = Math.floor(repeatStartSec * sampleRate);
      const durationSec = 0.4;
      const durationSamples = Math.floor(durationSec * sampleRate);
      const repeatPeak = peak * Math.pow(0.5, repeatIndex);
      for (let i = 0; i < durationSamples && startSample + i < bufferSize; i++) {
        const decay = Math.exp(-i / (durationSamples * 0.25));
        output[startSample + i] += Math.sin((2 * Math.PI * freq * i) / sampleRate) * repeatPeak * decay;
      }
    });
  }

  return buffer;
}

export class BinauralEngine {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;

  private voice: BinauralVoice | null = null;
  private channelProbe: BinauralVoice | null = null;
  private rhythm: ContinuousRhythm | null = null;
  private readonly retiringRhythms = new Set<ContinuousRhythm>();
  private readonly noiseElement: HTMLAudioElement;
  private readonly noiseUrls: Record<NoiseType, string>;
  private mediaElementPauseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduledTransientSources = new ScheduledAudioSourceRegistry();

  private readonly tickGain: GainNode;
  private readonly noiseGain: GainNode;
  private readonly transientGateGain: GainNode;
  /** Final trim applied AFTER analyser, on top of the already-mixed signal
   * — see the file-level comment for why this doesn't replace the
   * per-channel gains above. */
  private readonly masterGain: GainNode;
  private readonly headroomGain: GainNode;
  private readonly sessionGain: GainNode;
  private readonly closingSources = new ScheduledAudioSourceRegistry();
  private closingGain: GainNode | null = null;

  private params: MetronomeParams;
  private playing = false;

  constructor(initialParams: MetronomeParams) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // Safari's playback category requests background/media behavior where
    // implemented. It is a request, not an exemption from OS suspension.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (audioSession) {
      try { audioSession.type = 'playback'; } catch { /* Unsupported category. */ }
    }
    this.context = new AudioCtx();
    this.params = initialParams;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = clamp01(initialParams.masterVolume);
    this.headroomGain = this.context.createGain();
    this.headroomGain.gain.value = mixHeadroom(initialParams.droneVolume, initialParams.tickVolume, initialParams.noiseVolume);
    this.analyser.connect(this.headroomGain).connect(this.masterGain);
    this.sessionGain = this.context.createGain();
    this.masterGain.connect(this.sessionGain).connect(this.context.destination);

    this.tickGain = this.context.createGain();
    this.tickGain.gain.value = tickMixerGain(initialParams.tickVolume);
    this.transientGateGain = this.context.createGain();
    this.transientGateGain.gain.value = 1;
    this.tickGain.connect(this.transientGateGain);
    this.transientGateGain.connect(this.analyser);

    this.noiseGain = this.context.createGain();
    this.noiseGain.gain.value = initialParams.noiseVolume;
    this.noiseGain.connect(this.analyser);

    const noiseBuffers: Record<NoiseType, AudioBuffer> = {
      pink: calibrateNoiseBuffer(buildPinkNoiseBuffer(this.context)),
      white: calibrateNoiseBuffer(buildWhiteNoiseBuffer(this.context)),
      brown: calibrateNoiseBuffer(buildBrownNoiseBuffer(this.context)),
      rainyForest: buildRainyForestBuffer(this.context),
      tinRoof: buildTinRoofBuffer(this.context),
      drippyCavern: buildDrippyCavernBuffer(this.context),
    };

    this.noiseUrls = Object.fromEntries(
      Object.entries(noiseBuffers).map(([type, buffer]) => [type, URL.createObjectURL(audioBufferToWavBlob(buffer))])
    ) as Record<NoiseType, string>;
    this.noiseElement = new Audio(this.noiseUrls[initialParams.noiseType]);
    this.noiseElement.loop = true;
    this.noiseElement.preload = 'auto';
    this.noiseElement.title = 'Mindful Metronome';
    this.noiseElement.hidden = true;
    this.noiseElement.setAttribute('aria-hidden', 'true');
    this.noiseElement.dataset.audioOutput = 'media-anchor';
    document.body.appendChild(this.noiseElement);
    this.context.createMediaElementSource(this.noiseElement).connect(this.noiseGain);

    this.context.addEventListener('statechange', () => {
      recordAudioDiagnostic('audio-context-state', { state: this.context.state, playing: this.playing });
    });
    this.noiseElement.addEventListener('loadedmetadata', () => {
      recordAudioDiagnostic('media-element-metadata', {
        live: false,
        durationSec: Number.isFinite(this.noiseElement.duration) ? this.noiseElement.duration : null,
      });
    });
    this.noiseElement.addEventListener('play', () => recordAudioDiagnostic('media-element-play'));
    this.noiseElement.addEventListener('pause', () => recordAudioDiagnostic('media-element-pause'));
    this.noiseElement.addEventListener('error', () => {
      recordAudioDiagnostic('media-element-error', { code: this.noiseElement.error?.code ?? null });
    });
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** A quiet, one-second probe through the same stereo voice/output graph.
   * No settings change and no media playback session is started. */
  async testHeadphoneChannel(side: 'left' | 'right'): Promise<boolean> {
    if (this.playing) return false;
    try {
      await this.context.resume();
      if (this.playing) return false;
      this.cancelSessionFade();
      const now = this.context.currentTime;
      this.channelProbe?.stop(now + 0.03);
      const probe = new BinauralVoice(this.context, this.analyser);
      probe.start(this.params.carrierHz, this.params.beatHz, 0.3, 0);
      (side === 'left' ? probe.rightLevel : probe.leftLevel).gain.value = 0;
      probe.stop(now + 1, now + 0.97, 0.3);
      this.channelProbe = probe;
      recordAudioDiagnostic('headphone-channel-test', { side });
      return true;
    } catch {
      recordAudioDiagnostic('headphone-channel-test-failed', { side });
      return false;
    }
  }

  /** Start the continuous drone + noise shield. Must be called from a real
   * user gesture (browsers block AudioContext otherwise) — the caller
   * should also `resume()` a suspended context first. Idempotent: calling
   * twice in a row while already playing is a no-op. */
  start(): void {
    if (this.playing) return;
    this.channelProbe?.stop(this.context.currentTime + 0.03);
    this.channelProbe = null;
    this.playing = true;
    if (this.mediaElementPauseTimer) {
      clearTimeout(this.mediaElementPauseTimer);
      this.mediaElementPauseTimer = null;
    }

    // stop() fades these persistent gain nodes to zero. They survive across
    // playthroughs, so every fresh start must restore the mix before the
    // new sources begin (including a rapid stop/start during the 30ms fade).
    const now = this.context.currentTime;
    this.sessionGain.gain.cancelScheduledValues(now);
    this.sessionGain.gain.setValueAtTime(1, now);
    [this.noiseGain, this.transientGateGain].forEach((gainNode) => {
      gainNode.gain.cancelScheduledValues(now);
    });
    this.noiseGain.gain.setValueAtTime(clamp01(this.params.noiseVolume), now);
    this.transientGateGain.gain.setValueAtTime(1, now);

    this.voice = new BinauralVoice(this.context, this.analyser);
    this.voice.start(this.params.carrierHz, this.params.beatHz, this.params.droneVolume, this.params.panModulationDepth);
    recordAudioDiagnostic('playback-start', {
      contextState: this.context.state,
      routing: 'independent-mono-to-stereo-merger',
      leftHz: this.params.carrierHz,
      rightHz: this.params.carrierHz + this.params.beatHz,
    });
    void this.resume();
  }

  /** Reacquire both Web Audio rendering and Android media focus. Starting
   * both promises before awaiting either keeps this safe inside the user's
   * initial click, while later lifecycle calls are best-effort recovery. */
  async resume(): Promise<boolean> {
    const attempts: Promise<unknown>[] = [];
    if (this.context.state !== 'running' && this.context.state !== 'closed') {
      attempts.push(this.context.resume());
    }
    if (this.playing && this.noiseElement.paused) {
      attempts.push(this.noiseElement.play());
    }

    const results = await Promise.allSettled(attempts);
    const succeeded = results.every((result) => result.status === 'fulfilled');
    recordAudioDiagnostic('playback-resume-attempt', {
      contextState: this.context.state,
      mediaPaused: this.noiseElement.paused,
      succeeded,
    });
    return succeeded && this.context.state === 'running' && !this.noiseElement.paused;
  }

  /** Stop every audible layer, including one-shot ticks already committed
   * to the Web Audio timeline by the background lookahead scheduler. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;

    // Fade all audible layers before stopping their native sources.
    const now = this.context.currentTime;
    const stopAtSec = now + DRONE_STOP_RELEASE_SEC;
    [this.noiseGain].forEach((gainNode) => {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, stopAtSec);
    });
    this.voice?.stop(stopAtSec);
    this.voice = null;
    this.rhythm?.stop(stopAtSec);
    this.rhythm = null;
    this.retiringRhythms.forEach(rhythm => rhythm.stop(stopAtSec));
    this.retiringRhythms.clear();

    // Silence and cancel every tick/chime that was pre-scheduled during the
    // 30-second background window. Merely stopping BeatScheduler prevents
    // new work; it cannot retract AudioScheduledSourceNodes already queued.
    this.transientGateGain.gain.cancelScheduledValues(now);
    this.transientGateGain.gain.setValueAtTime(this.transientGateGain.gain.value, now);
    this.transientGateGain.gain.linearRampToValueAtTime(0, stopAtSec);
    const canceledTransientCount = this.cancelScheduledTransients(stopAtSec);
    this.closingSources.cancelAll(stopAtSec);
    this.mediaElementPauseTimer = setTimeout(() => {
      this.noiseElement.pause();
      this.noiseElement.currentTime = 0;
      this.mediaElementPauseTimer = null;
    }, DRONE_STOP_RELEASE_SEC * 1000 + 5);

    // Restore the user's master trim for the next playthrough.
    this.masterGain.gain.cancelScheduledValues(this.context.currentTime);
    this.masterGain.gain.setValueAtTime(this.params.masterVolume, this.context.currentTime);
    recordAudioDiagnostic('playback-stop', {
      contextState: this.context.state,
      canceledTransientCount,
    });
  }

  /** Schedule the fade and final silence on a dedicated native gate.
   * Neither page-timer delays nor master-volume changes can undo it. */
  scheduleSessionEnd(durationSec: number, fadeDurationSec: number): void {
    this.cancelSessionFade();
    const now = this.context.currentTime;
    const fadeAt = scheduleSessionGate(this.sessionGain, now, durationSec, fadeDurationSec);
    this.playClosingChime(fadeAt);
  }

  /** Cancel the previous deadline before rearming or choosing Infinite. */
  cancelSessionFade(): void {
    const now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.params.masterVolume, now);
    this.sessionGain.gain.cancelScheduledValues(now);
    this.sessionGain.gain.setValueAtTime(1, now);
    if (this.closingGain) {
      this.closingGain.gain.cancelScheduledValues(now);
      this.closingGain.gain.setValueAtTime(this.closingGain.gain.value, now);
      this.closingGain.gain.linearRampToValueAtTime(0, now + 0.03);
    }
    this.closingSources.cancelAll(now + 0.03);
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
  playClosingChime(atTimeSec = this.context.currentTime): void {
    const now = atTimeSec;
    const root = this.params.carrierHz;
    const intervals = [1, 1.5, 2]; // root, fifth, octave
    const chimeGain = this.context.createGain();
    this.closingGain = chimeGain;
    chimeGain.connect(this.transientGateGain);
    chimeGain.gain.setValueAtTime(0, now);
    chimeGain.gain.linearRampToValueAtTime(0.35, now + 0.3);
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 4);

    let remaining = intervals.length;
    intervals.forEach((ratio) => {
      const osc = this.context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = root * ratio;
      osc.connect(chimeGain);
      this.closingSources.track(osc);
      osc.addEventListener('ended', () => {
        osc.disconnect();
        if (--remaining === 0) chimeGain.disconnect();
      }, { once: true });
      osc.start(now);
      osc.stop(now + 4.1);
    });
  }

  /**
   * The escalating "chime every N minutes" tone — 1 ring at the first
   * elapsed-play-time mark, 2 at the second, and so on (see ChimeInterval
   * and its scheduling in useMetronomeEngine.ts's handleBeatScheduled,
   * which computes `chimeCount` and calls this at a precise pre-scheduled
   * AudioContext time, never "now"). A distinct, lighter timbre than
   * playClosingChime() (reserved for session-end): an octave-up root, a
   * fifth above, for a bell character rather than a resolving chord.
   * Routed to `analyser`, the same mix point as everything else.
   */
  playIntervalChime(atTimeSec: number, chimeCount: number): void {
    const root = this.params.carrierHz * 2;
    // Bound the work and avoid overlapping minute-long trains after days
    // of open-ended playback. The count still grows through twelve rings.
    for (let i = 0; i < Math.min(chimeCount, 12); i++) {
      const toneStart = atTimeSec + i * (INTERVAL_CHIME_TONE_SEC + INTERVAL_CHIME_GAP_SEC);
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(root * 1.5, toneStart);
      gain.gain.setValueAtTime(0, toneStart);
      gain.gain.linearRampToValueAtTime(0.28, toneStart + 0.015);
      osc.connect(gain).connect(this.transientGateGain);
      this.trackTransientSource(osc);
      osc.addEventListener('ended', () => { osc.disconnect(); gain.disconnect(); }, { once: true });
      const stopAt = toneStart + INTERVAL_CHIME_TONE_SEC;
      // Same click-free release shape as fireTickOscillator(): ride the
      // exponential decay near-silent, then a short linear ramp to an
      // exact 0 before stop() (an exponential ramp can only approach
      // zero, never reach it).
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      gain.gain.linearRampToValueAtTime(0, stopAt + TICK_RELEASE_TAIL_SEC);
      osc.start(toneStart);
      osc.stop(stopAt + TICK_RELEASE_TAIL_SEC);
    }
  }

  /** Smoothly retune the drone to a new carrier/beat pair without a click —
   * safe to call continuously while a slider drags. */
  setFrequencies(carrierHz: number, beatHz: number): void {
    this.params.carrierHz = carrierHz;
    this.params.beatHz = beatHz;
    this.voice?.setFrequencies(carrierHz, beatHz);
    this.rhythm?.updateTicks({ carrierHz });
  }

  /** Independent gain controls remain responsive without replacing a loop. */
  setVolumes(droneVolume: number, tickVolume: number, noiseVolume: number): void {
    this.params.droneVolume = droneVolume;
    this.params.tickVolume = tickVolume;
    this.params.noiseVolume = noiseVolume;
    const trim = mixHeadroom(droneVolume, tickVolume, noiseVolume);
    // Make room faster than the layer gains rise; restore trim more slowly
    // than they fall. Equal time constants can overshoot while both move.
    this.headroomGain.gain.setTargetAtTime(trim, this.context.currentTime,
      trim < this.headroomGain.gain.value ? 0.003 : 0.25);
    this.voice?.setVolume(droneVolume);
    this.tickGain.gain.setTargetAtTime(tickMixerGain(tickVolume), this.context.currentTime, 0.03);
    this.noiseGain.gain.setTargetAtTime(clamp01(noiseVolume), this.context.currentTime, 0.03);
  }

  /** Final trim on top of the already-mixed signal — turning this down
   * (even to 0) never touches the individual drone/tick/noise balances, so
   * bringing it back up restores exactly the mix that was there before. */
  setMasterVolume(masterVolume: number): void {
    this.params.masterVolume = clamp01(masterVolume);
    this.masterGain.gain.setTargetAtTime(this.params.masterVolume, this.context.currentTime, 0.03);
  }

  /** Swap the looping media resource behind the shared noise gain. The
   * element itself stays connected so Android keeps one stable media
   * session across texture changes. */
  setNoiseType(noiseType: NoiseType): void {
    this.params.noiseType = noiseType;
    this.noiseElement.src = this.noiseUrls[noiseType];
    this.noiseElement.load();
    if (this.playing) void this.resume();
  }

  setTickSound(tickSound: TickSound): void {
    this.params.tickSound = tickSound;
    this.rhythm?.updateTicks({ tickSound });
  }

  setTickEarMode(mode: TickEarMode): void {
    this.params.tickEarMode = mode;
    this.rhythm?.updateTicks({ tickEarMode: mode });
  }

  setTickSubdivision(tickSubdivision: TickSubdivision): void {
    this.params.tickSubdivision = tickSubdivision;
    this.rhythm?.updateTicks({ tickSubdivision });
  }

  /** Preserve the existing constant-sum ear balance; depth zero is steady. */
  setPanModulationDepth(depth: number): void {
    this.params.panModulationDepth = clamp01(depth);
    this.voice?.setDepth(depth);
  }

  /** Retract rhythm events that the lookahead scheduler already committed
   * at or after a shared transition point. The continuous drone/noise stay
   * alive; the caller immediately replaces these ticks and swing curves
   * with a new tempo phase beginning at the same pendulum endpoint. */
  clearScheduledRhythmAfter(transitionTimeSec: number): void {
    if (this.rhythm) {
      this.rhythm.stop(transitionTimeSec);
      this.retiringRhythms.add(this.rhythm);
      this.rhythm = null;
    }
    // Keep only transitions still in flight (manual pause must stop these).
    this.retiringRhythms.forEach(rhythm => {
      if (rhythm.finished) {
        this.retiringRhythms.delete(rhythm);
      }
    });
    const canceledTransientCount = this.cancelScheduledTransients(transitionTimeSec);
    recordAudioDiagnostic('rhythm-rescheduled', {
      transitionTimeSec,
      canceledTransientCount,
    });
  }

  /** Begin one perpetual two-beat loop at a shared audio/visual boundary.
   * Call again only after clearScheduledRhythmAfter(), not once per beat. */
  scheduleDroneSwing(fromPan: number, _toPan: number, hangWeight: number, fromTimeSec: number, toTimeSec: number): void {
    const duration = toTimeSec - fromTimeSec;
    if (duration <= 0 || !this.voice || this.rhythm) return;
    this.rhythm = new ContinuousRhythm(this.context, fromTimeSec, {
      secondsPerBeat: duration,
      firstSide: fromPan < 0 ? -1 : 1,
      hangWeight,
      tickSound: this.params.tickSound,
      tickEarMode: this.params.tickEarMode,
      tickSubdivision: this.params.tickSubdivision,
      carrierHz: this.params.carrierHz,
    }, this.voice.leftDepth, this.voice.rightDepth, this.tickGain, this.retiringRhythms.size === 0);
    recordAudioDiagnostic('native-rhythm-start', { fromTimeSec, secondsPerBeat: duration });
  }


  private trackTransientSource(source: AudioScheduledSourceNode): void {
    this.scheduledTransientSources.track(source);
  }

  private cancelScheduledTransients(stopAtSec: number): number {
    return this.scheduledTransientSources.cancelAll(stopAtSec);
  }

  close(): void {
    this.stop();
    this.channelProbe?.stop(this.context.currentTime);
    if (this.mediaElementPauseTimer) clearTimeout(this.mediaElementPauseTimer);
    this.noiseElement.pause();
    this.noiseElement.removeAttribute('src');
    this.noiseElement.load();
    this.noiseElement.remove();
    Object.values(this.noiseUrls).forEach((url) => URL.revokeObjectURL(url));
    void this.context.close();
  }
}
