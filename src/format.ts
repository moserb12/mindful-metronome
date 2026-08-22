/** Formats a countdown in whole seconds as `m:ss`. Shared by
 * SessionTimer.tsx's status line and MetronomeVisual.tsx's in-eye clock
 * numeral — one implementation, not two copies drifting apart. */
export function formatCountdown(remainingSec: number): string {
  const total = Math.max(0, Math.round(remainingSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
