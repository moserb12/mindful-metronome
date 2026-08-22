import type { SessionPlaybackPhase } from '../../hooks/useMetronomeEngine';

const DURATION_OPTIONS: { minutes: number | null; label: string }[] = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '60 min' },
  { minutes: null, label: 'Infinite' },
];

/** Only covers the three phases a session actually passes through — the
 * hook-level `'idle'` phase (not playing, OR playing but Infinite) needs
 * two DIFFERENT messages depending on isPlaying, so it's handled directly
 * below rather than folded into this table. */
const IN_SESSION_MESSAGE: Record<Exclude<SessionPlaybackPhase, 'idle'>, string> = {
  active: 'In progress — the sound will fade gracefully when your time is up.',
  fading: 'Winding down…',
  ended: 'Session complete.',
};

interface SessionTimerProps {
  sessionDurationMinutes: number | null;
  sessionPhase: SessionPlaybackPhase;
  isPlaying: boolean;
  onSetSessionDurationMinutes: (minutes: number | null) => void;
  chipColor: string;
}

/**
 * A duration picker plus a short status line — sits directly below the
 * main Play/Pause button, always visible (not hidden behind an
 * accordion). This does NOT start playback itself: picking a duration
 * just arms what happens the next time the single Begin/Pause button up
 * in the metronome stage is pressed (or, if already playing, re-arms the
 * countdown immediately from now — see setSessionDurationMinutes()'s doc
 * comment in useMetronomeEngine.ts). One play control for the whole app,
 * not a second competing one here.
 *
 * The big numeric countdown used to live here too — it now lives INSIDE
 * the eye itself (MetronomeVisual.tsx's clock face), so this component
 * only needs the chips plus a short status line.
 *
 * Visibility of the status line is driven by `sessionPhase !== 'idle'`,
 * NOT by `isPlaying` — a natural session end sets `isPlaying` back to
 * false the same instant `sessionPhase` becomes `'ended'` (see
 * stopPlaybackInternal() in useMetronomeEngine.ts), so gating on isPlaying
 * would hide the "Session complete" message during exactly the few seconds
 * it's meant to be shown.
 */
export function SessionTimer({
  sessionDurationMinutes,
  sessionPhase,
  isPlaying,
  onSetSessionDurationMinutes,
  chipColor,
}: SessionTimerProps) {
  const inSession = sessionPhase !== 'idle';
  const message = inSession
    ? IN_SESSION_MESSAGE[sessionPhase]
    : isPlaying
      ? 'Playing — Infinite, so it’ll keep going until you press Pause.'
      : 'Choose how long you’d like to focus, then press Begin above to start.';

  return (
    <div className="session-timer">
      <div className="duration-row" style={{ '--chip-color': chipColor } as React.CSSProperties}>
        {DURATION_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`preset-chip duration-chip ${sessionDurationMinutes === opt.minutes ? 'active' : ''}`}
            onClick={() => onSetSessionDurationMinutes(opt.minutes)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {inSession ? (
        <p className={`session-status session-status-${sessionPhase}`}>{message}</p>
      ) : (
        <p className="control-hint">{message}</p>
      )}
    </div>
  );
}
