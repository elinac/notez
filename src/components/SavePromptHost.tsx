import { useCallback, useEffect, useState } from 'react';
import {
  registerSavePromptHandler,
  type SavePromptChoice,
} from '../utils/savePrompt';

interface OpenState {
  message: string;
  resolve: (choice: SavePromptChoice) => void;
}

export function SavePromptHost() {
  const [open, setOpen] = useState<OpenState | null>(null);

  const finish = useCallback((choice: SavePromptChoice) => {
    open?.resolve(choice);
    setOpen(null);
  }, [open]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        finish('cancel');
      }
    },
    [open, finish],
  );

  useEffect(() => {
    registerSavePromptHandler(
      (message) =>
        new Promise<SavePromptChoice>((resolve) => {
          setOpen({ message, resolve });
        }),
    );
    return () => registerSavePromptHandler(null);
  }, []);

  useEffect(() => {
    if (open) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        data-testid="save-prompt-overlay"
        className="absolute inset-0 bg-black/40"
        onClick={() => finish('cancel')}
      />
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-2xl p-6 min-w-[320px] max-w-[90vw]">
        <p className="text-sm text-gray-800 dark:text-gray-100 mb-6">
          {open.message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => finish('cancel')}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => finish('discard')}
            className="px-3 py-1.5 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            不保存
          </button>
          <button
            type="button"
            onClick={() => finish('save')}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
