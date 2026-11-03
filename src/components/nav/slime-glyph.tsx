import { useId } from "react";

import styles from "./slime-glyph.module.css";

// Слайм-значок: тот же силуэт, что у живого слайма лендинга, но неподвижный.
//
// Живой `Slime` крутит свой rAF-цикл, пока виден; в рейле, нижней панели и на
// кнопках он стоял бы на экране постоянно и грел бы процессор ради значка
// размером с палец. Живым остаётся один — тот, что сидит на карточке «Сейчас».

const BODY =
  "M26 160C26 98 58 72 120 72C182 72 214 98 214 160C214 194 188 204 166 204L74 204C52 204 26 194 26 160Z";

export function SlimeGlyph({ className = "" }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `sg-${name}-${uid}`;

  return (
    <svg
      viewBox="16 62 208 162"
      className={`${styles.glyph} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={id("body")} cx="0.34" cy="0.24" r="0.92">
          <stop offset="0" style={{ stopColor: "var(--slime-hi)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--slime-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--slime-lo)" }} />
        </radialGradient>
        <radialGradient id={id("sheen")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("eye")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.35" style={{ stopColor: "var(--slime-eye)" }} />
          <stop offset="1" style={{ stopColor: "var(--slime-eye-shade)" }} />
        </linearGradient>
        <radialGradient id={id("shadow")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("clip")}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <ellipse cx="120" cy="212" rx="92" ry="12" fill={`url(#${id("shadow")})`} />
      <path d={BODY} fill={`url(#${id("body")})`} />
      <g clipPath={`url(#${id("clip")})`}>
        <ellipse
          cx="104"
          cy="92"
          rx="78"
          ry="44"
          fill={`url(#${id("sheen")})`}
          style={{ opacity: "var(--slime-sheen)" }}
        />
        <ellipse cx="120" cy="230" rx="112" ry="40" style={{ fill: "var(--slime-rim)" }} />
      </g>
      <ellipse
        cx="76"
        cy="100"
        rx="19"
        ry="8.5"
        transform="rotate(-30 76 100)"
        fill="#ffffff"
        style={{ opacity: "var(--slime-gloss)" }}
      />
      <circle cx="98" cy="86" r="3.6" fill="#ffffff" style={{ opacity: "var(--slime-gloss)" }} />
      <ellipse cx="121" cy="164" rx="6.5" ry="4.8" style={{ fill: "var(--slime-eye)" }} />
      <ellipse
        cx="95"
        cy="130"
        rx="15"
        ry="20"
        transform="rotate(-8 95 130)"
        fill={`url(#${id("eye")})`}
      />
      <ellipse
        cx="146"
        cy="130"
        rx="15.5"
        ry="20.5"
        transform="rotate(8 146 130)"
        fill={`url(#${id("eye")})`}
      />
    </svg>
  );
}
