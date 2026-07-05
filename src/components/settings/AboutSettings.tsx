import { useState } from 'react';
import { isTauri } from '../FileOperations';
import { useAppVersion } from '../../hooks/useAppVersion';

async function openBundledDoc(relativePath: '../LICENSE' | '../THIRD_PARTY_NOTICES.md') {
  const { resolveResource } = await import('@tauri-apps/api/path');
  const { openPath } = await import('@tauri-apps/plugin-opener');
  const path = await resolveResource(relativePath);
  await openPath(path);
}

export function AboutSettings() {
  const { version, loading, error } = useAppVersion();
  const [openError, setOpenError] = useState<string | null>(null);
  const inTauri = isTauri();

  const handleOpen = async (doc: '../LICENSE' | '../THIRD_PARTY_NOTICES.md') => {
    setOpenError(null);
    try {
      await openBundledDoc(doc);
    } catch {
      setOpenError('无法打开文件，请查看仓库根目录对应文件');
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-1">NoteZ</h3>
      <p className="text-xs text-gray-500 mb-4">
        版本 {loading ? '…' : <span>v{version}</span>}
        {error && <span className="block text-[10px] text-amber-600 mt-1">{error}</span>}
      </p>

      <div className="mb-4">
        <p className="text-xs text-gray-600 mb-2">许可证：Apache-2.0</p>
        <button
          type="button"
          disabled={!inTauri}
          title={inTauri ? undefined : '仅在 Tauri 桌面应用中可用'}
          onClick={() => handleOpen('../LICENSE')}
          className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          查看许可证
        </button>
      </div>

      <div className="mb-4">
        <p className="text-xs text-gray-600 mb-2">
          第三方组件：PlantUML（JRE + JAR）、Graphviz、Mermaid、Milkdown 等
        </p>
        <button
          type="button"
          disabled={!inTauri}
          title={inTauri ? undefined : '仅在 Tauri 桌面应用中可用'}
          onClick={() => handleOpen('../THIRD_PARTY_NOTICES.md')}
          className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          查看第三方声明
        </button>
      </div>

      {openError && <p className="text-[10px] text-red-500 mb-2">{openError}</p>}

      {!inTauri && (
        <p className="text-[10px] text-gray-400 leading-snug">
          完整许可证与第三方声明见仓库根目录 LICENSE、THIRD_PARTY_NOTICES.md
        </p>
      )}

      <p className="text-[10px] text-gray-400 mt-6 border-t border-gray-200 pt-4">
        © 2026 NoteZ Contributors
      </p>
    </div>
  );
}
