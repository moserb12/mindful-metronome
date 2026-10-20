// The mixer sliders store 0..1 positions. Match the signals at their source
// so a position has comparable meaning without changing saved settings.
const NOISE_RMS = 0.20;
const NOISE_PEAK_LIMIT = 0.95;
const TICK_WINDOW_SEC = 0.12;
const TICK_WINDOW_RMS = 0.13;
const TICK_PEAK_LIMIT = 0.80;

export function calibrateNoiseBuffer(buffer: AudioBuffer): AudioBuffer {
  const samples = buffer.getChannelData(0);
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms === 0 || peak === 0) return buffer;

  const gain = Math.min(NOISE_RMS / rms, NOISE_PEAK_LIMIT / peak);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return buffer;
}

/** Calibrate the audible tick's first 120ms, using combined stereo energy.
 * Center-only ticks keep their intentionally softer 0.55 accent scale. */
export function calibrateTickBuffer(buffer: AudioBuffer, centerOnly: boolean): AudioBuffer {
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const start = centerOnly ? Math.round(buffer.length / 4) : 0;
  const count = Math.min(Math.round(TICK_WINDOW_SEC * buffer.sampleRate), buffer.length - start);
  let sumSquares = 0;
  let peak = 0;
  for (let i = start; i < start + count; i++) {
    const energy = left[i] * left[i] + right[i] * right[i];
    sumSquares += energy;
    peak = Math.max(peak, Math.sqrt(energy));
  }
  const accentScale = centerOnly ? 0.55 : 1;
  const rms = Math.sqrt(sumSquares / count) / accentScale;
  peak /= accentScale;
  if (rms === 0 || peak === 0) return buffer;

  const gain = Math.min(TICK_WINDOW_RMS / rms, TICK_PEAK_LIMIT / peak);
  for (let i = 0; i < buffer.length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
  return buffer;
}
