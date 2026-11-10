import styles from "./logo-mark.module.css";

/**
 * Знак Timely: слайм в скруглённом квадрате. Лицо то же, что у маскота в приложении
 * и у значка в его боковой панели: глаза-дуги и румянец.
 */
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
      <ellipse className={styles.blush} cx="18.4" cy="38.6" rx="3.7" ry="2.3" />
      <ellipse className={styles.blush} cx="45.6" cy="38.6" rx="3.7" ry="2.3" />
      <path className={styles.eyes} d="M21.2 34.4Q25 29.6 28.8 34.4M35.2 34.4Q39 29.6 42.8 34.4" />
    </svg>
  );
}
