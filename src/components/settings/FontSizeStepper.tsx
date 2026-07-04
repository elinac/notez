import { useState, useCallback } from 'react';
import { Minus, Plus } from 'lucide-react';
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../constants/fontDefaults';

interface Props {
  value: number;
  onChange: (size: number) => void;
}

function clampSize(v: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));
}

export function FontSizeStepper({ value, onChange }: Props) {
  const [inputValue, setInputValue] = useState(String(value));

  const handleBlur = useCallback(() => {
    const n = parseInt(inputValue, 10);
    if (isNaN(n)) {
      setInputValue(String(value));
    } else {
      const clamped = clampSize(n);
      setInputValue(String(clamped));
      if (clamped !== value) onChange(clamped);
    }
  }, [inputValue, value, onChange]);

  const step = (delta: number) => {
    const next = clampSize(value + delta);
    setInputValue(String(next));
    onChange(next);
  };

  return (
    <div className="flex items-center border border-gray-200 rounded overflow-hidden">
      <button onClick={() => step(-1)} disabled={value <= FONT_SIZE_MIN}
        className="px-1.5 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 border-r border-gray-200">
        <Minus size={12} />
      </button>
      <input
        className="w-10 text-center text-xs py-1 outline-none bg-white"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === 'Enter') handleBlur(); }}
      />
      <button onClick={() => step(1)} disabled={value >= FONT_SIZE_MAX}
        className="px-1.5 py-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 border-l border-gray-200">
        <Plus size={12} />
      </button>
      <span className="text-[10px] text-gray-400 px-1">px</span>
    </div>
  );
}
