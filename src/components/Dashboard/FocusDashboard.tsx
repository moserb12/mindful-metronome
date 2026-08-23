import { useState } from 'react';
import { BAND_ORDER, BANDS } from '../../data/bands';
import { ALL_MEDALLIONS_BY_ID, MEDALLIONS } from '../../data/medallions';
import type { MedallionId } from '../../data/medallions';
import { MYSTERY_MEDALLIONS, RARITY_LABEL, type MysteryMedallionId } from '../../data/mysteryMedallions';
import type { SecondsByBand, StreakInfo, TreeStageInfo } from '../../engine/growth';
import { bandMinutes } from '../../engine/growth';
import { FractalTree } from './FractalTree';
import { MedallionIcon } from './MedallionIcon';
import { MysteryFruitGround } from './MysteryFruitGround';
import { MysteryRollModal } from './MysteryRollModal';

interface FocusDashboardProps {
  totalMinutes: number;
  totalSecondsByBand: SecondsByBand;
  streak: StreakInfo;
  growth: number;
  treeStage: TreeStageInfo;
  unlockedIds: MedallionId[];
  selectedMedallionId: MedallionId;
  onSelectMedallion: (id: MedallionId) => void;
  justUnlocked: MedallionId[];
  bandColor: string;
  /** Grown-but-not-harvested mystery fruit — see MysteryFruitGround. */
  pendingMysteryCount: number;
  /** Every mystery medallion ever harvested — drives the expandable
   * collection section's owned/locked state. */
  mysteryOwnedIds: MysteryMedallionId[];
  /** Rolls one pending fruit and returns what was won (or null — see
   * useFocusStats.harvestMysteryFruit's own doc comment). */
  onHarvestMysteryFruit: () => MysteryMedallionId | null;
}

function formatMinutesLabel(totalMinutes: number): string {
  if (totalMinutes < 1) return `${Math.round(totalMinutes * 60)}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function FocusDashboard({
  totalMinutes,
  totalSecondsByBand,
  streak,
  growth,
  treeStage,
  unlockedIds,
  selectedMedallionId,
  onSelectMedallion,
  justUnlocked,
  bandColor,
  pendingMysteryCount,
  mysteryOwnedIds,
  onHarvestMysteryFruit,
}: FocusDashboardProps) {
  const unlockedSet = new Set(unlockedIds);
  const mysteryOwnedSet = new Set(mysteryOwnedIds);
  const maxBandMinutes = Math.max(1, ...BAND_ORDER.map((b) => bandMinutes(totalSecondsByBand, b)));
  const celebrationText =
    justUnlocked.length > 0
      ? `New medallion${justUnlocked.length > 1 ? 's' : ''} unlocked: ${justUnlocked.map((id) => ALL_MEDALLIONS_BY_ID[id]?.name ?? id).join(', ')}`
      : '';

  const [rollResult, setRollResult] = useState<MysteryMedallionId | null>(null);
  function handleHarvest() {
    const result = onHarvestMysteryFruit();
    if (result) setRollResult(result);
  }

  return (
    <section className="focus-dashboard" style={{ '--band-color': bandColor } as React.CSSProperties} aria-label="Focus dashboard">
      <div className="sr-only" role="status" aria-live="polite">
        {celebrationText}
      </div>

      <div className="focus-dashboard-header">
        <div>
          <span className="hero-kicker">Focus Garden</span>
          <h2>Your practice, growing.</h2>
        </div>
        <div className="streak-pill" title={streak.wateredToday ? 'Watered today' : 'Not watered yet today — one minute keeps the streak alive'}>
          <span className={`streak-flame ${streak.wateredToday ? 'streak-flame-lit' : ''}`} aria-hidden="true" />
          <span className="streak-count">{streak.current}</span>
          <span className="streak-label">day streak</span>
        </div>
      </div>

      {celebrationText && (
        <div className="unlock-banner" key={justUnlocked.join(',')}>
          <span className="unlock-banner-glyphs">
            {justUnlocked.map((id) => (
              <MedallionIcon key={id} id={id} size={32} />
            ))}
          </span>
          <span>{celebrationText}</span>
        </div>
      )}

      <div className="focus-dashboard-grid">
        <div className="focus-card tree-card">
          <FractalTree growth={growth} unlockedIds={unlockedIds} glowColor={bandColor} />
          <div className="tree-card-caption">
            <span className="tree-stage-label">{treeStage.label}</span>
            <span className="tree-growth-pct">{Math.round(growth * 100)}% grown</span>
          </div>
          <p className="control-hint">
            The tree grows as you log time, and bears fruit — one for every medallion you've collected below.
          </p>
        </div>

        <div className="focus-card stats-card">
          <div className="control-row-header">
            <span className="control-label">Total time logged</span>
            <span className="control-value">{formatMinutesLabel(totalMinutes)}</span>
          </div>
          <div className="band-duration-list">
            {BAND_ORDER.map((band) => {
              const minutes = bandMinutes(totalSecondsByBand, band);
              const pct = Math.min(100, (minutes / maxBandMinutes) * 100);
              return (
                <div key={band} className="band-duration-row">
                  <span className="band-duration-label" style={{ color: BANDS[band].color }}>
                    {BANDS[band].label}
                  </span>
                  <div className="band-duration-track">
                    <div className="band-duration-fill" style={{ width: `${pct}%`, background: BANDS[band].color }} />
                  </div>
                  <span className="band-duration-value">{formatMinutesLabel(minutes)}</span>
                </div>
              );
            })}
          </div>
          <div className="mixer-divider" />
          <div className="streak-detail-row">
            <span>Longest streak</span>
            <span>{streak.longest} {streak.longest === 1 ? 'day' : 'days'}</span>
          </div>
        </div>
      </div>

      <MysteryFruitGround pendingCount={pendingMysteryCount} onHarvest={handleHarvest} />

      <div className="focus-card medallion-collection">
        <span className="control-label">Medallion collection — click one to mount it on the pendant</span>
        <div className="medallion-grid">
          {MEDALLIONS.map((def) => {
            const unlocked = unlockedSet.has(def.id);
            const selected = def.id === selectedMedallionId;
            return (
              <button
                key={def.id}
                type="button"
                className={`medallion-grid-item ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}`}
                onClick={() => unlocked && onSelectMedallion(def.id)}
                disabled={!unlocked}
                title={unlocked ? def.name : `Locked — ${def.blurb}`}
              >
                <MedallionIcon id={def.id} size={44} locked={!unlocked} />
                <span className="medallion-grid-name">{unlocked ? def.name : '???'}</span>
                <span className="medallion-grid-blurb">{def.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      <details className="focus-card control-group mystery-collection">
        <summary className="control-group-summary">
          <span className="control-label">
            RNG unlockable skins — {mysteryOwnedIds.length}/{MYSTERY_MEDALLIONS.length} collected
          </span>
          <span className="control-group-chevron" aria-hidden="true">
            ▸
          </span>
        </summary>
        <div className="control-group-body">
          <p className="control-hint">
            Won only by harvesting mystery fruit from the ground above — never by a specific goal. Rarer pulls are rarer for a
            reason; every roll is guaranteed to be something new.
          </p>
          <div className="medallion-grid">
            {MYSTERY_MEDALLIONS.map((def) => {
              const unlocked = mysteryOwnedSet.has(def.id);
              const selected = def.id === selectedMedallionId;
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`medallion-grid-item ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}`}
                  onClick={() => unlocked && onSelectMedallion(def.id)}
                  disabled={!unlocked}
                  title={unlocked ? def.name : `Locked — ${RARITY_LABEL[def.rarity]} tier, harvest a mystery fruit to find out`}
                >
                  <MedallionIcon id={def.id} size={44} locked={!unlocked} />
                  <span className="medallion-grid-name">{unlocked ? def.name : '???'}</span>
                  <span className={`mystery-rarity-chip mystery-grid-chip rarity-${def.rarity}`}>{RARITY_LABEL[def.rarity]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </details>

      {rollResult && <MysteryRollModal resultId={rollResult} onClose={() => setRollResult(null)} />}
    </section>
  );
}
