import styles from "./logo-mark.module.css";

/** Знак Timely: слайм в скруглённом квадрате. Изредка моргает. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`${styles.mark} ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className={styles.tile} width="64" height="64" rx="16" />
      <path
        className={styles.body}
        d="M11 42C11 25 21 17 32 17C43 17 53 25 53 42C53 48 49.5 51 44 51H20C14.5 51 11 48 11 42Z"
      />
      <g className={styles.eyes}>
        <ellipse cx="25.5" cy="33" rx="3.6" ry="4.9" transform="rotate(-8 25.5 33)" />
        <ellipse cx="38.5" cy="33" rx="3.8" ry="5.1" transform="rotate(8 38.5 33)" />
      </g>
    </svg>
  );
}
