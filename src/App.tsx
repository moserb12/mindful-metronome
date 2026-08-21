import { useState } from 'react';
import { useMetronomeEngine } from './hooks/useMetronomeEngine';
import { useCustomPresets } from './hooks/useCustomPresets';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { MetronomeVisual } from './components/Metronome/MetronomeVisual';
import { AcousticVisualizer } from './components/Metronome/AcousticVisualizer';
import { ControlPanel } from './components/Metronome/ControlPanel';
import { SessionTimer } from './components/Metronome/SessionTimer';
import { BANDS } from './data/bands';

export default function App() {
  const engine = useMetronomeEngine();
  const customPresetsHook = useCustomPresets();
  const [practiceOpen, setPracticeOpen] = useState(false);
  const bandInfo = BANDS[engine.band];

  function handleSaveCustomPreset(name: string) {
    customPresetsHook.savePreset(name, {
      carrierHz: engine.carrierHz,
      beatHz: engine.beatHz,
      bpm: engine.bpm,
      masterVolume: engine.masterVolume,
      droneVolume: engine.droneVolume,
      tickVolume: engine.tickVolume,
      noiseVolume: engine.noiseVolume,
      noiseType: engine.noiseType,
      tickSound: engine.tickSound,
      panModulationDepth: engine.panModulationDepth,
      tickEarMode: engine.tickEarMode,
    });
  }

  useKeyboardShortcuts({
    toggle: engine.toggle,
    bpm: engine.bpm,
    onSetBpm: engine.setBpm,
    onApplyPreset: engine.applyPreset,
  });

  return (
    <div className="app-shell">
      <header className="hero-header">
        <span className="hero-kicker">Mindful Metronome</span>
        <h1>Tune into the rhythm between your two hemispheres.</h1>
        <p className="hero-sub">
          A steady, binaural pulse for flow states — free, and yours to use for as long as it helps.
        </p>
      </header>

      <main
        className={`metronome-stage ${engine.sessionPhase === 'ended' ? 'session-ending' : ''}`}
        style={{ '--band-color': bandInfo.color, '--band-glow': bandInfo.glow } as React.CSSProperties}
      >
        <MetronomeVisual
          isPlaying={engine.isPlaying}
          band={engine.band}
          swingRef={engine.swingRef}
          getAudioTimeSec={engine.getAudioTimeSec}
          getAnalyser={engine.getAnalyser}
          lastTickSide={engine.lastTickSide}
          tickCount={engine.tickCount}
          onSwingUpdate={engine.updateDroneBalance}
          bpm={engine.bpm}
          onSetBpm={engine.setBpm}
        />

        <div className="stage-readout">
          <span className="state-badge">
            {bandInfo.label} · {bandInfo.blurb}
          </span>
          <button type="button" className={`play-toggle ${engine.isPlaying ? 'playing' : ''}`} onClick={engine.toggle}>
            {engine.isPlaying ? '❚❚ Pause' : '▶ Begin'}
          </button>
        </div>

        <AcousticVisualizer isPlaying={engine.isPlaying} getAnalyser={engine.getAnalyser} bandColor={bandInfo.color} />

        <ControlPanel
          carrierHz={engine.carrierHz}
          beatHz={engine.beatHz}
          bpm={engine.bpm}
          tickSound={engine.tickSound}
          masterVolume={engine.masterVolume}
          droneVolume={engine.droneVolume}
          tickVolume={engine.tickVolume}
          noiseVolume={engine.noiseVolume}
          noiseType={engine.noiseType}
          panModulationDepth={engine.panModulationDepth}
          tickEarMode={engine.tickEarMode}
          hapticsEnabled={engine.hapticsEnabled}
          onSetCarrierHz={engine.setCarrierHz}
          onSetBeatHz={engine.setBeatHz}
          onSetBpm={engine.setBpm}
          onSetTickSound={engine.setTickSound}
          onSetVolumes={engine.setVolumes}
          onSetMasterVolume={engine.setMasterVolume}
          onSetNoiseType={engine.setNoiseType}
          onSetPanModulationDepth={engine.setPanModulationDepth}
          onSetTickEarMode={engine.setTickEarMode}
          onSetHapticsEnabled={engine.setHapticsEnabled}
          onApplyPreset={engine.applyPreset}
          getShareableLink={engine.getShareableLink}
          customPresets={customPresetsHook.customPresets}
          onSaveCustomPreset={handleSaveCustomPreset}
          onDeleteCustomPreset={customPresetsHook.deletePreset}
        />
      </main>

      <section className="practice-section">
        <button type="button" className="practice-toggle" onClick={() => setPracticeOpen((v) => !v)}>
          <span>🧠 Practice with Bilateral Stimulation</span>
          <span className="practice-toggle-chevron">{practiceOpen ? '−' : '+'}</span>
        </button>
        {practiceOpen && (
          <div className="practice-body">
            <p>
              Set a session length and the drone will fade gracefully with a soft closing tone when your time is up
              — instead of an abrupt stop, or having to remember to come back and pause it yourself.
            </p>
            <SessionTimer
              sessionDurationMinutes={engine.sessionDurationMinutes}
              sessionPhase={engine.sessionPhase}
              sessionRemainingSec={engine.sessionRemainingSec}
              isPlaying={engine.isPlaying}
              onSetSessionDurationMinutes={engine.setSessionDurationMinutes}
              chipColor={bandInfo.color}
            />
          </div>
        )}
      </section>

      <footer className="app-footer">
        <p>Headphones recommended for the binaural layer. Mindful Metronome is free — use it as much as you like.</p>
      </footer>
    </div>
  );
}
