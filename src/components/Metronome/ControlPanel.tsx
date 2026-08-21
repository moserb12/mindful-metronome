import { BANDS, PRESETS, classifyBeatFrequency, type MetronomePreset } from '../../data/bands';
import type { TickEarMode, TickSound } from '../../audio/binauralEngine';

interface ControlPanelProps {
  carrierHz: number;
  beatHz: number;
  bpm: number;
  tickSound: TickSound;
  droneVolume: number;
  tickVolume: number;
  noiseVolume: number;
  panModulationDepth: number;
  tickEarMode: TickEarMode;
  onSetCarrierHz: (hz: number) => void;
  onSetBeatHz: (hz: number) => void;
  onSetBpm: (bpm: number) => void;
  onSetTickSound: (sound: TickSound) => void;
  onSetVolumes: (next: { droneVolume?: number; tickVolume?: number; noiseVolume?: number }) => void;
  onSetPanModulationDepth: (depth: number) => void;
  onSetTickEarMode: (mode: TickEarMode) => void;
  onApplyPreset: (preset: MetronomePreset) => void;
}

const TICK_SOUND_OPTIONS: { value: TickSound; label: string }[] = [
  { value: 'soft', label: 'Soft pulse' },
  { value: 'wood', label: 'Wood block' },
  { value: 'kick', label: 'Warm kick' },
  { value: 'hihat', label: 'Crisp tick' },
];

const TICK_EAR_OPTIONS: { value: TickEarMode; label: string; title: string }[] = [
  { value: 'MATCH', label: 'Match', title: 'Tick fires in the ear the pendulum just reached' },
  { value: 'OPPOSITE', label: 'Opposite', title: 'Tick fires in the ear the drone is currently quietest in' },
  { value: 'BOTH', label: 'Both', title: 'Tick fires centered, equally in both ears' },
];

/** Preview text for the current pan-modulation split at full swing, e.g.
 * "80/20" — mirrors exactly what the listener will hear at the extremes. */
function splitPreviewLabel(depth: number): string {
  const rightAtFullSwing = Math.round((0.5 + 0.5 * depth) * 100);
  const leftAtFullSwing = 100 - rightAtFullSwing;
  return `${leftAtFullSwing}/${rightAtFullSwing}`;
}

export function ControlPanel({
  carrierHz,
  beatHz,
  bpm,
  tickSound,
  droneVolume,
  tickVolume,
  noiseVolume,
  panModulationDepth,
  tickEarMode,
  onSetCarrierHz,
  onSetBeatHz,
  onSetBpm,
  onSetTickSound,
  onSetVolumes,
  onSetPanModulationDepth,
  onSetTickEarMode,
  onApplyPreset,
}: ControlPanelProps) {
  const band = classifyBeatFrequency(beatHz);

  return (
    <div className="control-panel">
      <div className="control-group">
        <span className="control-label">Presets</span>
        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-chip ${band === preset.id ? 'active' : ''}`}
              style={{ '--chip-color': BANDS[preset.id].color } as React.CSSProperties}
              onClick={() => onApplyPreset(preset)}
              title={preset.blurb}
            >
              {preset.name}
              <span className="preset-chip-range">{BANDS[preset.id].rangeLabel}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <div className="control-row-header">
          <span className="control-label">Carrier tone</span>
          <span className="control-value">{carrierHz.toFixed(0)} Hz</span>
        </div>
        <input
          type="range"
          min={80}
          max={500}
          step={1}
          value={carrierHz}
          onChange={(e) => onSetCarrierHz(Number(e.target.value))}
        />
      </div>

      <div className="control-group">
        <div className="control-row-header">
          <span className="control-label">Binaural offset</span>
          <span className="control-value" style={{ color: BANDS[band].color }}>
            {beatHz.toFixed(1)} Hz · {BANDS[band].label}
          </span>
        </div>
        <input
          type="range"
          min={0.5}
          max={50}
          step={0.5}
          value={beatHz}
          onChange={(e) => onSetBeatHz(Number(e.target.value))}
        />
      </div>

      <div className="control-group">
        <div className="control-row-header">
          <span className="control-label">Tempo</span>
          <span className="control-value">{bpm} BPM</span>
        </div>
        <input type="range" min={30} max={160} step={1} value={bpm} onChange={(e) => onSetBpm(Number(e.target.value))} />
        <select className="tick-sound-select" value={tickSound} onChange={(e) => onSetTickSound(e.target.value as TickSound)}>
          {TICK_SOUND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <span className="control-label">Mix</span>
        <label className="mixer-row">
          <span>Drone</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={droneVolume}
            onChange={(e) => onSetVolumes({ droneVolume: Number(e.target.value) })}
          />
        </label>
        <label className="mixer-row">
          <span>Tick</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={tickVolume}
            onChange={(e) => onSetVolumes({ tickVolume: Number(e.target.value) })}
          />
        </label>
        <label className="mixer-row">
          <span>Noise shield</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={noiseVolume}
            onChange={(e) => onSetVolumes({ noiseVolume: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="control-group">
        <div className="control-row-header">
          <span className="control-label">Pendulum drone panning</span>
          <span className="control-value">{splitPreviewLabel(panModulationDepth)} at the extremes</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={panModulationDepth}
          onChange={(e) => onSetPanModulationDepth(Number(e.target.value))}
        />
        <p className="control-hint">
          As the pendulum swings, the drone's L/R balance follows it. 0% keeps it always 50/50; 100% swings fully
          between 100/0 and 0/100. The center is always 50/50.
        </p>
      </div>

      <div className="control-group">
        <span className="control-label">Tick ear</span>
        <div className="ear-mode-row" style={{ '--chip-color': BANDS[band].color } as React.CSSProperties}>
          {TICK_EAR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`ear-mode-btn ${tickEarMode === opt.value ? 'active' : ''}`}
              title={opt.title}
              onClick={() => onSetTickEarMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
