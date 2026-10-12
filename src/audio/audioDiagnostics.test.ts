import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIO_DIAGNOSTICS_STORAGE_KEY,
  readAudioDiagnostics,
  recordAudioDiagnostic,
} from './audioDiagnostics';

describe('audio diagnostics', () => {
  beforeEach(() => window.localStorage.clear());

  it('stores lifecycle evidence locally in chronological order', () => {
    recordAudioDiagnostic('playback-start', { hidden: false });
    recordAudioDiagnostic('document-freeze', { hidden: true });

    expect(readAudioDiagnostics().map((entry) => entry.event)).toEqual([
      'playback-start',
      'document-freeze',
    ]);
  });

  it('caps the rolling log at 80 entries', () => {
    for (let i = 0; i < 90; i++) recordAudioDiagnostic(`event-${i}`);

    const entries = readAudioDiagnostics();
    expect(entries).toHaveLength(80);
    expect(entries[0].event).toBe('event-10');
    expect(entries[entries.length - 1]?.event).toBe('event-89');
  });

  it('treats corrupted storage as an empty log', () => {
    window.localStorage.setItem(AUDIO_DIAGNOSTICS_STORAGE_KEY, '{not-json');
    expect(readAudioDiagnostics()).toEqual([]);
  });
});
