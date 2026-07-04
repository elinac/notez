import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search } from 'lucide-react';

interface Props {
  value: string;
  onChange: (fontFamily: string) => void;
  recommended: readonly string[];
  systemFonts: string[];
}

export function FontPicker({ value, onChange, recommended, systemFonts }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const lowerSearch = search.toLowerCase();
  const filteredRecommended = useMemo(
    () => recommended.filter((f) => f.toLowerCase().includes(lowerSearch)),
    [recommended, lowerSearch],
  );
  const filteredSystem = useMemo(
    () => systemFonts
      .filter((f) => !recommended.includes(f))
      .filter((f) => f.toLowerCase().includes(lowerSearch)),
    [systemFonts, recommended, lowerSearch],
  );

  const displayName = value.replace(/^"(.*)".*$/, '$1').split(',')[0].trim().replace(/^["']|["']$/g, '');

  const select = (font: string) => {
    onChange(font);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-white hover:border-gray-300"
        style={{ fontFamily: value }}>
        <span className="truncate">{displayName}</span>
        <ChevronDown size={12} className="text-gray-400 flex-shrink-0 ml-1" />
      </button>

      {open && (
        <div className="absolute z-10 top-full left-0 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded text-xs">
              <Search size={12} className="text-gray-400" />
              <input className="flex-1 bg-transparent outline-none" placeholder="搜索字体..."
                value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="overflow-y-auto">
            {filteredRecommended.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] text-blue-500 uppercase tracking-wider font-semibold">推荐</div>
                {filteredRecommended.map((f) => (
                  <button key={f} onClick={() => select(f)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${f === displayName ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}`}
                    style={{ fontFamily: f }}>
                    {f}
                  </button>
                ))}
              </>
            )}
            {filteredSystem.length > 0 && (
              <>
                <div className="border-t border-gray-100 mx-2 my-1" />
                <div className="px-3 pt-1 pb-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">系统字体</div>
                {filteredSystem.map((f) => (
                  <button key={f} onClick={() => select(f)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${f === displayName ? 'bg-blue-50 text-blue-600' : 'text-gray-500'}`}
                    style={{ fontFamily: f }}>
                    {f}
                  </button>
                ))}
              </>
            )}
            {filteredRecommended.length === 0 && filteredSystem.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-4">无匹配字体</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
