import { BinauralVoice } from '../src/audio/binauralVoice';
import { ContinuousRhythm } from '../src/audio/continuousRhythm';
import { scheduleSessionGate } from '../src/audio/sessionEnvelope';

const output = document.querySelector('#results')!;
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function rms(samples: Float32Array, start: number, end: number) {
  let power = 0;
  for (let i = start; i < end; i++) power += samples[i] ** 2;
  return Math.sqrt(power / (end - start));
}
function amplitude(samples: Float32Array, hz: number, sampleRate: number, startSec = 2, durationSec = 2) {
  let re = 0, im = 0;
  const start = Math.round(startSec * sampleRate), length = Math.round(durationSec * sampleRate);
  for (let i = start; i < start + length; i++) {
    const phase = i * 2 * Math.PI * hz / sampleRate;
    re += samples[i] * Math.cos(phase);
    im += samples[i] * Math.sin(phase);
  }
  return 2 * Math.hypot(re, im) / length;
}
function context(seconds: number, rate = 48000) {
  return new OfflineAudioContext(2, seconds * rate, rate);
}
function voice(ctx: OfflineAudioContext, offset = 10, depth = 0) {
  // Exercise the actual production voice and downstream analyser/master path.
  const analyser = ctx.createAnalyser();
  const master = ctx.createGain();
  analyser.connect(master).connect(ctx.destination);
  const v = new BinauralVoice(ctx, analyser);
  v.start(200, offset, 1, depth);
  return v;
}
async function run() {
  const results: string[] = [];
  const report = (text: string) => { results.push(`PASS ${text}`); output.textContent = results.join('\n'); };
  for (const rate of [44100, 48000]) {
    const ctx = context(5, rate);
    voice(ctx);
    const rendered = await ctx.startRendering();
    const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
    const l200 = amplitude(left, 200, rate), l210 = amplitude(left, 210, rate);
    const r210 = amplitude(right, 210, rate), r200 = amplitude(right, 200, rate);
    assert(l200 > 0.49 && r210 > 0.49, 'Both independent tones must be audible');
    assert(l210 < 0.00001 && r200 < 0.00001, 'Wrong-ear carrier leakage');
    assert(Math.abs(l200 - r210) < 0.0001, 'Steady ears must have equal levels');
    report(`${rate}Hz stereo: left 200Hz=${l200.toFixed(6)}, right 210Hz=${r210.toFixed(6)}, wrong-ear leakage <0.00001`);
  }
  {
    // Deliberately schedule ONCE and render 90 seconds: longer than the old
    // 30-second queue, without a single scheduler refill or page timer.
    const ctx = context(91, 16000);
    const v = voice(ctx, 10, 0.8);
    const tickBus = ctx.createGain();
    tickBus.gain.value = 0;
    tickBus.connect(ctx.destination);
    const rhythm = new ContinuousRhythm(ctx, 0, {
      secondsPerBeat: 1, firstSide: -1, hangWeight: 0.5, tickSound: 'soft',
      tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200,
    }, v.leftDepth, v.rightDepth, tickBus);
    const pausePoint = ctx.suspend(90.45);
    const rendering = ctx.startRendering();
    await pausePoint;
    rhythm.stop(ctx.currentTime + 0.03);
    v.stop(ctx.currentTime + 0.03);
    await ctx.resume();
    const rendered = await rendering;
    const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
    for (const t of [4, 30, 60, 88]) {
      const begin = t * 16000, end = begin + 160;
      const leftFavored = rms(left, begin, end) / rms(right, begin, end);
      const rightFavored = rms(right, begin + 16000, end + 16000) / rms(left, begin + 16000, end + 16000);
      assert(leftFavored > 8 && rightFavored > 8, `90/10 swing stalled at ${t}s`);
    }
    assert(rms(left, 90.6 * 16000, 91 * 16000) === 0, 'Pause must silence the voice');
    report('90-second native swing: both ears still alternate at 4/30/60/88s, no queue refills; pause silences output');
  }
  {
    const ctx = context(92, 16000);
    const dummyLeft = ctx.createGain(), dummyRight = ctx.createGain();
    const rhythm = new ContinuousRhythm(ctx, 0, {
      secondsPerBeat: 0.9375, firstSide: -1, hangWeight: 0.5, tickSound: 'soft',
      tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200,
    }, dummyLeft, dummyRight, ctx.destination);
    rhythm.stop(90);
    const rendered = await ctx.startRendering();
    for (const beat of [0, 1, 33, 64, 95]) {
      const sample = Math.round(beat * 0.9375 * 16000);
      const side = beat % 2;
      assert(rms(rendered.getChannelData(side), sample, sample + 1000) > 0.03, `Tick ${beat} missing`);
      assert(rms(rendered.getChannelData(1 - side), sample, sample + 1000) < 1e-8, `Tick ${beat} in wrong ear`);
    }
    assert(rms(rendered.getChannelData(0), 90 * 16000, 92 * 16000) === 0, 'Lingering ticks after pause');
    report('Native tick loop: exact ear/beat at 64 BPM through 89s; no audio after pause');
  }
  {
    const ctx = context(8);
    const v = voice(ctx, 10, 0.8);
    const silentTicks = ctx.createGain();
    silentTicks.gain.value = 0;
    silentTicks.connect(ctx.destination);
    const oldRhythm = new ContinuousRhythm(ctx, 0, {
      secondsPerBeat: 1, firstSide: -1, hangWeight: 0.5, tickSound: 'soft',
      tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200,
    }, v.leftDepth, v.rightDepth, silentTicks);
    oldRhythm.stop(3);
    new ContinuousRhythm(ctx, 3, {
      secondsPerBeat: 0.5, firstSide: 1, hangWeight: 0.5, tickSound: 'soft',
      tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200,
    }, v.leftDepth, v.rightDepth, silentTicks);
    const rendered = await ctx.startRendering();
    for (const [t, favored] of [[2, 0], [3, 1], [3.5, 0], [7.5, 0]]) {
      const start = Math.round(t * 48000);
      assert(rms(rendered.getChannelData(favored), start, start + 480) >
        8 * rms(rendered.getChannelData(1 - favored), start, start + 480), `Tempo/ear phase mismatch at ${t}s`);
    }
    report('Live tempo transition: old swing finishes, new tempo begins at the same ear/endpoint');
  }
  {
    const ctx = context(4);
    const v = voice(ctx);
    const pausePoint = ctx.suspend(1);
    const rendering = ctx.startRendering();
    await pausePoint;
    v.setFrequencies(240, 20);
    v.setVolume(0.4);
    await ctx.resume();
    const rendered = await rendering;
    assert(Math.abs(amplitude(rendered.getChannelData(0), 240, 48000) - 0.2) < 0.0001, 'Left retuning/volume failed');
    assert(Math.abs(amplitude(rendered.getChannelData(1), 260, 48000) - 0.2) < 0.0001, 'Right retuning/volume failed');
    report('Live retune and volume change: 240Hz left / 260Hz right at matched 0.2 amplitudes');
  }
  {
    const ctx = context(5);
    const gate = ctx.createGain(), master = ctx.createGain();
    master.connect(gate).connect(ctx.destination);
    const v = new BinauralVoice(ctx, master);
    v.start(200, 10, 1, 0);
    scheduleSessionGate(gate, 0, 2, 0.5);
    master.gain.setValueAtTime(0.8, 3); // A volume change must not unmute it.
    const rendered = await ctx.startRendering();
    assert(rms(rendered.getChannelData(0), 48000, 60000) > 0.3, 'Session silent before deadline');
    assert(rms(rendered.getChannelData(0), 2 * 48000, 5 * 48000) === 0, 'Finite session did not silence itself');
    report('Finite timer: native fade reaches exact silence without polling; later volume changes cannot undo it');
  }
  {
    const ctx = context(6, 16000);
    const dummyLeft = ctx.createGain(), dummyRight = ctx.createGain();
    const settings = {
      secondsPerBeat: 1, firstSide: -1 as const, hangWeight: 0.5, tickSound: 'soft' as const,
      tickEarMode: 'MATCH' as const, tickSubdivision: 'ENDS' as const, carrierHz: 200,
    };
    const oldRhythm = new ContinuousRhythm(ctx, 0, settings, dummyLeft, dummyRight, ctx.destination);
    oldRhythm.stop(3);
    const nextRhythm = new ContinuousRhythm(ctx, 3, { ...settings, firstSide: 1, secondsPerBeat: 0.5 },
      dummyLeft, dummyRight, ctx.destination);
    const pausePoint = ctx.suspend(2.5);
    const rendering = ctx.startRendering();
    await pausePoint;
    oldRhythm.stop(ctx.currentTime + 0.03);
    nextRhythm.stop(ctx.currentTime + 0.03);
    await ctx.resume();
    const rendered = await rendering;
    for (const channel of [0, 1]) {
      assert(rms(rendered.getChannelData(channel), 2.6 * 16000, 6 * 16000) === 0, 'Pending tempo loop restarted after pause');
    }
    report('Pause during a pending tempo transition: both old and future loops remain silent');
  }
  {
    const ctx = context(5, 16000);
    const dummyLeft = ctx.createGain(), dummyRight = ctx.createGain();
    const rhythm = new ContinuousRhythm(ctx, 0, {
      secondsPerBeat: 1, firstSide: -1, hangWeight: 0.5, tickSound: 'soft',
      tickEarMode: 'MATCH', tickSubdivision: 'ENDS', carrierHz: 200,
    }, dummyLeft, dummyRight, ctx.destination);
    const changePoint = ctx.suspend(0.37);
    const rendering = ctx.startRendering();
    await changePoint;
    rhythm.updateTicks({ tickSound: 'wood', tickSubdivision: 'CENTER' });
    await ctx.resume();
    const rendered = await rendering;
    for (const t of [1, 2, 3, 4]) {
      assert(rms(rendered.getChannelData(0), t * 16000, (t + 0.1) * 16000) === 0, 'Old end-tick pattern remained');
      assert(rms(rendered.getChannelData(0), (t + 0.5) * 16000, (t + 0.6) * 16000) > 0.01, 'Updated center tick lost phase');
    }
    report('Live tick timbre/pattern update keeps the original phase and removes the old pattern');
  }
  report('All checks complete');
}
document.querySelector('#run')!.addEventListener('click', () => {
  output.textContent = 'Rendering…';
  void run().catch(error => { output.textContent += `\nFAIL ${error.stack ?? error}`; });
});
