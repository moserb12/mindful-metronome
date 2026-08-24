import { useEffect, useState } from 'react';

// ============================================================================
// A tiny footer poll — "should this app add account sync?" — backed by a
// free, anonymous, no-auth public counter API (abacus.jasoncameron.dev),
// since this whole app is otherwise a pure static site with no backend of
// its own. Two plain incrementing counters, one per answer; "have I already
// voted" is the ONLY thing persisted locally (a plain localStorage flag —
// nothing about the vote is tied to any identity), matching this app's
// honor-system, no-login philosophy everywhere else.
//
// Deliberate limitation, accepted going in (see the poll status update in
// CLAUDE.md): a public no-auth counter has no real anti-tamper protection —
// someone determined could inflate a count directly, or vote again from a
// different browser/after clearing storage. That trade-off was made
// explicitly in exchange for shipping a real, live-shared tally without
// standing up any backend infrastructure of its own.
// ============================================================================

const NAMESPACE = 'mindful-metronome-app';
const KEY_YES = 'account-poll-cloud-yes';
const KEY_NO = 'account-poll-cloud-no';
const BASE_URL = 'https://abacus.jasoncameron.dev';
const STORAGE_KEY = 'mindful-metronome:account-poll-vote:v1';

export type PollChoice = 'yes' | 'no';

interface PollCounts {
  yes: number;
  no: number;
}

type PollPhase = 'loading' | 'ready' | 'error';

function readStoredVote(): PollChoice | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'yes' || raw === 'no' ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredVote(choice: PollChoice): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage disabled/private mode — the vote itself already landed on the
    // shared counter; only the "don't ask again" memory is lost, same
    // graceful degradation as every other localStorage write in this app.
  }
}

async function readCounterValue(res: Response): Promise<number> {
  // abacus 404s a "get" on a key that has never been hit yet, rather than
  // returning {value: 0} — a completely normal state for one side of a
  // brand-new poll (e.g. nobody has voted "no" yet). Treating that as
  // "zero votes so far" instead of a hard failure is what makes the poll
  // actually load; the previous version threw on ANY non-ok status,
  // including this expected one, which put the whole poll into its
  // "couldn't reach the vote tally" error state every time either counter
  // hadn't been hit even once.
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`poll request failed: ${res.status}`);
  const data: unknown = await res.json();
  const value = (data as { value?: unknown } | null)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Non-incrementing read — used on load to show the current tally without
 * counting the page view itself as a vote. */
function fetchCount(key: string): Promise<number> {
  return fetch(`${BASE_URL}/get/${NAMESPACE}/${key}`).then(readCounterValue);
}

/** Increments and returns the new total in one round trip. */
function hitCount(key: string): Promise<number> {
  return fetch(`${BASE_URL}/hit/${NAMESPACE}/${key}`).then(readCounterValue);
}

export function useAccountPoll() {
  const [phase, setPhase] = useState<PollPhase>('loading');
  const [counts, setCounts] = useState<PollCounts>({ yes: 0, no: 0 });
  const [votedChoice, setVotedChoice] = useState<PollChoice | null>(readStoredVote);
  const [voteError, setVoteError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCount(KEY_YES), fetchCount(KEY_NO)])
      .then(([yes, no]) => {
        if (cancelled) return;
        setCounts({ yes, no });
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-checks `votedChoice` at call time (not just via the disabled button
   * state) so a stray double-fire can't double-count — same "don't trust
   * the UI alone" caution useFocusStats' setSelectedMedallionId already
   * applies to its own writes. */
  async function vote(choice: PollChoice) {
    if (votedChoice) return;
    setVoteError(false);
    try {
      const newValue = await hitCount(choice === 'yes' ? KEY_YES : KEY_NO);
      setCounts((current) => ({ ...current, [choice]: newValue }));
      setVotedChoice(choice);
      writeStoredVote(choice);
    } catch {
      setVoteError(true);
    }
  }

  return { phase, counts, votedChoice, voteError, vote };
}
