import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { EDITOR_COLOR_MODE_OPTIONS, EDITOR_THEME_OPTIONS } from '../../constants/editorThemes';
import { CODE_BLOCK_THEME_OPTIONS } from '../../constants/codeBlockThemes';
import { FontPicker } from './FontPicker';
import { FontSizeStepper } from './FontSizeStepper';
import { RECOMMENDED_FONTS } from '../../constants/fontDefaults';

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
    uiFontConfig, setUiFontConfig,
    editorFontConfig, setEditorFontConfig,
    codeBlockFontConfig, setCodeBlockFontConfig,
    systemFonts, loadSystemFonts,
  } = useSettingsStore();

  useEffect(() => { loadSystemFonts(); }, [loadSystemFonts]);

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

      <div className="border-t border-gray-200 pt-4 mt-4">
        <h3 className="text-xs font-semibold text-gray-700 mb-3">字体设置</h3>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1.5">应用界面字体</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 max-w-[200px]">
              <FontPicker value={uiFontConfig.fontFamily} onChange={(f) => setUiFontConfig({ ...uiFontConfig, fontFamily: f })}
                recommended={RECOMMENDED_FONTS.ui} systemFonts={systemFonts} />
            </div>
            <FontSizeStepper value={uiFontConfig.fontSize} onChange={(s) => setUiFontConfig({ ...uiFontConfig, fontSize: s })} />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1.5">编辑器字体</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 max-w-[200px]">
              <FontPicker value={editorFontConfig.fontFamily} onChange={(f) => setEditorFontConfig({ ...editorFontConfig, fontFamily: f })}
                recommended={RECOMMENDED_FONTS.editor} systemFonts={systemFonts} />
            </div>
            <FontSizeStepper value={editorFontConfig.fontSize} onChange={(s) => setEditorFontConfig({ ...editorFontConfig, fontSize: s })} />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1.5">代码块字体</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 max-w-[200px]">
              <FontPicker value={codeBlockFontConfig.fontFamily} onChange={(f) => setCodeBlockFontConfig({ ...codeBlockFontConfig, fontFamily: f })}
                recommended={RECOMMENDED_FONTS.code} systemFonts={systemFonts} />
            </div>
            <FontSizeStepper value={codeBlockFontConfig.fontSize} onChange={(s) => setCodeBlockFontConfig({ ...codeBlockFontConfig, fontSize: s })} />
          </div>
        </div>
      </div>
    </div>
  );
}

export { SettingsSelect };
