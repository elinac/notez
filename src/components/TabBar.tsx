import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useAppStore, isFileTab } from '../store/useAppStore';
import { confirmAndCloseTabs } from '../utils/confirmCloseTabs';
import type { TabCloseAction } from '../utils/tabCloseTargets';

type TabContextMenu = { x: number; y: number; tabId: string };

export function TabBar() {
  const { tabs, activeTabId, switchTab } = useAppStore();
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const anchorIndex = contextMenu
    ? tabs.findIndex((t) => t.id === contextMenu.tabId)
    : -1;
  const onlyOne = tabs.length === 1;
  const disableClose = onlyOne;
  const disableOthers = onlyOne;
  const disableLeft = anchorIndex <= 0;
  const disableRight = anchorIndex < 0 || anchorIndex >= tabs.length - 1;

  const runAction = async (action: TabCloseAction, tabId: string) => {
    setContextMenu(null);
    await confirmAndCloseTabs(action, tabId);
  };

  return (
    <div className="flex items-end notez-tab-bar notez-chrome border-b border-gray-200 overflow-x-auto overflow-y-hidden flex-shrink-0 select-none">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;
        const title = isFileTab(tab) ? (tab.file.path ?? tab.file.title) : 'Unknown';
        const label = isFileTab(tab) ? tab.file.title : 'Unknown';
        const showDirty = isFileTab(tab) && tab.file.isDirty;

        return (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 border-r border-gray-200
              text-xs font-medium max-w-[180px] flex-shrink-0 group relative
              ${isActive
                ? 'notez-tab-active text-gray-800 border-b-2 -mb-px'
                : 'bg-transparent text-gray-500 hover:bg-white/60 hover:text-gray-700'}
            `}
            title={title}
          >
            <span className="truncate min-w-0">{label}</span>
            {showDirty && (
              <span className="text-[color:var(--notez-accent,var(--notez-accent-fallback))] text-xs flex-shrink-0">●</span>
            )}
            {!isOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void confirmAndCloseTabs('close', tab.id);
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

      {contextMenu && (
        <div
          data-native-context-menu
          className="fixed z-50 notez-panel border border-gray-200 rounded shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: '130px' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            disabled={disableClose}
            onClick={() => void runAction('close', contextMenu.tabId)}
          >
            关闭
          </MenuItem>
          <MenuItem
            disabled={disableOthers}
            onClick={() => void runAction('others', contextMenu.tabId)}
          >
            关闭其他
          </MenuItem>
          <MenuItem
            disabled={disableLeft}
            onClick={() => void runAction('left', contextMenu.tabId)}
          >
            关闭左侧
          </MenuItem>
          <MenuItem
            disabled={disableRight}
            onClick={() => void runAction('right', contextMenu.tabId)}
          >
            关闭右侧
          </MenuItem>
          <div className="border-t border-gray-100 my-1" />
          <MenuItem
            disabled={false}
            onClick={() => void runAction('all', contextMenu.tabId)}
          >
            关闭全部
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-left ${
        disabled
          ? 'text-gray-300 cursor-not-allowed'
          : 'hover:bg-gray-100 text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}
