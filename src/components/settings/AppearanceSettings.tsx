import { ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { EDITOR_COLOR_MODE_OPTIONS, EDITOR_THEME_OPTIONS } from '../../constants/editorThemes';
import { CODE_BLOCK_THEME_OPTIONS } from '../../constants/codeBlockThemes';

function SettingsSelect<T extends string>({
  label, value, options, onChange,
}: {
  label: string; value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}
          className="w-full max-w-xs px-2.5 py-1.5 border border-gray-200 rounded text-xs appearance-none pr-7 bg-white">
          {options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const {
    editorColorMode, setEditorColorMode,
    editorThemeId, setEditorThemeId,
    codeBlockThemeId, setCodeBlockThemeId,
  } = useSettingsStore();

  return (
    <div>
      <SettingsSelect label="外观模式" value={editorColorMode}
        options={EDITOR_COLOR_MODE_OPTIONS} onChange={setEditorColorMode} />
      <SettingsSelect label="文档主题" value={editorThemeId}
        options={EDITOR_THEME_OPTIONS} onChange={setEditorThemeId} />
      <p className="text-[10px] text-gray-400 -mt-2 mb-4 leading-snug">
        文档主题主要作用于全屏（WYSIWYG）模式；源码模式按外观模式切换浅色/深色。
      </p>
      <SettingsSelect label="代码块语法高亮" value={codeBlockThemeId}
        options={CODE_BLOCK_THEME_OPTIONS} onChange={setCodeBlockThemeId} />
      <p className="text-[10px] text-gray-400 -mt-2 mb-4 leading-snug">
        代码块语法主题与编辑器明/暗独立，可自由组合。
      </p>
    </div>
  );
}

export { SettingsSelect };
