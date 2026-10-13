import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MYSTERY_MEDALLIONS, MYSTERY_MEDALLIONS_BY_ID, RARITY_BLURB, RARITY_LABEL, type MysteryMedallionId } from '../../data/mysteryMedallions';
import { MedallionIcon } from './MedallionIcon';

interface MysteryRollModalProps {
  /** Which medallion was actually won — already decided by
   * useFocusStats.harvestMysteryFruit() before this modal ever mounts (see
   * that function's doc comment for why the roll itself can't happen in
   * here). Everything in this component is presentation: a bit of
   * suspense, then the reveal. */
  resultId: MysteryMedallionId;
  onClose: () => void;
}

const REEL_CELL_PX = 84;
const REEL_FILLER_COUNT = 22;
const SPIN_DURATION_MS = 1700;

/** A shuffled run of filler glyphs with the real result appended at the
 * end — built once per modal instance (useState initializer, not
 * regenerated on re-render) so the strip doesn't visibly reshuffle itself
 * mid-spin. The fillers are purely cosmetic (any medallion, not
 * rarity-weighted) — only the LAST cell matters. */
function buildReel(resultId: MysteryMedallionId): MysteryMedallionId[] {
  const fillers: MysteryMedallionId[] = [];
  for (let i = 0; i < REEL_FILLER_COUNT; i++) {
    fillers.push(MYSTERY_MEDALLIONS[Math.floor(Math.random() * MYSTERY_MEDALLIONS.length)].id);
  }
  return [...fillers, resultId];
}

/**
 * The slot-machine reveal opened by tapping a mystery fruit — a horizontal
 * reel spins past a run of filler glyphs and settles on the real result,
 * then hands off to a static reward card (glyph, name, rarity chip,
 * flavor line). Tapping anywhere during the spin skips straight to the
 * reveal (the outcome is already locked in either way, so skipping costs
 * nothing real — same reasoning a "keep them coming back" mechanic
 * shouldn't force a full-length animation on every single pull).
 */
export function MysteryRollModal({ resultId, onClose }: MysteryRollModalProps) {
  const [reel] = useState(() => buildReel(resultId));
  const [phase, setPhase] = useState<'spinning' | 'revealed'>('spinning');
  const trackRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const def = MYSTERY_MEDALLIONS_BY_ID[resultId];

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    // Start at rest (no transition yet), then kick off the real transition
    // on the NEXT frame so the browser has actually painted the 0-offset
    // state first — setting both the start position and the transitioned
    // end position in the same tick would just skip straight to the end.
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
    const raf = requestAnimationFrame(() => {
      track.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.68, 0.16, 1)`;
      const lastIndex = reel.length - 1;
      // Centers the LAST cell (the real result) in the viewport.
      track.style.transform = `translateX(-${lastIndex * REEL_CELL_PX}px)`;
    });

    revealTimeoutRef.current = setTimeout(() => setPhase('revealed'), SPIN_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function skipToReveal() {
    if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
    setPhase('revealed');
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div className="mystery-roll-backdrop" role="dialog" aria-modal="true" aria-label="Mystery fruit reveal">
      <div className={`mystery-roll-modal rarity-${def.rarity} ${phase === 'revealed' ? 'revealed' : ''}`}>
        <button
          ref={closeButtonRef}
          type="button"
          className="medallion-picker-close mystery-roll-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {phase === 'spinning' && (
          <button type="button" className="mystery-reel-viewport" onClick={skipToReveal} aria-label="Skip to reveal">
            <div ref={trackRef} className="mystery-reel-track">
              {reel.map((id, i) => (
                <div key={i} className="mystery-reel-cell">
                  <MedallionIcon id={id} size={56} />
                </div>
              ))}
            </div>
            <div className="mystery-reel-marker" aria-hidden="true" />
          </button>
        )}

        {phase === 'revealed' && (
          <div className="mystery-reveal" role="status" aria-live="polite">
            <div className="mystery-reveal-glow" aria-hidden="true" />
            <MedallionIcon id={resultId} size={92} className="mystery-reveal-icon" />
            <span className={`mystery-rarity-chip rarity-${def.rarity}`}>{RARITY_LABEL[def.rarity]}</span>
            <h3 className="mystery-reveal-name">{def.name}</h3>
            <p className="control-hint">{RARITY_BLURB[def.rarity]}</p>
            <button type="button" className="play-toggle mystery-reveal-close" onClick={onClose}>
              Nice!
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
