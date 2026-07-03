import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { PANEL_RESIZE_GUTTER_PX } from '../utils/panelWidth';

interface PanelResizeHandleProps {
  'aria-label': string;
  onDrag: (clientX: number) => void;
}

export function PanelResizeHandle({ 'aria-label': ariaLabel, onDrag }: PanelResizeHandleProps) {
  const draggingRef = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onDrag(e.clientX);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="group relative flex h-full flex-shrink-0 cursor-col-resize select-none justify-center bg-transparent touch-none"
      style={{ width: PANEL_RESIZE_GUTTER_PX }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="pointer-events-none h-full w-px bg-gray-200 transition-colors group-hover:bg-blue-400 group-active:bg-blue-500"
        aria-hidden
      />
    </div>
  );
}
