import { useEffect, useState } from 'react';
import { useMetronomeEngine } from './hooks/useMetronomeEngine';
import { useCustomPresets } from './hooks/useCustomPresets';
import { useFocusStats } from './hooks/useFocusStats';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { MetronomeVisual } from './components/Metronome/MetronomeVisual';
import { AcousticVisualizer } from './components/Metronome/AcousticVisualizer';
import { ControlPanel } from './components/Metronome/ControlPanel';
import { SessionTimer } from './components/Metronome/SessionTimer';
import { BilateralComingSoonBanner } from './components/BilateralComingSoonBanner';
import { AccountPoll } from './components/AccountPoll';
import { FocusDashboard } from './components/Dashboard/FocusDashboard';
import { BANDS } from './data/bands';

export default function App() {
  const engine = useMetronomeEngine();
  const customPresetsHook = useCustomPresets();
  const focusStats = useFocusStats(engine.isPlaying, engine.band);
  const bandInfo = BANDS[engine.band];

  /** "Just a big metronome" — collapses everything but the visual itself
   * and its play/pause control down to a full-viewport takeover with a
   * clean background, per the builder's own framing. A CSS overlay, not
   * the real Fullscreen API: the native API needs a user-gesture-scoped
   * call, shows a browser-chrome "press Esc to exit" banner the first
   * time, and exits itself on Escape (which would then race a second,
   * app-owned Escape handler) — a plain fixed-position takeover gets the
   * same practical result (fill the screen, hide the chrome) without any
   * of that, and works identically across browsers. */
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    if (!focusMode) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setFocusMode(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    // .metronome-stage.focus-mode is a fixed, full-viewport overlay with
    // nothing else left mounted behind it (every other section unmounts
    // via the JSX conditionals below) — locking body scroll just prevents
    // a phantom scrollbar/overscroll-bounce past its edges.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [focusMode]);

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
      tickSubdivision: engine.tickSubdivision,
      chimeInterval: engine.chimeInterval,
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
      {!focusMode && (
        <header className="hero-header">
          <span className="hero-kicker">Mindful Metronome</span>
          <h1>Tune into the rhythm between your two hemispheres.</h1>
          <p className="hero-sub">
            A steady, binaural pulse for flow states — free, and yours to use for as long as it helps.
          </p>
        </header>
      )}

      <main
        className={`metronome-stage ${engine.sessionPhase === 'ended' ? 'session-ending' : ''} ${focusMode ? 'focus-mode' : ''}`}
        style={{ '--band-color': bandInfo.color, '--band-glow': bandInfo.glow } as React.CSSProperties}
      >
        <div className="metronome-visual-frame">
          <MetronomeVisual
            isPlaying={engine.isPlaying}
            band={engine.band}
            swingRef={engine.swingRef}
            getAudioTimeSec={engine.getAudioTimeSec}
            getAnalyser={engine.getAnalyser}
            lastTickSide={engine.lastTickSide}
            tickCount={engine.tickCount}
            bpm={engine.bpm}
            onSetBpm={engine.setBpm}
            sessionPhase={engine.sessionPhase}
            sessionRef={engine.sessionRef}
            tickSubdivision={engine.tickSubdivision}
            selectedMedallionId={focusStats.selectedMedallionId}
            unlockedMedallionIds={focusStats.unlockedIds}
            onSelectMedallion={focusStats.setSelectedMedallionId}
          />
          <button
            type="button"
            className="focus-mode-toggle"
            onClick={() => setFocusMode((v) => !v)}
            aria-label={focusMode ? 'Exit focus mode' : 'Expand to focus mode'}
            title={focusMode ? 'Exit focus mode (Esc)' : 'Expand to focus mode'}
          >
            {focusMode ? '✕' : '⛶'}
          </button>
        </div>

        <div className="stage-readout">
          <span className="state-badge">
            {bandInfo.label} · {bandInfo.blurb}
          </span>
          <button type="button" className={`play-toggle ${engine.isPlaying ? 'playing' : ''}`} onClick={engine.toggle}>
            {engine.isPlaying ? '❚❚ Pause' : '▶ Begin'}
          </button>
        </div>

        {!focusMode && (
          <>
            <SessionTimer
              sessionDurationMinutes={engine.sessionDurationMinutes}
              sessionPhase={engine.sessionPhase}
              sessionRemainingSec={engine.sessionRemainingSec}
              isPlaying={engine.isPlaying}
              onSetSessionDurationMinutes={engine.setSessionDurationMinutes}
              chipColor={bandInfo.color}
            />

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
              tickSubdivision={engine.tickSubdivision}
              chimeInterval={engine.chimeInterval}
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
              onSetTickSubdivision={engine.setTickSubdivision}
              onSetChimeInterval={engine.setChimeInterval}
              onSetHapticsEnabled={engine.setHapticsEnabled}
              onApplyPreset={engine.applyPreset}
              getShareableLink={engine.getShareableLink}
              customPresets={customPresetsHook.customPresets}
              onSaveCustomPreset={handleSaveCustomPreset}
              onDeleteCustomPreset={customPresetsHook.deletePreset}
            />
          </>
        )}
      </main>

      {!focusMode && (
        <FocusDashboard
          totalMinutes={focusStats.totalMinutes}
          totalSecondsByBand={focusStats.stats.totalSecondsByBand}
          streak={focusStats.streak}
          growth={focusStats.growth}
          treeStage={focusStats.treeStage}
          unlockedIds={focusStats.unlockedIds}
          selectedMedallionId={focusStats.selectedMedallionId}
          onSelectMedallion={focusStats.setSelectedMedallionId}
          justUnlocked={focusStats.justUnlocked}
          bandColor={bandInfo.color}
          pendingMysteryCount={focusStats.pendingMysteryCount}
          mysteryOwnedIds={focusStats.mysteryOwnedIds}
          onHarvestMysteryFruit={focusStats.harvestMysteryFruit}
        />
      )}

      {!focusMode && <AccountPoll />}

      {!focusMode && (
        <footer className="app-footer">
          <p>Headphones recommended for the binaural layer. Mindful Metronome is free — use it as much as you like.</p>
          <a href="https://bradenmoser.com" target="_blank" rel="noopener noreferrer" className="built-by-link">
            <img src="/bbm-favicon.png" alt="" width={14} height={14} />
            built by BBM
          </a>
        </footer>
      )}

      {!focusMode && <BilateralComingSoonBanner />}
    </div>
  );
}
