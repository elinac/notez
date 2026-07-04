import { useSettingsStore } from '../../store/useSettingsStore';
import { SHOW_PLANTUML_BACKEND_SWITCH } from '../../constants/buildFlags';
import { DEFAULT_PLANTUML_THEME, PLANTUML_THEME_OPTIONS } from '../../constants/plantumlThemes';
import { SettingsSelect } from './AppearanceSettings';
import { ChevronDown } from 'lucide-react';

function PlantUmlBackendSwitch() {
  const { plantUmlBackend, setPlantUmlBackend } = useSettingsStore();
  return (
    <div className="mb-4">
      <label className="block text-xs text-gray-500 mb-1.5">渲染引擎</label>
      <div className="relative">
        <select value={plantUmlBackend}
          onChange={(e) => setPlantUmlBackend(e.target.value === 'rust' ? 'rust' : 'jar')}
          className="w-full max-w-xs px-2.5 py-1.5 border border-gray-200 rounded text-xs appearance-none pr-7 bg-white">
          <option value="jar">JAR（随包 JVM，默认）</option>
          <option value="rust">Rust（实验性，序列图子集）</option>
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
        Rust 引擎不支持全部语法且不会自动回退到 JAR；出错时请切回 JAR 或查阅文档中的子集说明。
      </p>
    </div>
  );
}

export function PlantUmlSettings() {
  const { plantUmlTheme, setPlantUmlTheme } = useSettingsStore();
  const themeValue = PLANTUML_THEME_OPTIONS.some((o) => o.value === plantUmlTheme)
    ? plantUmlTheme : DEFAULT_PLANTUML_THEME;

  return (
    <div>
      {SHOW_PLANTUML_BACKEND_SWITCH && <PlantUmlBackendSwitch />}
      <SettingsSelect
        label="图表主题（图源中已写 !theme 时优先生效）"
        value={themeValue} options={PLANTUML_THEME_OPTIONS} onChange={setPlantUmlTheme} />
    </div>
  );
}
