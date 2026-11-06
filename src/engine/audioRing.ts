/** Follow audio energy rather than averaging signed samples across frames:
 * opposite waveform phases should not cancel the ring's visible response.
 * The soft response curve reveals quiet audio and stays bounded for boosts. */
export function updateAudioRingLevels(samples: Float32Array, levels: Float32Array, elapsedSec: number): void {
  if (samples.length === 0 || levels.length === 0) return;
  const dt = Math.max(0, elapsedSec);
  for (let point = 0; point < levels.length; point++) {
    const start = Math.floor(point * samples.length / levels.length);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((point + 1) * samples.length / levels.length)));
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / (end - start));
    const target = 1 - Math.exp(-6 * rms);
    const timeConstant = target > levels[point] ? 0.035 : 0.18;
    levels[point] += (target - levels[point]) * (1 - Math.exp(-dt / timeConstant));
  }
}
