import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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
  // 整组只留一个 Tab 停靠点：默认停在当前值，方向键移动时跟随焦点。
  const [stop, setStop] = useState<T | null>(null);
  const stopValue =
    stop !== null && options.some((option) => option.value === stop)
      ? stop
      : value;

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

  /** ←/→ 在组内移焦点，Home / End 到首尾；回车才真正切换，扫过时不会误改视图。 */
  const handleKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + delta + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={groupRef}
      className={`segmented sliding-segmented ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={handleKeys}
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
            tabIndex={option.value === stopValue ? 0 : -1}
            onFocus={() => setStop(option.value)}
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
