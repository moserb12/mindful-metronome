// Tick transients are brief and share the drone's frequency in Soft pulse.
// Give their slider more useful range without touching the saved 0..1 value.
export const TICK_MIX_GAIN = 3;
const TICK_SOURCE_PEAK_LIMIT = 0.8;

export function tickMixerGain(volume: number): number {
  return Math.max(0, Math.min(1, volume)) * TICK_MIX_GAIN;
}

/** Conservative peak budget: independent drone, tick, PCM noise, and
 * simultaneous closing (3 x .35) + interval (.28) chimes. One common trim
 * preserves relative ear/layer levels without a compressor pumping tones. */
export function mixHeadroom(drone: number, tick: number, noise: number): number {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return 0.95 / (clamp(drone) + TICK_SOURCE_PEAK_LIMIT * tickMixerGain(tick) + clamp(noise) + 1.35);
}
