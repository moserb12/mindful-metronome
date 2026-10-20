/** Conservative peak budget: independent drone, tick, PCM noise, and
 * simultaneous closing (3 x .35) + interval (.28) chimes. One common trim
 * preserves relative ear/layer levels without a compressor pumping tones. */
export function mixHeadroom(drone: number, tick: number, noise: number): number {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return 0.95 / (clamp(drone) + 1.2 * clamp(tick) + clamp(noise) + 1.35);
}
