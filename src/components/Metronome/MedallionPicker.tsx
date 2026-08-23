import { useEffect, useRef } from 'react';
import { ALL_MEDALLIONS_BY_ID, type MedallionId } from '../../data/medallions';
import { MedallionIcon } from '../Dashboard/MedallionIcon';

interface MedallionPickerProps {
  unlockedIds: MedallionId[];
  selectedId: MedallionId;
  onSelect: (id: MedallionId) => void;
  onClose: () => void;
}

/**
 * A small popover opened by tapping the pendant at the end of the
 * pendulum — lets a listener swap which unlocked medallion hangs there
 * without leaving the metronome. Deliberately only lists what's ALREADY
 * unlocked (the full collection, including locked ones and their unlock
 * requirements, lives in the Focus Garden dashboard below) — this is a
 * quick swap tool, not a second copy of the whole collection screen.
 */
export function MedallionPicker({ unlockedIds, selectedId, onSelect, onClose }: MedallionPickerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="medallion-picker" ref={panelRef} role="dialog" aria-modal="true" aria-label="Choose a medallion">
      <div className="medallion-picker-header">
        <span>Choose a medallion</span>
        <button type="button" className="medallion-picker-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="medallion-picker-row">
        {unlockedIds.map((id, i) => (
          <button
            key={id}
            ref={i === 0 ? firstItemRef : undefined}
            type="button"
            className={`medallion-picker-item ${id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(id)}
            title={ALL_MEDALLIONS_BY_ID[id].name}
          >
            <MedallionIcon id={id} size={34} />
          </button>
        ))}
      </div>
      {unlockedIds.length <= 1 && (
        <p className="medallion-picker-hint">Keep practicing — new medallions unlock in your Focus Garden below.</p>
      )}
    </div>
  );
}
