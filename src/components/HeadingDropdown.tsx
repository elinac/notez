import { useState, useRef, useEffect } from 'react';
import { Heading, ChevronDown } from 'lucide-react';

const HEADING_OPTIONS = [
  { level: 0, label: '正文', display: '正文' },
  { level: 1, label: 'H1', display: 'H1' },
  { level: 2, label: 'H2', display: 'H2' },
  { level: 3, label: 'H3', display: 'H3' },
  { level: 4, label: 'H4', display: 'H4' },
  { level: 5, label: 'H5', display: 'H5' },
  { level: 6, label: 'H6', display: 'H6' },
] as const;

interface HeadingDropdownProps {
  currentLevel: number;
  onSelect: (level: number) => void;
}

export function HeadingDropdown({ currentLevel, onSelect }: HeadingDropdownProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const currentLabel = currentLevel > 0 ? `H${currentLevel}` : '正文';

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-0.5 px-1.5 h-7 rounded text-xs font-medium transition-colors ${
          currentLevel > 0
            ? 'bg-blue-100 text-blue-600'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        title="标题级别"
      >
        <Heading size={14} />
        <span className="min-w-[1.5rem] text-center">{currentLabel}</span>
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1 min-w-[5rem]">
          {HEADING_OPTIONS.map(({ level, display }) => (
            <button
              key={level}
              onClick={() => {
                onSelect(level);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                currentLevel === level
                  ? 'bg-blue-50 text-blue-600 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className={level > 0 ? 'font-bold' : ''}>{display}</span>
              {level > 0 && (
                <span className="ml-2 text-gray-400">{'#'.repeat(level)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
