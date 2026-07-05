import { useEffect, useState } from 'react';
import { isTauri } from '../components/FileOperations';
import pkg from '../../package.json';

const FALLBACK_VERSION = pkg.version;

export function useAppVersion(): {
  version: string;
  loading: boolean;
  error: string | null;
} {
  const [version, setVersion] = useState(FALLBACK_VERSION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isTauri()) {
        if (!cancelled) {
          setVersion(FALLBACK_VERSION);
          setError(null);
          setLoading(false);
        }
        return;
      }
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        const v = await getVersion();
        if (!cancelled) {
          setVersion(v);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setVersion(FALLBACK_VERSION);
          setError('无法读取 Tauri 版本，已回退 package.json');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { version, loading, error };
}
