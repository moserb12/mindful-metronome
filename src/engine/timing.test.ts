import { describe, expect, it } from 'vitest';
import { BeatScheduler, TimeDomainSync, LOOKAHEAD_WINDOW_SEC } from './timing';

describe('TimeDomainSync', () => {
  it('converts a performance.now() timestamp taken at the sync origin to the audio origin time', () => {
    const sync = new TimeDomainSync(/* audioContext.currentTime */ 5, /* performance.now() */ 1000);
    expect(sync.toAudioTimeSeconds(1000)).toBe(5);
  });

  it('converts a later performance.now() timestamp proportionally', () => {
    const sync = new TimeDomainSync(5, 1000);
    // 500ms later on the performance clock => 0.5s later in audio time
    expect(sync.toAudioTimeSeconds(1500)).toBe(5.5);
  });

  it('handles a performance.now() timestamp before the origin (small negative drift)', () => {
    const sync = new TimeDomainSync(5, 1000);
    expect(sync.toAudioTimeSeconds(900)).toBeCloseTo(4.9, 10);
  });
});

describe('BeatScheduler (driven by a fake clock, no real timers)', () => {
  it('schedules beats only once they fall within the lookahead window', () => {
    let fakeNow = 0;
    const scheduled: number[] = [];
    const scheduler = new BeatScheduler(() => fakeNow, 60 /* 1 beat/sec */, (beat) => {
      scheduled.push(beat.timeSec);
    });

    scheduler.start(0.1);
    expect(scheduled).toEqual([0.1]);

    fakeNow = 1.0 - LOOKAHEAD_WINDOW_SEC - 0.01;
    scheduler.tick();
    expect(scheduled).toEqual([0.1]);

    fakeNow = 1.0;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1]);

    scheduler.stop();
  });

  it('schedules multiple beats in one tick if the clock jumps forward a lot', () => {
    let fakeNow = 0;
    const scheduled: number[] = [];
    const scheduler = new BeatScheduler(() => fakeNow, 60, (beat) => scheduled.push(beat.timeSec));

    scheduler.start(0.1);
    expect(scheduled).toEqual([0.1]);

    fakeNow = 3.05;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1, 2.1, 3.1]);

    scheduler.stop();
  });

  it('setLookaheadSec only affects beats not yet scheduled', () => {
    let fakeNow = 0;
    const scheduled: number[] = [];
    const scheduler = new BeatScheduler(() => fakeNow, 60, (beat) => scheduled.push(beat.timeSec));

    scheduler.start(0.1); // default 0.1s lookahead
    expect(scheduled).toEqual([0.1]);

    // Widen the lookahead (simulating a tab going into the background) —
    // the next tick() call schedules everything newly within reach, in
    // one burst, same as the "clock jumps forward" case above.
    scheduler.setLookaheadSec(3);
    fakeNow = 0.2;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1, 2.1, 3.1]);

    // Narrow it back down — already-scheduled beats (1.1/2.1/3.1) stay
    // scheduled regardless; only the NEXT not-yet-due beat (4.1) is
    // affected, and it isn't scheduled until it's actually within 0.1s.
    scheduler.setLookaheadSec(0.1);
    fakeNow = 3.95;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1, 2.1, 3.1]);

    fakeNow = 4.0;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1, 2.1, 3.1, 4.1]);

    scheduler.stop();
  });

  it('setBpm changes the tempo for a fresh phase started after stop()', () => {
    let fakeNow = 0;
    const scheduled: number[] = [];
    const scheduler = new BeatScheduler(() => fakeNow, 60 /* 1s/beat */, (beat) => scheduled.push(beat.timeSec));

    scheduler.start(0.1);
    fakeNow = 1.05;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1]);
    scheduler.stop();

    scheduler.setBpm(120); // 0.5s/beat for the new phase
    fakeNow = 2.0;
    scheduler.start(2.1); // phase 2 starts its own beat count from index 0
    expect(scheduled).toEqual([0.1, 1.1, 2.1]);

    fakeNow = 2.6;
    scheduler.tick();
    expect(scheduled).toEqual([0.1, 1.1, 2.1, 2.6]);

    scheduler.stop();
  });
});
