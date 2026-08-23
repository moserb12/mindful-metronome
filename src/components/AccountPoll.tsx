import { useAccountPoll } from '../hooks/useAccountPoll';

/**
 * A one-question footer poll asking whether this app should ever grow
 * account creation / cross-device progress sync — genuinely asked, not
 * rhetorical. See useAccountPoll.ts for how the shared tally works (a free
 * public counter API, since this whole app has no backend of its own) and
 * its trade-offs.
 *
 * Results are shown live, before AND after voting (not hidden until you
 * vote) — the ask was "everyone sees the results of the current voting,"
 * read here as "always visible," not "revealed only as a reward for
 * voting." Voting itself is a one-time thing per browser, enforced by a
 * plain localStorage flag; the vote buttons become disabled (not hidden)
 * once cast, with the chosen one highlighted, so a listener can still see
 * exactly what they picked.
 */
export function AccountPoll() {
  const { phase, counts, votedChoice, voteError, vote } = useAccountPoll();

  if (phase === 'error') {
    return (
      <section className="focus-card account-poll" aria-label="Site poll">
        <span className="control-label">One quick question</span>
        <p className="control-hint">Couldn't reach the vote tally just now — try reloading in a bit.</p>
      </section>
    );
  }

  const loading = phase === 'loading';
  const total = counts.yes + counts.no;
  const yesPct = total > 0 ? Math.round((counts.yes / total) * 100) : 0;
  const noPct = total > 0 ? 100 - yesPct : 0;

  return (
    <section className="focus-card account-poll" aria-label="Site poll">
      <span className="control-label">One quick question</span>
      <p className="poll-question">
        Should I add account creation so you can log in on multiple devices and have progress sync?
      </p>

      <div className="poll-options">
        <button
          type="button"
          className={`poll-vote-btn poll-vote-yes ${votedChoice === 'yes' ? 'selected' : ''}`}
          onClick={() => vote('yes')}
          disabled={loading || votedChoice !== null}
        >
          Yes! To the CLOUDS! ☁️
        </button>
        <button
          type="button"
          className={`poll-vote-btn poll-vote-no ${votedChoice === 'no' ? 'selected' : ''}`}
          onClick={() => vote('no')}
          disabled={loading || votedChoice !== null}
        >
          No. Keep it local.
        </button>
      </div>

      {!loading && (
        <div className="poll-results" aria-live="polite">
          <div className="poll-result-row">
            <span className="poll-result-label">Yes! To the CLOUDS! ☁️</span>
            <div className="band-duration-track poll-result-track">
              <div className="band-duration-fill poll-result-fill-yes" style={{ width: `${yesPct}%` }} />
            </div>
            <span className="poll-result-value">
              {yesPct}% · {counts.yes}
            </span>
          </div>
          <div className="poll-result-row">
            <span className="poll-result-label">No. Keep it local.</span>
            <div className="band-duration-track poll-result-track">
              <div className="band-duration-fill poll-result-fill-no" style={{ width: `${noPct}%` }} />
            </div>
            <span className="poll-result-value">
              {noPct}% · {counts.no}
            </span>
          </div>
        </div>
      )}

      {votedChoice && <p className="control-hint">Thanks for voting — every visitor gets exactly one.</p>}
      {voteError && <p className="control-hint">That vote didn't go through — try again in a moment.</p>}
    </section>
  );
}
