import { useState } from 'react';
import { useMetronomeEngine } from './hooks/useMetronomeEngine';
import { MetronomeVisual } from './components/Metronome/MetronomeVisual';
import { AcousticVisualizer } from './components/Metronome/AcousticVisualizer';
import { ControlPanel } from './components/Metronome/ControlPanel';
import { BANDS } from './data/bands';

export default function App() {
  const engine = useMetronomeEngine();
  const [practiceOpen, setPracticeOpen] = useState(false);
  const bandInfo = BANDS[engine.band];

  return (
    <div className="app-shell">
      <header className="hero-header">
        <span className="hero-kicker">Mindful Metronome</span>
        <h1>Tune into the rhythm between your two hemispheres.</h1>
        <p className="hero-sub">
          A steady, binaural pulse for flow states — free, and yours to use for as long as it helps.
        </p>
      </header>

      <main className="metronome-stage">
        <MetronomeVisual
          isPlaying={engine.isPlaying}
          band={engine.band}
          swingRef={engine.swingRef}
          getAudioTimeSec={engine.getAudioTimeSec}
          getAnalyser={engine.getAnalyser}
          lastTickSide={engine.lastTickSide}
          tickCount={engine.tickCount}
          onSwingUpdate={engine.updateDroneBalance}
        />

        <div className="stage-readout">
          <span className="state-badge" style={{ '--badge-color': bandInfo.color } as React.CSSProperties}>
            {bandInfo.label} · {bandInfo.blurb}
          </span>
          <button type="button" className="play-toggle" onClick={engine.toggle}>
            {engine.isPlaying ? '❚❚ Pause' : '▶ Begin'}
          </button>
        </div>

        <AcousticVisualizer isPlaying={engine.isPlaying} getAnalyser={engine.getAnalyser} bandColor={bandInfo.color} />

        <ControlPanel
          carrierHz={engine.carrierHz}
          beatHz={engine.beatHz}
          bpm={engine.bpm}
          tickSound={engine.tickSound}
          droneVolume={engine.droneVolume}
          tickVolume={engine.tickVolume}
          noiseVolume={engine.noiseVolume}
          panModulationDepth={engine.panModulationDepth}
          tickEarMode={engine.tickEarMode}
          onSetCarrierHz={engine.setCarrierHz}
          onSetBeatHz={engine.setBeatHz}
          onSetBpm={engine.setBpm}
          onSetTickSound={engine.setTickSound}
          onSetVolumes={engine.setVolumes}
          onSetPanModulationDepth={engine.setPanModulationDepth}
          onSetTickEarMode={engine.setTickEarMode}
          onApplyPreset={engine.applyPreset}
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
              A structured, 18-level hand/foot rhythm-timing program lives here — start and stop it independently of
              the metronome above, any time you want a guided practice instead of free-flowing with the drone.
            </p>
            <p className="practice-coming-soon">This section is being built next — check back soon.</p>
          </div>
        )}
      </section>

      <footer className="app-footer">
        <p>Headphones recommended for the binaural layer. Mindful Metronome is free — use it as much as you like.</p>
      </footer>
    </div>
  );
}
