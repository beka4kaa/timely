"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import styles from "./board-sketch.module.css";

// Брусок на наклонной плоскости, как его строит научная доска. Векторы
// «рисуются» по очереди, когда схема попадает на экран.
//
// Геометрия посчитана заранее: плоскость под углом ≈ 20.85°, центр бруска
// C = (286.8, 127.8), N — по нормали, F_тр — вверх вдоль плоскости.
export function BoardSketch({
  tone = "light",
  className,
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        svg.dataset.play = "true";
        io.disconnect();
      },
      { threshold: 0.4 },
    );
    io.observe(svg);
    return () => io.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 560 290"
      className={`${styles.sketch} ${className ?? ""}`}
      data-tone={tone}
      role="img"
      aria-label="Схема: брусок на наклонной плоскости, силы mg, N и сила трения"
    >
      <path className={styles.plane} d="M70 250 L490 250 L490 90 Z" />
      <path className={styles.arc} d="M130 250 A60 60 0 0 0 126 228.6" />
      <text className={styles.label} x="138" y="244">
        α
      </text>

      <g transform="translate(286.8 127.8) rotate(-20.85)">
        <rect className={styles.block} x="-55" y="-37" width="110" height="74" rx="9" />
      </g>

      <g className={`${styles.vector} ${styles.gravity}`} style={{ "--n": 0 } as CSSProperties}>
        <path className={styles.line} d="M286.8 127.8 L286.8 228" pathLength={1} />
        <path className={styles.head} d="M286.8 237.8 L292.8 223.8 L280.8 223.8 Z" />
        <text className={styles.label} x="298" y="232">
          mg
        </text>
      </g>
      <g className={`${styles.vector} ${styles.normal}`} style={{ "--n": 1 } as CSSProperties}>
        <path className={styles.line} d="M286.8 127.8 L254.8 43.7" pathLength={1} />
        <path className={styles.head} d="M251.2 34.4 L261.8 45.4 L250.6 49.6 Z" />
        <text className={styles.label} x="226" y="40">
          N
        </text>
      </g>
      <g className={`${styles.vector} ${styles.friction}`} style={{ "--n": 2 } as CSSProperties}>
        <path className={styles.line} d="M286.8 127.8 L361.6 99.4" pathLength={1} />
        <path className={styles.head} d="M370.9 95.8 L359.9 106.4 L355.7 95.2 Z" />
        <text className={styles.label} x="378" y="94">
          F
          <tspan className={styles.sub} dy="5">
            тр
          </tspan>
        </text>
      </g>
      <circle className={styles.center} cx="286.8" cy="127.8" r="4" />
    </svg>
  );
}
