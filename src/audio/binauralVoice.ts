/**
 * Two MONO oscillators wired into distinct merger inputs. No stereo panner
 * or downmix sits between a tone and its assigned output channel.
 *
 * The swing modulates amplitude only; it never moves either frequency into
 * the other ear. Volume and depth have separate gains so live adjustments
 * cannot collide with scheduled automation.
 */
export class BinauralVoice {
  readonly left: OscillatorNode;
  readonly right: OscillatorNode;
  readonly leftLevel: GainNode;
  readonly rightLevel: GainNode;
  readonly leftDepth: GainNode;
  readonly rightDepth: GainNode;
  readonly output: GainNode;
  private readonly merger: ChannelMergerNode;

  constructor(readonly context: BaseAudioContext, destination: AudioNode) {
    this.left = context.createOscillator();
    this.right = context.createOscillator();
    this.leftLevel = context.createGain();
    this.rightLevel = context.createGain();
    this.leftLevel.gain.value = this.rightLevel.gain.value = 0.5;
    this.leftDepth = context.createGain();
    this.rightDepth = context.createGain();
    this.leftDepth.gain.value = this.rightDepth.gain.value = 0;
    this.leftDepth.connect(this.leftLevel.gain);
    this.rightDepth.connect(this.rightLevel.gain);
    this.merger = context.createChannelMerger(2);
    this.left.connect(this.leftLevel).connect(this.merger, 0, 0);
    this.right.connect(this.rightLevel).connect(this.merger, 0, 1);
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.merger.connect(this.output).connect(destination);
  }

  start(carrier: number, offset: number, volume: number, depth: number): void {
    this.left.frequency.value = carrier;
    this.right.frequency.value = carrier + offset;
    this.setDepth(depth);
    this.setVolume(volume);
    this.left.start();
    this.right.start();
  }

  setFrequencies(carrier: number, offset: number): void {
    this.left.frequency.setTargetAtTime(carrier, this.context.currentTime, 0.05);
    this.right.frequency.setTargetAtTime(carrier + offset, this.context.currentTime, 0.05);
  }

  setVolume(volume: number): void {
    this.output.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.context.currentTime, 0.03);
  }

  setDepth(depth: number): void {
    const amount = Math.max(0, Math.min(1, depth)) * 0.5;
    this.leftDepth.gain.setTargetAtTime(-amount, this.context.currentTime, 0.03);
    this.rightDepth.gain.setTargetAtTime(amount, this.context.currentTime, 0.03);
  }

  stop(at: number, fadeStart = this.context.currentTime, level = this.output.gain.value): void {
    this.output.gain.cancelScheduledValues(fadeStart);
    this.output.gain.setValueAtTime(level, fadeStart);
    this.output.gain.linearRampToValueAtTime(0, at);
    this.left.stop(at);
    this.right.stop(at);
    this.right.onended = () => {
      [this.left, this.right, this.leftLevel, this.rightLevel,
        this.leftDepth, this.rightDepth, this.merger, this.output].forEach(node => node.disconnect());
    };
  }
}
