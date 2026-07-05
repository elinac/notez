import { Monitor, Sparkles, FileCode, Info } from 'lucide-react';
import type { SettingsCategory } from './settingsTypes';

const CATEGORIES: { id: SettingsCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <Monitor size={16} /> },
  { id: 'ai', label: 'AI 服务', icon: <Sparkles size={16} /> },
  { id: 'plantuml', label: 'PlantUML', icon: <FileCode size={16} /> },
  { id: 'about', label: '关于', icon: <Info size={16} /> },
];

interface Props {
  active: SettingsCategory;
  onChange: (cat: SettingsCategory) => void;
}

export function SettingsSidebar({ active, onChange }: Props) {
  return (
    <nav className="w-[180px] flex-shrink-0 border-r border-gray-200 bg-gray-50 py-3">
      <div className="px-4 mb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
        设置
      </div>
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors ${
            active === cat.id
              ? 'bg-blue-50 text-blue-600 border-l-2 border-blue-500'
              : 'text-gray-600 hover:bg-gray-100 border-l-2 border-transparent'
          }`}
        >
          {cat.icon}
          {cat.label}
        </button>
      ))}
    </nav>
  );
}
