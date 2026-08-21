import { useCallback, useState } from 'react';
import { generateCustomPresetId, type CustomPreset } from '../data/customPresets';
import { loadCustomPresets, saveCustomPresets } from '../storage/customPresetsStorage';

export function useCustomPresets() {
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(loadCustomPresets);

  const savePreset = useCallback((name: string, fields: Omit<CustomPreset, 'id' | 'name' | 'createdAt'>) => {
    const preset: CustomPreset = {
      id: generateCustomPresetId(),
      name: name.trim() || 'My Preset',
      createdAt: Date.now(),
      ...fields,
    };
    setCustomPresets((prev) => {
      const next = [...prev, preset];
      saveCustomPresets(next);
      return next;
    });
    return preset;
  }, []);

  const deletePreset = useCallback((id: CustomPreset['id']) => {
    setCustomPresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveCustomPresets(next);
      return next;
    });
  }, []);

  return { customPresets, savePreset, deletePreset };
}
