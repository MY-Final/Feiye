import { useEffect, useRef, useState } from "react";

export const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.25;
const MAX_SPLIT_RATIO = 0.75;

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

interface SplitHandleProps {
  ratio: number;
  onChange(ratio: number): void;
  onCommit(ratio: number): void;
}

interface DragState {
  pointerId: number;
  left: number;
  width: number;
  offset: number;
}

/** 编辑区与预览区之间的拖拽条；双击回到等分。 */
export function SplitHandle({ ratio, onChange, onCommit }: SplitHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const latestRatio = useRef(ratio);
  const [dragging, setDragging] = useState(false);

  latestRatio.current = ratio;

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-resizing-split");
    };
  }, []);

  const finishDrag = (element: HTMLDivElement, pointerId?: number) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    document.body.classList.remove("is-resizing-split");
    if (pointerId !== undefined && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    onCommit(latestRatio.current);
  };

  return (
    <div
      ref={handleRef}
      className={`split-handle${dragging ? " dragging" : ""}`}
      role="separator"
      aria-label="调整编辑区与预览区宽度"
      aria-orientation="vertical"
      aria-valuemin={Math.round(MIN_SPLIT_RATIO * 100)}
      aria-valuemax={Math.round(MAX_SPLIT_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      title="拖动调整宽度，双击恢复等分"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const main = event.currentTarget.parentElement;
        if (!main) return;
        event.preventDefault();
        const rect = main.getBoundingClientRect();
        const handleRect = event.currentTarget.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          left: rect.left,
          width: rect.width,
          offset: event.clientX - handleRect.left,
        };
        setDragging(true);
        document.body.classList.add("is-resizing-split");
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || drag.width <= 0) {
          return;
        }
        const next = clampSplitRatio(
          (event.clientX - drag.offset - drag.left) / drag.width,
        );
        if (next === latestRatio.current) return;
        latestRatio.current = next;
        onChange(next);
      }}
      onPointerUp={(event) => finishDrag(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) =>
        finishDrag(event.currentTarget, event.pointerId)
      }
      onLostPointerCapture={(event) => finishDrag(event.currentTarget)}
      onDoubleClick={() => {
        latestRatio.current = DEFAULT_SPLIT_RATIO;
        onChange(DEFAULT_SPLIT_RATIO);
        onCommit(DEFAULT_SPLIT_RATIO);
      }}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === "ArrowLeft") next = ratio - 0.02;
        else if (event.key === "ArrowRight") next = ratio + 0.02;
        else if (event.key === "Home") next = MIN_SPLIT_RATIO;
        else if (event.key === "End") next = MAX_SPLIT_RATIO;
        if (next === null) return;
        event.preventDefault();
        const clamped = clampSplitRatio(next);
        latestRatio.current = clamped;
        onChange(clamped);
        onCommit(clamped);
      }}
    />
  );
}
