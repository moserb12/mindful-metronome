import { describe, expect, it } from 'vitest';
import { computeSessionPhase, computeSwingSegment, type SessionState, type SwingState } from './useMetronomeEngine';

// ============================================================================
// computeSwingSegment is the fix for a real bug: an earlier version only
// updated the swing's from/to boundaries when a beat was SCHEDULED (~100ms
// before it sounds), leaving the arm frozen at each extreme for most of a
// beat and then snapping to ~90% through its eased curve the instant the
// next segment arrived. This pure function instead derives the current
// segment from elapsed time against one fixed reference point, so these
// tests drive it directly with plain numbers — no scheduler, no timers.
// ============================================================================

describe('computeSwingSegment', () => {
  const ref: SwingState = { referenceTimeSec: 10, referenceSide: 'left', secondsPerBeat: 1 };

  it('is exactly at the reference side right at the reference time', () => {
    // The boundary instant itself is ambiguous between "the segment that
    // just ended here" and "the segment that starts here" — both are
    // equally valid, and it doesn't matter which one wins: fromSide is
    // referenceSide either way, and t=0 at this exact instant, so the
    // rendered angle always comes out to referenceSide's angle regardless.
    const seg = computeSwingSegment(10, ref);
    expect(seg.fromSide).toBe('left');
    expect(seg.fromTimeSec).toBe(10);
  });

  it('mid-way just before the reference is still heading toward the reference side', () => {
    const seg = computeSwingSegment(9.5, ref);
    expect(seg.fromSide).toBe('right');
    expect(seg.toSide).toBe('left');
    expect(seg.fromTimeSec).toBe(9);
    expect(seg.toTimeSec).toBe(10);
  });

  it('alternates to the opposite side for the segment right after the reference', () => {
    const seg = computeSwingSegment(10.5, ref);
    expect(seg.fromSide).toBe('left');
    expect(seg.toSide).toBe('right');
    expect(seg.fromTimeSec).toBe(10);
    expect(seg.toTimeSec).toBe(11);
  });

  it('returns to the reference side two segments later (a full alternation cycle)', () => {
    const seg = computeSwingSegment(11.5, ref);
    expect(seg.toSide).toBe('left');
    expect(seg.fromTimeSec).toBe(11);
    expect(seg.toTimeSec).toBe(12);
  });

  it('extrapolates correctly arbitrarily far into the future, no drift', () => {
    // Side alternates every segment with period 2, so 38 full beats after
    // the reference (an even segment count) arrives back at the reference
    // side — same parity as the very first segment.
    const seg = computeSwingSegment(10 + 37.5, ref);
    expect(seg.toSide).toBe('left');
    expect(seg.fromTimeSec).toBe(10 + 37);
    expect(seg.toTimeSec).toBe(10 + 38);
  });

  it('never leaves a gap or overlap between consecutive segments', () => {
    // Sample densely across several beats and confirm every segment's
    // fromTimeSec equals the previous segment's toTimeSec.
    let prevToTimeSec: number | null = null;
    for (let t = 8; t < 14; t += 0.05) {
      const seg = computeSwingSegment(t, ref);
      if (prevToTimeSec !== null && seg.toTimeSec !== prevToTimeSec) {
        expect(seg.fromTimeSec).toBe(prevToTimeSec);
      }
      prevToTimeSec = seg.toTimeSec;
    }
  });

  it('respects a different tempo baked into the reference', () => {
    const fastRef: SwingState = { referenceTimeSec: 0, referenceSide: 'right', secondsPerBeat: 0.5 };
    const seg = computeSwingSegment(0.75, fastRef);
    expect(seg.fromTimeSec).toBe(0.5);
    expect(seg.toTimeSec).toBe(1);
  });
});

// ============================================================================
// computeSessionPhase — same "derive current state from elapsed time
// against one fixed reference" model as computeSwingSegment above, applied
// to a timed session's active/fading/ended lifecycle. Session:
// startTimeSec=100, durationSec=600 (10 min), fadeDurationSec=8, so the
// fade window is [692, 700) and 'ended' begins exactly at t=700.
// ============================================================================

describe('computeSessionPhase', () => {
  const session: SessionState = { startTimeSec: 100, durationSec: 600, fadeDurationSec: 8 };

  it('is active well before the fade window', () => {
    const p = computeSessionPhase(400, session);
    expect(p.phase).toBe('active');
    expect(p.remainingSec).toBe(300);
  });

  it('is still active one second before the fade window opens', () => {
    const p = computeSessionPhase(691, session);
    expect(p.phase).toBe('active');
  });

  it('switches to fading exactly at the fade window boundary', () => {
    const p = computeSessionPhase(692, session);
    expect(p.phase).toBe('fading');
    expect(p.remainingSec).toBe(8);
  });

  it('reports decreasing remainingSec partway through the fade', () => {
    const p = computeSessionPhase(696, session);
    expect(p.phase).toBe('fading');
    expect(p.remainingSec).toBe(4);
  });

  it('is still fading one instant before the total duration elapses', () => {
    const p = computeSessionPhase(699.9, session);
    expect(p.phase).toBe('fading');
  });

  it('switches to ended exactly at the requested total duration', () => {
    const p = computeSessionPhase(700, session);
    expect(p.phase).toBe('ended');
    expect(p.remainingSec).toBe(0);
  });

  it('stays ended (never goes negative) arbitrarily far past the end', () => {
    const p = computeSessionPhase(5000, session);
    expect(p.phase).toBe('ended');
    expect(p.remainingSec).toBe(0);
  });

  it('is active at the exact start instant', () => {
    const p = computeSessionPhase(100, session);
    expect(p.phase).toBe('active');
    expect(p.remainingSec).toBe(600);
  });

  it('handles a fade window as long as the whole session without going negative', () => {
    const wholeSessionIsFade: SessionState = { startTimeSec: 0, durationSec: 5, fadeDurationSec: 5 };
    expect(computeSessionPhase(0, wholeSessionIsFade).phase).toBe('fading');
    expect(computeSessionPhase(5, wholeSessionIsFade).phase).toBe('ended');
  });
});
