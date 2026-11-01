type BrandMarkProps = {
  size?: number;
  className?: string;
};

/**
 * 应用标识：一页纸，右缘开成门扇。
 * 与应用图标同一图形，只保留轮廓；正文线与书签在 18px 下会糊掉，故省略。
 */
export function BrandMark({ size = 18, className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="18" height="18" rx="3" fill="var(--accent)" />
      <rect x="4" y="3" width="7.4" height="12" rx="0.9" fill="var(--on-accent)" />
      <path d="M11.4 3 14.2 4.3v9.4L11.4 15Z" fill="var(--on-accent)" opacity="0.72" />
    </svg>
  );
}
