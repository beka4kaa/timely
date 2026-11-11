// Двенадцать рисунков плашек контеста. Цвет идёт от плашки, то есть от тира,
// поэтому здесь только контуры в currentColor. Один мотив на рисунок: на билете он
// крупный справа, на карточке в углу, на маленькой плашке сверху. Слайм сидит на
// мотиве только у билета и карточки.

import type { ReactNode } from "react";

import type { ContestArtName } from "@/lib/contest-api";

export type ArtSize = "hero" | "card" | "mini";

function grid(): ReactNode {
  const on = new Set([0, 1, 4, 6, 9, 10, 11, 14]);
  return (
    <g fill="currentColor">
      {Array.from({ length: 16 }, (_, index) => (
        <rect
          key={index}
          x={14 + (index % 4) * 20}
          y={14 + Math.floor(index / 4) * 20}
          width="14"
          height="14"
          rx="4"
          opacity={on.has(index) ? 0.9 : 0.3}
        />
      ))}
    </g>
  );
}

function hexagon(cx: number, cy: number): string {
  return `M${cx} ${cy - 13}l11.3 6.5v13L${cx} ${cy + 13}l-11.3-6.5v-13Z`;
}

/** Мотив в квадрате 92×92 и точка, где сидит слайм. */
const MOTIFS: Record<ContestArtName, { spin?: boolean; slime: [number, number]; draw: () => ReactNode }> = {
  rings: {
    spin: true,
    slime: [46, 46],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" transform="rotate(-90 46 46)">
        <circle cx="46" cy="46" r="38" pathLength={100} strokeDasharray="64 100" opacity="0.5" />
        <circle cx="46" cy="46" r="26" pathLength={100} strokeDasharray="42 100" opacity="0.7" />
        <circle cx="46" cy="46" r="14" pathLength={100} strokeDasharray="80 100" opacity="0.9" />
      </g>
    ),
  },
  throw: {
    slime: [46, 36],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6">
        <path d="M6 80Q46 -4 86 80" opacity="0.95" />
        <path d="M6 80Q26 -30 46 80" opacity="0.5" />
        <path d="M6 80Q40 40 74 80" opacity="0.65" />
        <path d="M0 80H92" opacity="0.45" />
      </g>
    ),
  },
  orbits: {
    spin: true,
    slime: [46, 46],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 46 46)">
        <circle cx="46" cy="46" r="38" pathLength={96} strokeDasharray="0 8" opacity="0.55" />
        <circle cx="46" cy="46" r="24" pathLength={64} strokeDasharray="0 8" opacity="0.85" />
      </g>
    ),
  },
  waves: {
    slime: [46, 44],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path d="M0 34q11.5-16 23 0t23 0 23 0 23 0" opacity="0.45" />
        <path d="M0 52q11.5-16 23 0t23 0 23 0 23 0" opacity="0.7" />
        <path d="M0 70q11.5-16 23 0t23 0 23 0 23 0" opacity="0.95" />
      </g>
    ),
  },
  sun: {
    spin: true,
    slime: [66, 66],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <circle cx="66" cy="66" r="13" opacity="0.95" />
        <path d="M66 43V28M50 50 39 39M43 66H28M82 50l11-11M50 82 39 93" opacity="0.6" />
        <path d="M57 45 52 31M45 57 31 52M75 45l5-14" opacity="0.38" />
      </g>
    ),
  },
  grid: { slime: [41, 41], draw: grid },
  cells: {
    slime: [67, 49],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        <path d={hexagon(56, 30)} opacity="0.45" />
        <path d={hexagon(78.5, 30)} opacity="0.6" />
        <path d={hexagon(44.7, 49.5)} opacity="0.6" />
        <path d={hexagon(67.3, 49.5)} opacity="0.95" />
        <path d={hexagon(56, 69)} opacity="0.75" />
        <path d={hexagon(78.6, 69)} opacity="0.45" />
      </g>
    ),
  },
  stars: {
    slime: [72, 34],
    draw: () => (
      <>
        <path d="M18 72 36 54l20 8 16-28 12-14M56 62l22 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
        <g fill="currentColor">
          <circle cx="18" cy="72" r="3.4" opacity="0.7" />
          <circle cx="36" cy="54" r="4" />
          <circle cx="56" cy="62" r="3.4" opacity="0.8" />
          <circle cx="72" cy="34" r="5" />
          <circle cx="84" cy="20" r="3" opacity="0.7" />
          <circle cx="78" cy="78" r="3.4" opacity="0.8" />
        </g>
      </>
    ),
  },
  triangles: {
    slime: [58, 62],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round">
        <path d="M58 14 96 82H20Z" opacity="0.4" />
        <path d="M58 32 82 74H34Z" opacity="0.65" />
        <path d="M58 50 68 68H48Z" opacity="0.95" />
      </g>
    ),
  },
  spiral: {
    spin: true,
    slime: [60, 52],
    draw: () => (
      <path
        d="M60 50a3 3 0 0 1 3 3 5 5 0 0 1-5 5 8 8 0 0 1-8-8 13 13 0 0 1 13-13 21 21 0 0 1 21 21 34 34 0 0 1-34 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    ),
  },
  steps: {
    slime: [81, 12],
    draw: () => (
      <g fill="currentColor">
        <rect x="14" y="66" width="14" height="22" rx="4" opacity="0.4" />
        <rect x="34" y="52" width="14" height="36" rx="4" opacity="0.6" />
        <rect x="54" y="36" width="14" height="52" rx="4" opacity="0.8" />
        <rect x="74" y="18" width="14" height="70" rx="4" />
      </g>
    ),
  },
  code: {
    slime: [57, 50],
    draw: () => (
      <g fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 34 22 50l18 16" opacity="0.75" />
        <path d="M74 34l18 16-18 16" opacity="0.75" />
        <path d="M64 22 52 80" opacity="0.95" />
      </g>
    ),
  },
};

export function ContestArt({ art, size }: { art: ContestArtName | string; size: ArtSize }) {
  const motif = MOTIFS[art as ContestArtName] ?? MOTIFS.rings;
  const [x, y] = motif.slime;
  return (
    <svg className={`plq-art art-${size}`} viewBox="0 0 92 92" aria-hidden="true">
      {motif.spin ? <g className="spin">{motif.draw()}</g> : motif.draw()}
      {size === "mini" ? null : <use href="#art-slime" x={x - 10} y={y - 7} width="20" height="14" />}
    </svg>
  );
}
