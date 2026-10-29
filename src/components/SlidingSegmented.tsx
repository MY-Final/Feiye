import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

interface SlidingSegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  ariaLabel: string;
  className?: string;
  onChange(value: T): void;
}

interface Thumb {
  left: number;
  width: number;
  ready: boolean;
}

const EMPTY_THUMB: Thumb = { left: 0, width: 0, ready: false };

/** 量出当前项的位置，用一块会滑动的底色代替静态的 active 背景。 */
export function SlidingSegmented<T extends string>({
  options,
  value,
  ariaLabel,
  className = "",
  onChange,
}: SlidingSegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb>(EMPTY_THUMB);

  const measure = useCallback(() => {
    const group = groupRef.current;
    const active = group?.querySelector<HTMLButtonElement>(
      'button[data-active="true"]',
    );
    if (!group || !active) return;
    setThumb({
      left: active.offsetLeft,
      width: active.offsetWidth,
      ready: true,
    });
  }, []);

  useLayoutEffect(measure, [measure, value, options.length]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const observer = new ResizeObserver(measure);
    observer.observe(group);
    window.addEventListener("resize", measure);
    // 字体加载完成后按钮宽度可能变化，再量一次。
    void document.fonts?.ready.then(measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div
      ref={groupRef}
      className={`segmented sliding-segmented ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <span
        className="segmented-thumb"
        aria-hidden="true"
        style={{
          opacity: thumb.ready ? 1 : 0,
          width: thumb.width,
          transform: `translateX(${thumb.left}px)`,
        }}
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-active={active ? "true" : undefined}
            className={active ? "active" : ""}
            title={option.title}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
