import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isFileTab, useAppStore } from '../store/useAppStore';
import { isTauri } from '../components/FileOperations';
import { resolveUnsavedTabs } from '../utils/resolveUnsavedTabs';

export function useUnsavedExitGuard(): void {
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isTauri()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        const dirty = useAppStore.getState().tabs.some(
          (t) => isFileTab(t) && t.file.isDirty,
        );
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }

    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (inFlight.current) {
          event.preventDefault();
          return;
        }
        const dirtyTabs = useAppStore
          .getState()
          .tabs.filter((t) => isFileTab(t) && t.file.isDirty);
        if (dirtyTabs.length === 0) return;

        inFlight.current = true;
        try {
          const result = await resolveUnsavedTabs(dirtyTabs);
          if (result === 'abort') {
            event.preventDefault();
          }
          // proceed: do not preventDefault → Tauri destroys
        } finally {
          inFlight.current = false;
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);
}
