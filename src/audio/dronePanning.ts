export interface DroneEarGains {
  left: number;
  right: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert the stored modulation depth into the label listeners use for the
 * two ear levels. A depth of 0.8 is displayed as 90/10.
 */
export function formatPanSplit(depth: number): string {
  const clampedDepth = clamp(depth, 0, 1);
  const favoredPercent = Math.round((0.5 + 0.5 * clampedDepth) * 100);
  return `${favoredPercent}/${100 - favoredPercent}`;
}

/**
 * Calculate the independent gain for the two permanently separated drone
 * tones. A depth of 0.8 is labelled 90/10 and produces a 0.9/0.1 split at
 * the extremes. The two gains always sum to the selected drone volume, so
 * the stereo motion delivers each frequency independently. Constant-sum
 * amplitude is the existing balance law, not constant acoustic power or a
 * guarantee of constant perceived loudness.
 */
export function computeDroneEarGains(panValue: number, depth: number, droneVolume: number): DroneEarGains {
  const pan = clamp(panValue, -1, 1);
  const clampedDepth = clamp(depth, 0, 1);
  const volume = clamp(droneVolume, 0, 1);
  const rightShare = 0.5 + 0.5 * clampedDepth * pan;

  return {
    left: volume * (1 - rightShare),
    right: volume * rightShare,
  };
}
