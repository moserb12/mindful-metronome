import { describe, expect, it } from 'vitest';
import { ScheduledAudioSourceRegistry, type ScheduledAudioSourceLike } from './scheduledAudioSources';

class FakeScheduledSource implements ScheduledAudioSourceLike {
  stopCalls: number[] = [];
  private endedListener: (() => void) | null = null;

  addEventListener(_type: 'ended', listener: () => void): void {
    this.endedListener = listener;
  }

  stop(when = 0): void {
    this.stopCalls.push(when);
  }

  finish(): void {
    this.endedListener?.();
  }
}

describe('ScheduledAudioSourceRegistry', () => {
  it('cancels every source already scheduled into the audio graph', () => {
    const registry = new ScheduledAudioSourceRegistry<FakeScheduledSource>();
    const sources = [new FakeScheduledSource(), new FakeScheduledSource(), new FakeScheduledSource()];
    sources.forEach((source) => registry.track(source));

    expect(registry.cancelAll(12.25)).toBe(3);
    expect(sources.map((source) => source.stopCalls)).toEqual([[12.25], [12.25], [12.25]]);
    expect(registry.size).toBe(0);
  });

  it('removes sources that ended naturally before Pause', () => {
    const registry = new ScheduledAudioSourceRegistry<FakeScheduledSource>();
    const finished = new FakeScheduledSource();
    const pending = new FakeScheduledSource();
    registry.track(finished);
    registry.track(pending);
    finished.finish();

    expect(registry.cancelAll(4)).toBe(1);
    expect(finished.stopCalls).toEqual([]);
    expect(pending.stopCalls).toEqual([4]);
  });
});
