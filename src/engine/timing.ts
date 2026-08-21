// ============================================================================
// Precision timing engine — Web Audio lookahead scheduler + time-domain sync.
// Ported from Brain Bridging Beats' proven scheduling math, which is
// product-agnostic: it just schedules evenly-spaced beats against the audio
// hardware clock, with no knowledge of what plays on each beat.
//
// Why not `setInterval(tick, msPerBeat)`? Because setTimeout/setInterval are
// only accurate to a few ms at best and DRIFT over time (the browser can
// delay a timer under any load, and delays accumulate). Instead, this
// scheduler wakes up frequently and looks a short distance ahead, scheduling
// actual playback via `AudioContext.currentTime` — the audio hardware clock,
// which does not drift.
// ============================================================================

/** Converts performance.now() timestamps into the AudioContext.currentTime
 * domain (seconds), using a single fixed origin pair captured at
 * construction time. Construct exactly one of these per AudioContext. */
export class TimeDomainSync {
  private readonly perfOriginMs: number;
  private readonly audioOriginSec: number;

  constructor(audioContextCurrentTimeSec: number, performanceNowMs: number = performance.now()) {
    this.perfOriginMs = performanceNowMs;
    this.audioOriginSec = audioContextCurrentTimeSec;
  }

  /** Convert a performance.now() millisecond timestamp into AudioContext
   * time (seconds). */
  toAudioTimeSeconds(performanceNowMs: number): number {
    return this.audioOriginSec + (performanceNowMs - this.perfOriginMs) / 1000;
  }
}

export interface ScheduledBeat {
  /** 0-based index of this beat since the scheduler started. */
  beatIndex: number;
  /** AudioContext.currentTime (seconds) this beat is scheduled to sound at. */
  timeSec: number;
}

/** How often the lookahead timer fires. */
export const SCHEDULER_TICK_MS = 25;
/** Default distance ahead of "now" that beats get scheduled — plenty of
 * runway to hand a tone to the audio hardware on time, and to let a visual
 * (like the metronome arm) know a beat is coming before it happens. */
export const LOOKAHEAD_WINDOW_SEC = 0.1;

/**
 * A Web Audio lookahead beat scheduler. Wakes up every `SCHEDULER_TICK_MS`
 * and schedules any beat that falls within `lookaheadSec` of "now" via
 * `AudioContext.currentTime`.
 *
 * Testable: takes a plain `getCurrentTimeSec` function rather than a full
 * AudioContext, and exposes `tick()` as a public method, so tests can drive
 * it with a fake clock instead of real audio hardware or real timers.
 */
export class BeatScheduler {
  private nextBeatIndex = 0;
  private nextBeatTimeSec = 0;
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  private getCurrentTimeSec: () => number;
  private bpm: number;
  private onBeatScheduled: (beat: ScheduledBeat) => void;
  private lookaheadSec: number;

  constructor(
    getCurrentTimeSec: () => number,
    bpm: number,
    onBeatScheduled: (beat: ScheduledBeat) => void,
    lookaheadSec: number = LOOKAHEAD_WINDOW_SEC
  ) {
    this.getCurrentTimeSec = getCurrentTimeSec;
    this.bpm = bpm;
    this.onBeatScheduled = onBeatScheduled;
    this.lookaheadSec = lookaheadSec;
  }

  /** Change the tempo. Takes effect on the NEXT beat scheduled after the
   * call — beats already scheduled keep their original spacing. */
  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  private get secondsPerBeat(): number {
    return 60 / this.bpm;
  }

  /** Begin scheduling beats starting at `startTimeSec` (defaults to "soon",
   * a small buffer after now so the very first beat has time to actually
   * get scheduled before it's due). */
  start(startTimeSec: number = this.getCurrentTimeSec() + 0.1): void {
    this.nextBeatTimeSec = startTimeSec;
    this.nextBeatIndex = 0;
    this.running = true;
    this.tick(); // schedule anything already due immediately, don't wait
    this.intervalHandle = setInterval(() => this.tick(), SCHEDULER_TICK_MS);
  }

  stop(): void {
    this.running = false;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Schedule every beat that falls within the lookahead window from "now".
   * Public so tests can call it directly against a fake clock. */
  tick(): void {
    if (!this.running) return;
    const horizon = this.getCurrentTimeSec() + this.lookaheadSec;
    while (this.nextBeatTimeSec <= horizon) {
      this.onBeatScheduled({ beatIndex: this.nextBeatIndex, timeSec: this.nextBeatTimeSec });
      this.nextBeatIndex += 1;
      this.nextBeatTimeSec += this.secondsPerBeat;
    }
  }
}
