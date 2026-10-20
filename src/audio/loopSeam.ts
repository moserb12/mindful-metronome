/** Overlap the end with the beginning, avoiding an artificial waveform
 * jump at a noise loop boundary. Equal-power fades preserve noise energy.
 * This fixes the encoded seam, not browser-specific media-loop gaps. */
export function crossfadeLoop(samples: Float32Array, overlapSamples: number): Float32Array {
  const overlap = Math.min(Math.max(2, Math.round(overlapSamples)), Math.floor(samples.length / 2));
  if (overlap < 2) return samples.slice();
  const result = samples.slice(0, samples.length - overlap);
  for (let i = 0; i < overlap; i++) {
    const angle = (i / (overlap - 1)) * Math.PI / 2;
    result[i] = samples[result.length + i] * Math.cos(angle) + samples[i] * Math.sin(angle);
  }
  return result;
}
