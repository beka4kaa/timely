// Значки тиров: камни выше металлов. Аметист это друза из пяти кристаллов, алмаз огранён,
// золото, серебро и бронза это медали со звездой. Цвет здесь настоящий: значок это предмет.

import { useId } from "react";

import type { ContestTier } from "@/lib/contest-api";

const STAR =
  "M32 23 34.35 28.76 40.56 29.22 35.8 33.24 37.29 39.28 32 36 26.71 39.28 28.2 33.24 23.44 29.22 29.65 28.76Z";

const METALS: Record<3 | 4 | 5, { light: string; mid: string; dark: string; rim: string; emboss: string; sheen: number }> = {
  3: { light: "#fff3c4", mid: "#f0c04a", dark: "#b07a16", rim: "#8f6210", emboss: "#7a520c", sheen: 0.28 },
  4: { light: "#ffffff", mid: "#d3d7e0", dark: "#868d9e", rim: "#5e6474", emboss: "#4b5060", sheen: 0.35 },
  5: { light: "#ffdcbd", mid: "#cf8a52", dark: "#874b1e", rim: "#6b3812", emboss: "#5c2f0e", sheen: 0.25 },
};

function Sparkle({ x, y, size = 1, opacity = 1 }: { x: number; y: number; size?: number; opacity?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${size})`}
      d="M0 -4.7l1.3 3.4 3.4 1.3-3.4 1.3L0 4.7l-1.3-3.4-3.4-1.3 3.4-1.3Z"
      fill="#ffffff"
      opacity={opacity}
    />
  );
}

/** Кристалл с основанием в (32, 56), смотрит вверх. */
function Crystal({ id, back, tall, transform }: { id: string; back?: boolean; tall?: boolean; transform?: string }) {
  const top = tall ? 6 : back ? 26 : 22;
  const half = tall ? 7.5 : back ? 5.5 : 6;
  const shoulder = top + (tall ? 9.5 : back ? 7 : 7.5);
  const ridge = shoulder + (tall ? 4.5 : back ? 3 : 3.5);
  const outline = `M32 ${top} ${32 + half} ${shoulder}V56H${32 - half}V${shoulder}Z`;
  return (
    <g transform={transform}>
      <path d={outline} fill={`url(#${id}-${back ? "back" : "front"})`} />
      <path d={`M${32 - half} ${shoulder} 32 ${ridge}V56H${32 - half}Z`} fill="#22055f" opacity={back ? 0.25 : 0.22} />
      {back ? null : <path d={`M32 ${top} ${32 - half} ${shoulder} 32 ${ridge}Z`} fill="#ffffff" opacity={tall ? 0.5 : 0.45} />}
      <path
        d={`M${32 - half} ${shoulder} 32 ${ridge} ${32 + half} ${shoulder}M32 ${ridge}V56`}
        fill="none"
        stroke="#ffffff"
        strokeOpacity={back ? 0.4 : 0.62}
        strokeWidth="1"
      />
      <path d={outline} fill="none" stroke="#3d0f8a" strokeOpacity="0.5" strokeWidth="1" strokeLinejoin="round" />
    </g>
  );
}

function Amethyst({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-front`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#f6eaff" />
          <stop offset="0.42" stopColor="#b57df7" />
          <stop offset="1" stopColor="#5a1bbf" />
        </linearGradient>
        <linearGradient id={`${id}-back`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#d7b6ff" />
          <stop offset="0.5" stopColor="#8146d8" />
          <stop offset="1" stopColor="#3b0d8c" />
        </linearGradient>
      </defs>
      <Crystal id={id} back transform="rotate(-45 32 56)" />
      <Crystal id={id} back transform="rotate(45 32 56)" />
      <Crystal id={id} transform="translate(-8 0) rotate(-12 32 56)" />
      <Crystal id={id} transform="translate(8 0) rotate(12 32 56)" />
      <Crystal id={id} tall />
      <path d="M10 57.5c4.5-4.5 13-6.5 22-6.5s17.5 2 22 6.5c-4.5 3-13 4.5-22 4.5s-17.5-1.5-22-4.5Z" fill="#2a1d45" />
      <path d="M14 56.5c5-2.6 11-3.6 18-3.6s13 1 18 3.6" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" />
      <Sparkle x={52} y={8.7} />
      <Sparkle x={13} y={23.1} size={0.62} opacity={0.9} />
    </>
  );
}

function Diamond({ id }: { id: string }) {
  const outline = "M8 24 20 11H44L56 24 32 57Z";
  return (
    <>
      <defs>
        <linearGradient id={`${id}-dia`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#d4f0ff" />
          <stop offset="1" stopColor="#7cc2ee" />
        </linearGradient>
      </defs>
      <path d={outline} fill={`url(#${id}-dia)`} />
      <path d="M8 24H26L32 57Z" fill="#0b4a73" opacity="0.12" />
      <path d="M38 24H56L32 57Z" fill="#ffffff" opacity="0.25" />
      <path d="M20 11 26 24 32 11Z" fill="#ffffff" opacity="0.6" />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="1.1" strokeLinejoin="round">
        <path d="M8 24H56" />
        <path d="M20 11 26 24 32 11 38 24 44 11" />
        <path d="M26 24 32 57 38 24" />
      </g>
      <path d={outline} fill="none" stroke="#4f9fd0" strokeOpacity="0.7" strokeWidth="1.2" strokeLinejoin="round" />
      <Sparkle x={52} y={7.7} />
    </>
  );
}

function Medal({ id, tier }: { id: string; tier: 3 | 4 | 5 }) {
  const metal = METALS[tier];
  return (
    <>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={metal.light} />
          <stop offset="0.45" stopColor={metal.mid} />
          <stop offset="1" stopColor={metal.dark} />
        </linearGradient>
        <clipPath id={`${id}-coin`}>
          <circle cx="32" cy="32" r="26" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="26" fill={`url(#${id}-metal)`} />
      <g clipPath={`url(#${id}-coin)`}>
        <ellipse cx="22" cy="12" rx="30" ry="15" fill="#ffffff" opacity={metal.sheen} />
      </g>
      <circle cx="32" cy="32" r="26" fill="none" stroke={metal.rim} strokeOpacity="0.5" strokeWidth="1.3" />
      <circle cx="32" cy="32.7" r="19.5" fill="none" stroke={metal.emboss} strokeOpacity="0.3" strokeWidth="1.2" />
      <circle cx="32" cy="32" r="19.5" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.2" />
      <path d={STAR} fill={metal.emboss} opacity="0.35" transform="translate(0 0.9)" />
      <path d={STAR} fill="#ffffff" opacity="0.86" />
    </>
  );
}

export function TierEmblem({ tier, className }: { tier: ContestTier | number; className?: string }) {
  // У useId бывают двоеточия и кавычки-ёлочки, а ссылка url(#…) их не любит.
  const id = `te${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const known = ([1, 2, 3, 4, 5] as const).includes(tier as ContestTier) ? (tier as ContestTier) : 5;
  return (
    <svg className={className ? `emb ${className}` : "emb"} viewBox="0 0 64 64" aria-hidden="true">
      {known === 1 ? <Amethyst id={id} /> : known === 2 ? <Diamond id={id} /> : <Medal id={id} tier={known} />}
    </svg>
  );
}
