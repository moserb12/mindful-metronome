// Lift the continuous tones above the tick/noise layers. The common trim
// below includes this boost, preserving the ear ratio without clipping.
export const DRONE_MIX_GAIN = 4;

// Tick transients are brief and share the drone's frequency in Soft pulse.
// Give their slider more useful range without touching the saved 0..1 value.
export const TICK_MIX_GAIN = 6;
const TICK_BASE_GAIN = 3;
const TICK_SOURCE_PEAK_LIMIT = 0.8;

export function tickMixerGain(volume: number): number {
  const position = Math.max(0, Math.min(1, volume));
  // Keep the familiar lower half (including the default 50% level), then
  // smoothly add more range up to twice the previous maximum source gain.
  const upperHalf = Math.max(0, position * 2 - 1);
  return position * TICK_BASE_GAIN + (TICK_MIX_GAIN - TICK_BASE_GAIN) * upperHalf ** 2;
}

/** Conservative peak budget: independent drone, tick, PCM noise, and
 * simultaneous closing (3 x .35) + interval (.28) chimes. One common trim
 * preserves relative ear/layer levels without a compressor pumping tones. */
export function mixHeadroom(drone: number, tick: number, noise: number): number {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return 0.95 / (DRONE_MIX_GAIN * clamp(drone) + TICK_SOURCE_PEAK_LIMIT * tickMixerGain(tick) + clamp(noise) + 1.35);
}
