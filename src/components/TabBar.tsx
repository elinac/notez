import { X } from 'lucide-react';
import { useAppStore, isFileTab } from '../store/useAppStore';

export function TabBar() {
  const { tabs, activeTabId, switchTab, closeTab } = useAppStore();

  return (
    <div className="flex items-end notez-tab-bar notez-chrome border-b border-gray-200 overflow-x-auto overflow-y-hidden flex-shrink-0 select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;
        const title =
          tab.kind === 'settings'
            ? tab.title
            : tab.file.path ?? tab.file.title;
        const label = tab.kind === 'settings' ? tab.title : tab.file.title;
        const showDirty = isFileTab(tab) && tab.file.isDirty;

        return (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 border-r border-gray-200
              text-xs font-medium max-w-[180px] flex-shrink-0 group relative
              ${isActive
                ? 'notez-tab-active text-gray-800 border-b-2 -mb-px'
                : 'bg-transparent text-gray-500 hover:bg-white/60 hover:text-gray-700'}
            `}
            title={title}
          >
            <span className="truncate min-w-0">
              {label}
            </span>
            {showDirty && (
              <span className="text-[color:var(--notez-accent,var(--notez-accent-fallback))] text-xs flex-shrink-0">●</span>
            )}
            {!isOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={`
                  flex-shrink-0 rounded p-0.5 ml-0.5
                  ${isActive
                    ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                    : 'text-gray-300 hover:text-gray-600 hover:bg-gray-200 opacity-0 group-hover:opacity-100'}
                `}
                title="关闭标签"
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
