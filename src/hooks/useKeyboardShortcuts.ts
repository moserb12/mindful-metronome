import { useEffect } from 'react';
import { MAX_BPM, MIN_BPM, PRESETS } from '../data/bands';
import type { ApplyablePresetFields } from './useMetronomeEngine';

export interface KeyboardShortcutHandlers {
  toggle: () => void;
  bpm: number;
  onSetBpm: (bpm: number) => void;
  onApplyPreset: (preset: ApplyablePresetFields) => void;
}

/** Whether the currently focused element is a form control that should
 * keep its own native keyboard behavior — a focused range slider's own
 * arrow-key handling, a focused select, or any text entry. Checking this
 * (rather than special-casing "did the event originate from a slider")
 * means our shortcuts simply never fire while one of these has focus, so
 * there's nothing to fight: the browser's native behavior wins by
 * construction. */
function isEditableOrControlFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement
  );
}

/**
 * App-wide keyboard shortcuts, deliberately small and easy to reason
 * about — one window-level listener, no shortcut ever fires with a
 * modifier key held (so browser/OS shortcuts are never hijacked) or while
 * a text field/select/range input has focus.
 *
 *   Space        play / pause
 *   ArrowUp/Down nudge tempo ±1 BPM (clamped to MIN_BPM/MAX_BPM)
 *   1-5          apply the matching built-in brainwave-band preset
 *
 * ArrowLeft/ArrowRight are deliberately left unbound.
 */
export function useKeyboardShortcuts({ toggle, bpm, onSetBpm, onApplyPreset }: KeyboardShortcutHandlers): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableOrControlFocused()) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        toggle();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onSetBpm(Math.min(MAX_BPM, bpm + 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onSetBpm(Math.max(MIN_BPM, bpm - 1));
        return;
      }

      const presetIndex = Number(e.key) - 1;
      if (Number.isInteger(presetIndex) && presetIndex >= 0 && presetIndex < PRESETS.length) {
        onApplyPreset(PRESETS[presetIndex]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, bpm, onSetBpm, onApplyPreset]);
}
