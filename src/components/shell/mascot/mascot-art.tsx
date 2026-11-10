"use client";

import { useId } from "react";

// Рисунок слайма. Один и тот же для маскота в приложении и для слаймов на лендинге и
// страницах входа: форму, лицо и блики в каждом кадре дописывает движок (engine.ts),
// находя части по data-m. Цвета — в styles/timely/mascot-art.css.

/** Рамка приложения: вокруг тела запас для прыжков, сердечек и плашки над головой. */
export const MASCOT_VIEWBOX = "0 0 240 220";

/**
 * Рамка по самому телу, как у значка в боковой панели. Для слайма, который стоит в
 * вёрстке страницы: ширина места — это ширина слайма. Прыжки и брызги рисуются за
 * рамкой (overflow: visible).
 */
export const STAGE_VIEWBOX = "34 78 172 128";

export function MascotArt({ viewBox = MASCOT_VIEWBOX }: { viewBox?: string }) {
  // Слаймов на странице бывает несколько, а у каждого свой контур для обрезки.
  // Двоеточия из useId ломают ссылки url(#…), поэтому оставляем только буквы и цифры.
  const uid = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg className="mascot-art" viewBox={viewBox} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path data-m="clip" />
        </clipPath>
        <linearGradient id={`${uid}-lit`} x1="0.18" y1="0" x2="0.72" y2="1">
          <stop className="m-lit-a" offset="0" />
          <stop className="m-lit-b" offset="0.42" />
          <stop className="m-lit-c" offset="1" />
        </linearGradient>
        <radialGradient id={`${uid}-aura`} cx="0.5" cy="0.5" r="0.5">
          <stop className="m-aura-a" offset="0" />
          <stop className="m-aura-b" offset="1" />
        </radialGradient>
        <radialGradient id={`${uid}-floor`} cx="0.5" cy="0.5" r="0.5">
          <stop className="m-floor-a" offset="0" />
          <stop className="m-floor-b" offset="1" />
        </radialGradient>
      </defs>
      <ellipse className="m-aura" data-m="aura" cx="120" cy="140" rx="112" ry="84" fill={`url(#${uid}-aura)`} />
      <ellipse className="m-floor" data-m="floor" cx="120" cy="198" rx="74" ry="9" fill={`url(#${uid}-floor)`} />
      <g data-m="all">
        <path className="m-body" data-m="body" />
        <g clipPath={`url(#${uid}-clip)`}>
          <path className="m-lit" data-m="lit" fill={`url(#${uid}-lit)`} />
          <path className="m-core" data-m="core" />
          <path className="m-rim" data-m="rim" />
          <g className="m-gloss" data-m="gloss">
            <ellipse cx="-40" cy="-84" rx="17" ry="8.8" transform="rotate(-28 -40 -84)" />
            <ellipse cx="-12" cy="-99" rx="4.6" ry="3" transform="rotate(-8 -12 -99)" />
          </g>
        </g>
        <g data-m="face">
          <g className="m-blush" data-m="blush">
            <g transform="translate(-56 14)">
              <ellipse className="m-blush-fill" rx="10.5" ry="6.4" />
              <path className="m-blush-hatch" d="M-5.5 3.2 -2.6 -3.2M-1.4 3.2 1.4 -3.2M2.6 3.2 5.5 -3.2" />
            </g>
            <g transform="translate(56 14)">
              <ellipse className="m-blush-fill" rx="10.5" ry="6.4" />
              <path className="m-blush-hatch" d="M-5.5 3.2 -2.6 -3.2M-1.4 3.2 1.4 -3.2M2.6 3.2 5.5 -3.2" />
            </g>
          </g>
          <path className="m-eye" data-m="eyeL" />
          <path className="m-eye" data-m="eyeR" />
          <path className="m-lash" data-m="lash" />
          <path className="m-mouth" data-m="mouth" />
          <ellipse className="m-o" data-m="o" cx="0" cy="17" rx="3.4" ry="4.2" />
        </g>
      </g>
      <g className="m-fx" data-m="fx" />
    </svg>
  );
}
