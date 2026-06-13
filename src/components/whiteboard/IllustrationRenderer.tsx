"use client";

/**
 * IllustrationRenderer
 * ------------------------------------------------------------------
 * Рендерит макро-команду `image_with_labels` как ОДИН слоистый блок
 * (а не как разрозненные элементы доски). Строгая Z-index архитектура:
 *
 *   Контейнер  — position: relative, inline-block, width: 100%
 *   Слой 1 (0)  — <img base_image_url>     : фундамент, всегда 100% ширины
 *   Слой 2 (10) — <svg> с полигонами SAM2  : opacity 0 → проявляются на :hover
 *   Слой 3 (20) — <div> подписи            : динамический контраст + ореол
 *
 * Координаты подписей (x/y) и полигонов масок приходят в ПРОЦЕНТАХ от
 * размеров картинки (0–100), поэтому позиционируются напрямую через
 * left/top: N% и SVG viewBox="0 0 100 100" — выравнивание идеальное при
 * любом масштабе доски.
 *
 * Контраст подписей (композитинг «как у Figure Labs»): цвет текста
 * выбирается по реальной яркости пикселей картинки под подписью
 * (offscreen-canvas сэмплирование, один раз на загрузку картинки), а
 * плотный ореол text-shadow тоном фона «прорезает» стрелки/линии,
 * запечённые в картинку под текстом. См. src/lib/illustration-contrast.ts.
 */

import React from "react";
import Latex from "react-latex-next";
import "katex/dist/katex.min.css";
import type { IllustrationLabel, IllustrationMask } from "@/stores/whiteboard";
import { useSmartLabels, contrastStylesFor } from "@/lib/illustration-contrast";

export interface IllustrationRendererProps {
  id: string;
  src: string;                       // base_image_url
  labels?: IllustrationLabel[];
  masks?: IllustrationMask[] | null;
  alt?: string;
  /** Стиль генерации (flat/2_5d/3d/sketch): sketch → рукописный шрифт подписей. */
  genStyle?: string;
}

export const IllustrationRenderer: React.FC<IllustrationRendererProps> = ({
  src,
  labels = [],
  masks,
  alt = "Иллюстрация",
  genStyle,
}) => {
  const hasMasks = Array.isArray(masks) && masks.length > 0;

  // Детерминированная раскладка подписей: позиции текста от модели игнорируем,
  // якорь — заземлённый центр объекта (arrow_to), вокруг него правила выбирают
  // чистое стабильное место (см. useSmartLabels). Один проход на загрузку src.
  const placements = useSmartLabels(src, labels);

  // Типографика: рукописный Caveat ТОЛЬКО для sketch (hand-lettering, как на
  // чернильных конспектах), остальным стилям — строгий современный sans
  // (Plus Jakarta). Подписи держим компактными: основную картинку должен вести
  // растр, а текст — быть тихим overlay-слоем.
  const handwritten = genStyle === "sketch";
  const labelFontClass = handwritten
    ? "absolute font-handwriting font-semibold"
    : "absolute font-sans font-medium";
  const labelFontSize = handwritten ? 14 : 10;

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
      {/* ── Слой 1 (z-0, база): оригинальная картинка от Banana. Всегда видна. ── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{
          position: "relative",
          zIndex: 0,
          display: "block",
          width: "100%",
          height: "auto",
          borderRadius: 10,
        }}
      />

      {/* ── Слой 2 (z-10, маски/графика): подсветка объектов на :hover ── */}
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
            zIndex: 10,
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

      {/* ── Слой 3 (z-20, текст): подписи на детерминированных позициях ──
          Позиция — из useSmartLabels (правила вокруг якоря-объекта, а не
          «куда показалось модели»), шрифт — по стилю генерации (sketch →
          рукописный Caveat, прочие → sans), цвет — по реальной яркости
          пикселей под подписью, ореол АДАПТИВНЫЙ: включается только на
          пёстром / среднесером фоне и исчезает на чистом. KaTeX-формулы
          рендерятся математическим шрифтом KaTeX, но наследуют currentColor
          и text-shadow — композитинг тот же. */}
      {labels.map((label, i) => {
        const { content } = label;
        const place = placements[i] ?? { x: label.x, y: label.y, sample: null };
        return (
          <div
            key={i}
            className={labelFontClass}
            style={{
              left: `${place.x}%`,
              top: `${place.y}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 20,
              pointerEvents: "none",
              fontSize: labelFontSize,
              lineHeight: 1.1,
              maxWidth: "30%",
              textAlign: "center",
              whiteSpace: "normal",
              ...contrastStylesFor(place.sample),
            }}
          >
            <Latex>{content}</Latex>
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
