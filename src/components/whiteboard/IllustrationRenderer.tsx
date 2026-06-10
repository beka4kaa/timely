"use client";

/**
 * IllustrationRenderer
 * ------------------------------------------------------------------
 * Рендерит макро-команду `image_with_labels` как ОДИН слоистый блок
 * (а не как разрозненные элементы доски). Строгая Z-index архитектура:
 *
 *   Контейнер  — position: relative, inline-block, width: 100%
 *   Слой 1 (10) — <img base_image_url>     : фундамент, всегда 100% ширины
 *   Слой 2 (20) — <svg> с полигонами SAM2  : opacity 0 → проявляются на :hover
 *   Слой 3 (30) — <div> подписи            : sans-serif, абсолютно по процентам
 *
 * Координаты подписей (x/y) и полигонов масок приходят в ПРОЦЕНТАХ от
 * размеров картинки (0–100), поэтому позиционируются напрямую через
 * left/top: N% и SVG viewBox="0 0 100 100" — выравнивание идеальное при
 * любом масштабе доски.
 */

import React from "react";
import { InlineMath } from "react-katex";
import "katex/dist/katex.min.css";
import type { IllustrationLabel, IllustrationMask } from "@/stores/whiteboard";

export interface IllustrationRendererProps {
  id: string;
  src: string;                       // base_image_url
  labels?: IllustrationLabel[];
  masks?: IllustrationMask[] | null;
  alt?: string;
}

/** Лейбл может нести LaTeX («$F = ma$») — рендерим его через KaTeX. */
function hasLatex(text: string): boolean {
  return /\$/.test(text);
}
function stripLatex(text: string): string {
  const s = text.trim();
  if (/^\$\$[\s\S]+\$\$$/.test(s)) return s.slice(2, -2).trim();
  if (/^\$[\s\S]+\$$/.test(s)) return s.slice(1, -1).trim();
  return s;
}

export const IllustrationRenderer: React.FC<IllustrationRendererProps> = ({
  src,
  labels = [],
  masks,
  alt = "Иллюстрация",
}) => {
  const hasMasks = Array.isArray(masks) && masks.length > 0;

  return (
    <div
      style={{
        position: "relative",
        display: "inline-block",
        width: "100%",
        lineHeight: 0, // убирает щель под inline <img>
        userSelect: "none",
      }}
    >
      {/* ── Слой 1 (база): оригинальная картинка от Banana. Всегда видна. ── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          borderRadius: 10,
        }}
      />

      {/* ── Слой 2 (маски, опционально): подсветка объектов на :hover ── */}
      {hasMasks && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 20,
            pointerEvents: "none", // контейнер «прозрачен»; полигоны включают события сами
          }}
        >
          {masks!.map((m, i) => {
            if (!Array.isArray(m.polygon) || m.polygon.length < 3) return null;
            const pts = m.polygon.map(([x, y]) => `${x},${y}`).join(" ");
            const color = m.color || "#5b8def";
            return (
              <polygon
                key={i}
                points={pts}
                className="illu-mask"
                style={{ fill: color, stroke: color }}
                // Маска — интерактивный объект (наведение/выбор). Глушим
                // всплытие, чтобы взаимодействие с объектом НЕ запускало
                // перетаскивание узла (см. DraggableBoardNode, требование #3).
                onPointerDown={(e) => e.stopPropagation()}
              >
                {m.label ? <title>{m.label}</title> : null}
              </polygon>
            );
          })}
        </svg>
      )}

      {/* ── Слой 3 (текст): подписи с эффектом «Text Halo» (как на картах) ──
          Никаких фоновых «стикеров»: тёмный текст + плотный белый ореол через
          многократный textShadow — читается и на тёмных, и на пёстрых участках. */}
      {labels.map((label, i) => {
        const { content, x, y } = label;
        return (
          <div
            key={i}
            className="absolute font-sans font-semibold text-gray-900"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 30,
              pointerEvents: "none",
              fontSize: 13,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              // Многократное повторение → плотный непрозрачный контур (имитация stroke)
              textShadow:
                "0 0 6px white, 0 0 6px white, 0 0 6px white, 0 0 6px white",
            }}
          >
            {hasLatex(content) ? <InlineMath>{stripLatex(content)}</InlineMath> : content}
          </div>
        );
      })}

      {/* Hover-поведение масок: opacity 0 → видимы при наведении на сам объект.
          pointer-events:all — чтобы полигон ловил наведение даже будучи прозрачным. */}
      <style>{`
        .illu-mask {
          fill-opacity: 0;
          stroke-opacity: 0;
          stroke-width: 0.7;
          stroke-linejoin: round;
          pointer-events: all;
          cursor: pointer;
          transition: fill-opacity 0.18s ease, stroke-opacity 0.18s ease;
        }
        .illu-mask:hover {
          fill-opacity: 0.3;
          stroke-opacity: 0.95;
        }
      `}</style>
    </div>
  );
};

export default IllustrationRenderer;
