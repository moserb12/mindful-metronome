export const AUDIO_RING_BASE_RADIUS = 0.34;
// A little more travel, with enough clearance to keep peaks inside the canvas.
export const AUDIO_RING_MAX_DISTORTION = 0.12;
export const AUDIO_RING_SECTIONS = 3;

/** Three broad, identical waves; the troughs pull inward as the peaks
 * expand. Audio controls their depth, so silence remains a plain circle. */
export function audioRingOffset(angle: number, level: number): number {
  const strength = Math.max(0, Math.min(1, level));
  return AUDIO_RING_MAX_DISTORTION * strength * (0.25 + 0.75 * Math.cos(AUDIO_RING_SECTIONS * angle));
}

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
    let peak = 0;
    for (let i = start; i < end; i++) {
      energy += samples[i] * samples[i];
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    const rms = Math.sqrt(energy / (end - start));
    // Peak weighting catches short ticks. This soft knee stays sensitive
    // to quiet audio without saturating as quickly on louder tones.
    const intensity = rms * 0.75 + peak * 0.25;
    const target = intensity / (intensity + 0.15);
    const timeConstant = target > levels[point] ? 0.025 : 0.18;
    levels[point] += (target - levels[point]) * (1 - Math.exp(-dt / timeConstant));
  }
}
