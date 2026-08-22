import { useState } from 'react';
import {
  BANDS,
  MAX_BEAT_HZ,
  MAX_BPM,
  MAX_CARRIER_HZ,
  MIN_BEAT_HZ,
  MIN_BPM,
  MIN_CARRIER_HZ,
  PRESETS,
  classifyBeatFrequency,
} from '../../data/bands';
import { NOISE_SHIELDS, NOISE_SHIELD_ORDER } from '../../data/noiseShields';
import { VIBE_GREETINGS } from '../../data/greetings';
import type { CustomPreset } from '../../data/customPresets';
import type { ApplyablePresetFields } from '../../hooks/useMetronomeEngine';
import type { NoiseType, TickEarMode, TickSound, TickSubdivision } from '../../audio/binauralEngine';

interface ControlPanelProps {
  carrierHz: number;
  beatHz: number;
  bpm: number;
  tickSound: TickSound;
  masterVolume: number;
  droneVolume: number;
  tickVolume: number;
  noiseVolume: number;
  noiseType: NoiseType;
  panModulationDepth: number;
  tickEarMode: TickEarMode;
  tickSubdivision: TickSubdivision;
  hapticsEnabled: boolean;
  onSetCarrierHz: (hz: number) => void;
  onSetBeatHz: (hz: number) => void;
  onSetBpm: (bpm: number) => void;
  onSetTickSound: (sound: TickSound) => void;
  onSetVolumes: (next: { droneVolume?: number; tickVolume?: number; noiseVolume?: number }) => void;
  onSetMasterVolume: (volume: number) => void;
  onSetNoiseType: (type: NoiseType) => void;
  onSetPanModulationDepth: (depth: number) => void;
  onSetTickEarMode: (mode: TickEarMode) => void;
  onSetTickSubdivision: (subdivision: TickSubdivision) => void;
  onSetHapticsEnabled: (enabled: boolean) => void;
  onApplyPreset: (preset: ApplyablePresetFields) => void;
  getShareableLink: () => string;
  customPresets: CustomPreset[];
  onSaveCustomPreset: (name: string) => void;
  onDeleteCustomPreset: (id: CustomPreset['id']) => void;
}

/** §9 custom presets — a second chip row beneath the built-in Presets,
 * reusing the same `.preset-chip` visual. Unlike built-in presets, each
 * custom chip gets a small delete affordance, and there's a "+ Save
 * preset" chip that opens a minimal inline name field — no modal, matching
 * the app's lightweight feel elsewhere (e.g. the noise-type picker). */
function CustomPresetsRow({
  customPresets,
  onApplyPreset,
  onSaveCustomPreset,
  onDeleteCustomPreset,
  chipColor,
}: {
  customPresets: CustomPreset[];
  onApplyPreset: (preset: ApplyablePresetFields) => void;
  onSaveCustomPreset: (name: string) => void;
  onDeleteCustomPreset: (id: CustomPreset['id']) => void;
  chipColor: string;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  function handleConfirmSave() {
    onSaveCustomPreset(name);
    setName('');
    setNaming(false);
  }

  return (
    <div className="custom-preset-row" style={{ '--chip-color': chipColor } as React.CSSProperties}>
      {customPresets.map((preset) => (
        <span key={preset.id} className="preset-chip custom-preset-chip">
          <button type="button" className="custom-preset-apply" onClick={() => onApplyPreset(preset)}>
            {preset.name}
          </button>
          <button
            type="button"
            className="custom-preset-delete"
            aria-label={`Delete preset "${preset.name}"`}
            onClick={() => onDeleteCustomPreset(preset.id)}
          >
            ×
          </button>
        </span>
      ))}
      {naming ? (
        <span className="preset-chip custom-preset-naming">
          <input
            autoFocus
            className="custom-preset-name-input"
            value={name}
            placeholder="Preset name"
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmSave();
              if (e.key === 'Escape') {
                setNaming(false);
                setName('');
              }
            }}
          />
          <button type="button" className="custom-preset-confirm" onClick={handleConfirmSave}>
            Save
          </button>
        </span>
      ) : (
        <button type="button" className="preset-chip custom-preset-add" onClick={() => setNaming(true)}>
          + Save preset
        </button>
      )}
    </div>
  );
}

/** "Copy Link" affordance for §8 shareable links — reads the live current
 * setup fresh on every click via `getShareableLink` (never a stale
 * snapshot), copies it via the Clipboard API, and falls back to showing
 * the raw link in a selectable field for browsers/contexts where
 * `navigator.clipboard` is unavailable or denied (e.g. non-HTTPS, some
 * embedded webviews) — so the feature always has a way to actually get
 * the link out, never a silent failure. */
function CopyLinkButton({ getShareableLink }: { getShareableLink: () => string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'fallback'>('idle');
  const [link, setLink] = useState('');

  async function handleClick() {
    const url = getShareableLink();
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setLink(url);
      setStatus('fallback');
    }
  }

  return (
    <div className="copy-link-row">
      <button type="button" className="copy-link-btn" onClick={handleClick}>
        {status === 'copied' ? 'Link copied!' : 'Copy link'}
      </button>
      {status === 'fallback' && (
        <input
          className="copy-link-fallback"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Shareable link"
        />
      )}
    </div>
  );
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

const TICK_SUBDIVISION_OPTIONS: { value: TickSubdivision; label: string; title: string }[] = [
  { value: 'ENDS', label: 'On the beat', title: 'Tick only when the pendulum reaches each side' },
  {
    value: 'ENDS_AND_CENTER',
    label: 'On the beat + off-beat',
    title: 'Tick on arrival, plus a softer tick as it passes center',
  },
  { value: 'CENTER', label: 'Off-beat only', title: 'Tick only as the pendulum passes center — no tick on arrival' },
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
  masterVolume,
  droneVolume,
  tickVolume,
  noiseVolume,
  noiseType,
  panModulationDepth,
  tickEarMode,
  tickSubdivision,
  hapticsEnabled,
  onSetCarrierHz,
  onSetBeatHz,
  onSetBpm,
  onSetTickSound,
  onSetVolumes,
  onSetMasterVolume,
  onSetNoiseType,
  onSetPanModulationDepth,
  onSetTickEarMode,
  onSetTickSubdivision,
  onSetHapticsEnabled,
  onApplyPreset,
  getShareableLink,
  customPresets,
  onSaveCustomPreset,
  onDeleteCustomPreset,
}: ControlPanelProps) {
  const band = classifyBeatFrequency(beatHz);
  const activeShield = NOISE_SHIELDS[noiseType];
  // Feature-detected here (not passed as a prop) since it's a pure browser
  // capability check, not app state — desktop browsers simply don't have
  // this, so the whole control-group is omitted rather than shown disabled.
  const hapticsSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  // Picked once on mount (lazy initializer, same "compute once" idiom as
  // the engine hook's resolveInitialSettings) — random-once, not cycling,
  // so a reload gives real variety without a decorative timer running
  // just to rotate a header.
  const [greeting] = useState(() => VIBE_GREETINGS[Math.floor(Math.random() * VIBE_GREETINGS.length)]);

  return (
    <div className="control-panel">
      <div className="control-group">
        <span className="control-label vibe-greeting" aria-label="Presets">
          {greeting}
        </span>
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
        <div className="mixer-divider" />
        <CustomPresetsRow
          customPresets={customPresets}
          onApplyPreset={onApplyPreset}
          onSaveCustomPreset={onSaveCustomPreset}
          onDeleteCustomPreset={onDeleteCustomPreset}
          chipColor={BANDS[band].color}
        />
        <CopyLinkButton getShareableLink={getShareableLink} />
      </div>

      <div className="control-group">
        <div className="control-row-header">
          <span className="control-label">Carrier tone</span>
          <span className="control-value">{carrierHz.toFixed(0)} Hz</span>
        </div>
        <input
          type="range"
          min={MIN_CARRIER_HZ}
          max={MAX_CARRIER_HZ}
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
          min={MIN_BEAT_HZ}
          max={MAX_BEAT_HZ}
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
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          onChange={(e) => onSetBpm(Number(e.target.value))}
        />
        <select className="tick-sound-select" value={tickSound} onChange={(e) => onSetTickSound(e.target.value as TickSound)}>
          {TICK_SOUND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <span className="control-label">Volume Mixer</span>
        <label className="mixer-row mixer-row-master">
          <span>Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => onSetMasterVolume(Number(e.target.value))}
          />
        </label>
        <div className="mixer-divider" />
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
        <div className="noise-type-row" style={{ '--chip-color': BANDS[band].color } as React.CSSProperties}>
          {NOISE_SHIELD_ORDER.map((type) => (
            <button
              key={type}
              type="button"
              className={`noise-type-btn ${noiseType === type ? 'active' : ''}`}
              onClick={() => onSetNoiseType(type)}
            >
              {NOISE_SHIELDS[type].label}
            </button>
          ))}
        </div>
        <p className="control-hint">
          {activeShield.description} Pairs well with{' '}
          {activeShield.pairsWithBands.map((b) => BANDS[b].label).join(' & ')} tones, {activeShield.tempoHint}.
        </p>
      </div>

      <div className="control-group">
        <div className="control-row-header">
          <span className="control-label">Tick ear</span>
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

      <div className="control-group">
        <span className="control-label">Beat pattern</span>
        <div className="ear-mode-row" style={{ '--chip-color': BANDS[band].color } as React.CSSProperties}>
          {TICK_SUBDIVISION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`ear-mode-btn ${tickSubdivision === opt.value ? 'active' : ''}`}
              title={opt.title}
              onClick={() => onSetTickSubdivision(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {hapticsSupported && (
        <div className="control-group">
          <span className="control-label">Haptics</span>
          <button
            type="button"
            className={`haptics-toggle ${hapticsEnabled ? 'active' : ''}`}
            style={{ '--chip-color': BANDS[band].color } as React.CSSProperties}
            aria-pressed={hapticsEnabled}
            onClick={() => onSetHapticsEnabled(!hapticsEnabled)}
          >
            {hapticsEnabled ? 'Pulse felt on every tick' : 'Off'}
          </button>
          <p className="control-hint">A brief, subtle vibration on every tick — a bilateral pulse you can actually feel.</p>
        </div>
      )}
    </div>
  );
}
