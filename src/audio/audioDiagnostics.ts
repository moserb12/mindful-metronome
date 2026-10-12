export const AUDIO_DIAGNOSTICS_STORAGE_KEY = 'mindful-metronome:audio-diagnostics:v1';

const MAX_DIAGNOSTIC_ENTRIES = 80;

export interface AudioDiagnosticEntry {
  at: string;
  event: string;
  details?: Record<string, string | number | boolean | null>;
}

/**
 * Keeps a small, local-only rolling log of audio and page-lifecycle events.
 * Overnight failures are otherwise almost impossible to diagnose after the
 * phone wakes back up. Nothing is transmitted; the log stays in this
 * browser's localStorage and is capped so it cannot grow without bound.
 */
export function recordAudioDiagnostic(
  event: string,
  details?: AudioDiagnosticEntry['details']
): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(AUDIO_DIAGNOSTICS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const entries: AudioDiagnosticEntry[] = Array.isArray(parsed) ? parsed : [];
    entries.push({ at: new Date().toISOString(), event, details });
    window.localStorage.setItem(
      AUDIO_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_DIAGNOSTIC_ENTRIES))
    );
  } catch {
    // Diagnostics must never be able to interrupt playback. Storage can be
    // unavailable in private mode or after the user clears site data.
  }
}

export function readAudioDiagnostics(): AudioDiagnosticEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(AUDIO_DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
