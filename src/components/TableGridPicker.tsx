import { useState, useRef, useEffect } from 'react';
import { Table } from 'lucide-react';

const MAX_COLS = 8;
const MAX_ROWS = 6;

interface TableGridPickerProps {
  onSelect: (cols: number, rows: number) => void;
}

export function TableGridPicker({ onSelect }: TableGridPickerProps) {
  const [open, setOpen] = useState(false);
  const [hoverCol, setHoverCol] = useState(0);
  const [hoverRow, setHoverRow] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-7 h-7 rounded text-gray-600 hover:bg-gray-100 transition-colors"
        title="插入表格"
      >
        <Table size={14} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 p-2">
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)`,
            }}
            onMouseLeave={() => {
              setHoverCol(0);
              setHoverRow(0);
            }}
          >
            {Array.from({ length: MAX_ROWS }, (_, row) =>
              Array.from({ length: MAX_COLS }, (_, col) => {
                const isHighlighted = col < hoverCol && row < hoverRow;
                return (
                  <div
                    key={`${row}-${col}`}
                    className={`w-4 h-4 border rounded-sm cursor-pointer transition-colors ${
                      isHighlighted
                        ? 'bg-blue-200 border-blue-400'
                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                    }`}
                    onMouseEnter={() => {
                      setHoverCol(col + 1);
                      setHoverRow(row + 1);
                    }}
                    onClick={() => {
                      onSelect(col + 1, row + 1);
                      setOpen(false);
                      setHoverCol(0);
                      setHoverRow(0);
                    }}
                  />
                );
              }),
            )}
          </div>
          <div className="text-center text-xs text-gray-500 mt-1.5">
            {hoverCol > 0 && hoverRow > 0
              ? `${hoverCol} × ${hoverRow}`
              : '选择表格大小'}
          </div>
        </div>
      )}
    </div>
  );
}
