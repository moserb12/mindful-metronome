/** Arm silence on the audio clock, even if the page never polls again.
 * A dedicated gate keeps volume changes from overwriting the deadline. */
export function scheduleSessionGate(gate: GainNode, now: number, duration: number, fade: number): number {
  const end = now + duration;
  const fadeAt = Math.max(now, end - fade);
  gate.gain.cancelScheduledValues(now);
  gate.gain.setValueAtTime(1, now);
  gate.gain.setValueAtTime(1, fadeAt);
  gate.gain.linearRampToValueAtTime(0, end);
  return fadeAt;
}
