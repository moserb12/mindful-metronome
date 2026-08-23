import { formatCountdown } from '../../format';
import type { SessionPlaybackPhase } from '../../hooks/useMetronomeEngine';

const DURATION_OPTIONS: { minutes: number | null; label: string; ariaLabel?: string }[] = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '60 min' },
  // A symbol reads cleaner as a chip label than the word "Infinite" —
  // ariaLabel keeps it announced clearly for screen readers.
  { minutes: null, label: '∞', ariaLabel: 'Infinite' },
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
  sessionRemainingSec: number | null;
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
 * The numeric mm:ss countdown lives here again — an earlier pass moved it
 * into the eye itself as a fill-wedge/numeral, but that iris-timer ring
 * was removed per the builder's ask, so this is once again the only place
 * a listener can see exactly how much session time is left.
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
  sessionRemainingSec,
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
  const showCountdown = inSession && sessionPhase !== 'ended' && sessionRemainingSec !== null;

  return (
    <div className="session-timer">
      <div className="duration-row" style={{ '--chip-color': chipColor } as React.CSSProperties}>
        {DURATION_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`preset-chip duration-chip ${sessionDurationMinutes === opt.minutes ? 'active' : ''}`}
            onClick={() => onSetSessionDurationMinutes(opt.minutes)}
            aria-label={opt.ariaLabel ?? opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {showCountdown && <p className="session-countdown">{formatCountdown(sessionRemainingSec)}</p>}

      {inSession ? (
        <p className={`session-status session-status-${sessionPhase}`}>{message}</p>
      ) : (
        <p className="control-hint">{message}</p>
      )}
    </div>
  );
}
