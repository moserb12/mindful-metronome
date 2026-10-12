export interface ScheduledAudioSourceLike {
  stop(when?: number): void;
  addEventListener(
    type: 'ended',
    listener: () => void,
    options?: AddEventListenerOptions
  ): void;
}

/** Tracks one-shot Web Audio sources that may have been scheduled far into
 * the future. Stopping the scheduler alone cannot retract those nodes, so
 * Pause must explicitly stop every source already committed to the graph. */
export class ScheduledAudioSourceRegistry<T extends ScheduledAudioSourceLike = AudioScheduledSourceNode> {
  private readonly sources = new Set<T>();

  track(source: T): void {
    this.sources.add(source);
    source.addEventListener('ended', () => this.sources.delete(source), { once: true });
  }

  cancelAll(stopAtSec: number): number {
    const scheduled = [...this.sources];
    this.sources.clear();
    scheduled.forEach((source) => {
      try {
        source.stop(stopAtSec);
      } catch {
        // A source can finish between the snapshot and stop(). It is
        // already silent in that case, so there is nothing left to cancel.
      }
    });
    return scheduled.length;
  }

  get size(): number {
    return this.sources.size;
  }
}
