import { useSettingsStore } from '../../store/useSettingsStore';

export function EditorSettings() {
  const autoSaveEnabled = useSettingsStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useSettingsStore((s) => s.setAutoSaveEnabled);

  return (
    <div>
      <label className="flex items-start gap-2.5 mb-4 cursor-pointer max-w-md">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={autoSaveEnabled}
          onChange={(e) => setAutoSaveEnabled(e.target.checked)}
        />
        <span>
          <span className="block text-xs text-gray-700">自动保存</span>
          <span className="block text-[10px] text-gray-400 mt-1 leading-snug">
            开启后，桌面端已保存到磁盘的文件在编辑停顿约 1 秒后自动写入。新建未命名文件不会自动保存。浏览器预览模式下此选项不生效。
          </span>
        </span>
      </label>
    </div>
  );
}
