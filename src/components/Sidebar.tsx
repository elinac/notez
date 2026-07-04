/**
 * Sidebar — narrow icon rail on the left edge of the app.
 * Each button toggles a panel or switches the active view.
 */
import { FolderOpen, LayoutGrid, Sparkles, Settings } from 'lucide-react';
import { useAppStore, SidebarPanel, RightPanel } from '../store/useAppStore';

type SidebarItemId = SidebarPanel | 'board' | 'ai' | 'settings';

interface SidebarItem {
  id: SidebarItemId;
  icon: React.ReactNode;
  label: string;
  title: string;
  side?: 'right';
  /** If true, render at the bottom of the rail */
  bottom?: boolean;
}

const ITEMS: SidebarItem[] = [
  {
    id: 'files',
    icon: <FolderOpen size={18} />,
    label: '文件',
    title: '文件管理',
  },
  {
    id: 'board',
    icon: <LayoutGrid size={18} />,
    label: '看板',
    title: '任务看板',
  },
  {
    id: 'ai',
    icon: <Sparkles size={18} />,
    label: 'AI',
    title: 'AI 助手',
    side: 'right',
  },
  {
    id: 'settings',
    icon: <Settings size={16} />,
    label: '设置',
    title: 'AI 设置',
    side: 'right',
    bottom: true,
  },
];

export function Sidebar() {
  const {
    sidebarPanel,
    setSidebarPanel,
    rightPanel,
    setRightPanel,
    activeView,
    setActiveView,
    settingsDialogOpen,
    toggleSettingsDialog,
    tasks,
  } = useAppStore();

  const pendingCount = tasks.filter((t) => !t.completed).length;

  const handleClick = (item: SidebarItem) => {
    if (item.id === 'board') {
      setActiveView('board');
      if (sidebarPanel === 'files') setSidebarPanel(null);
    } else if (item.id === 'settings') {
      toggleSettingsDialog();
    } else if (item.side === 'right') {
      const panelId = item.id as RightPanel;
      setRightPanel(rightPanel === panelId ? null : panelId);
    } else {
      const panelId = item.id as SidebarPanel;
      setSidebarPanel(sidebarPanel === panelId ? null : panelId);
      if (activeView === 'board') setActiveView('editor');
    }
  };

  const isActive = (item: SidebarItem) => {
    if (item.id === 'board') return activeView === 'board';
    if (item.id === 'settings') {
      return settingsDialogOpen;
    }
    if (item.side === 'right') return rightPanel === item.id;
    return sidebarPanel === item.id;
  };

  const topItems = ITEMS.filter((i) => !i.bottom);
  const bottomItems = ITEMS.filter((i) => i.bottom);

  const renderItem = (item: SidebarItem) => (
    <div key={item.id} className="relative">
      <button
        onClick={() => handleClick(item)}
        title={item.title}
        className={`flex flex-col items-center justify-center w-8 h-8 rounded transition-colors ${
          isActive(item)
            ? 'notez-sidebar-active'
            : 'text-gray-500 hover:bg-gray-200/80 hover:text-gray-700'
        }`}
      >
        {item.icon}
      </button>
      {item.id === 'board' && pendingCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center text-[9px] font-bold bg-red-500 text-white rounded-full px-0.5 pointer-events-none">
          {pendingCount > 99 ? '99+' : pendingCount}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center w-10 notez-sidebar-rail notez-chrome border-r border-gray-200 py-2 flex-shrink-0">
      {/* Top items */}
      <div className="flex flex-col items-center gap-1">
        {topItems.map(renderItem)}
      </div>
      {/* Spacer */}
      <div className="flex-1" />
      {/* Bottom items */}
      <div className="flex flex-col items-center gap-1">
        {bottomItems.map(renderItem)}
      </div>
    </div>
  );
}
