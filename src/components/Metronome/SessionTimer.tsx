import type { SessionPlaybackPhase } from '../../hooks/useMetronomeEngine';

const DURATION_OPTIONS: { minutes: number | null; label: string }[] = [
  { minutes: 10, label: '10 min' },
  { minutes: 20, label: '20 min' },
  { minutes: 30, label: '30 min' },
  { minutes: null, label: 'Open-ended' },
];

function formatCountdown(remainingSec: number): string {
  const total = Math.max(0, Math.round(remainingSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Only covers the three phases a session actually passes through — the
 * hook-level `'idle'` phase (not playing, OR playing but Open-ended) needs
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
 * §2/§7 timed sessions — a duration picker plus a live countdown, replacing
 * the previous static "being built next" placeholder. This does NOT start
 * playback itself: picking a duration just arms what happens the next time
 * the single Begin/Pause button up in the metronome stage is pressed (or,
 * if already playing, re-arms the countdown immediately from now — see
 * setSessionDurationMinutes()'s doc comment in useMetronomeEngine.ts). One
 * play control for the whole app, not a second competing one here.
 *
 * The countdown block's visibility is driven by `sessionPhase !== 'idle'`,
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
      ? 'Playing — Open-ended, so it’ll keep going until you press Pause.'
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
        <div className={`session-countdown session-countdown-${sessionPhase}`}>
          <span className="session-countdown-time">{formatCountdown(sessionRemainingSec ?? 0)}</span>
          <span className="session-countdown-label">{message}</span>
        </div>
      ) : (
        <p className="control-hint">{message}</p>
      )}
    </div>
  );
}
