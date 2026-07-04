import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { SettingsSidebar } from './SettingsSidebar';
import type { SettingsCategory } from './settingsTypes';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const [category, setCategory] = useState<SettingsCategory>('appearance');

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-white rounded-lg shadow-2xl flex overflow-hidden"
        style={{ width: 720, maxHeight: '80vh' }}
      >
        <SettingsSidebar active={category} onChange={setCategory} />
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-800">
              {category === 'appearance' ? '外观' : category === 'ai' ? 'AI 服务' : 'PlantUML'}
            </h2>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {/* Phase 1 placeholder: sub-components will be wired in Task 4/5 */}
            <div className="text-xs text-gray-400">{category} settings placeholder</div>
          </div>
        </div>
      </div>
    </div>
  );
}
