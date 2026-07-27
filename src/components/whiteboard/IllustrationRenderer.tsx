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
 *   Слой 3 (15) — <svg> выносок             : от внешней границы bbox к объекту
 *   Слой 4 (20) — <div> подписи             : динамический контраст + ореол
 *
 * Координаты подписей (x/y) и полигонов масок приходят в ПРОЦЕНТАХ от
 * размеров картинки (0–100), поэтому позиционируются напрямую через
 * left/top: N% и SVG viewBox="0 0 100 100" — выравнивание идеальное при
 * любом масштабе доски.
 *
 * Контраст подписей (композитинг «как у Figure Labs»): цвет текста
 * выбирается по реальной яркости пикселей картинки под подписью
 * (offscreen-canvas сэмплирование, один раз на загрузку картинки), а
 * раскладка предварительно исключает стрелки/линии из bbox текста. Ореол и
 * непрозрачная fail-safe подложка остаются только страховкой для полностью
 * занятого кадра. См. src/lib/illustration-contrast.ts.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import Latex from "react-latex-next";
import "katex/dist/katex.min.css";
import type { IllustrationLabel, IllustrationMask } from "@/stores/whiteboard";
import {
  useSmartLabels,
  contrastStylesFor,
  moveLabelPlacement,
} from "@/lib/illustration-contrast";
import { IllustrationLeaderLines } from "@/components/whiteboard/IllustrationLeaderLines";

export interface IllustrationRendererProps {
  id: string;
  src: string;                       // base_image_url
  labels?: IllustrationLabel[];
  masks?: IllustrationMask[] | null;
  alt?: string;
  /** Стиль генерации (flat/2_5d/3d/sketch): sketch → рукописный шрифт подписей. */
  genStyle?: string;
  /** Сохраняет ручное положение подписи в элементе доски. null = вернуть auto-layout. */
  onLabelPositionChange?: (
    labelIndex: number,
    position: { x: number; y: number } | null,
  ) => void;
}

export const IllustrationRenderer: React.FC<IllustrationRendererProps> = ({
  id,
  src,
  labels = [],
  masks,
  alt = "Иллюстрация",
  genStyle,
  onLabelPositionChange,
}) => {
  const hasMasks = Array.isArray(masks) && masks.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    pointerId: number;
    startClient: { x: number; y: number };
    origin: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [draftPositions, setDraftPositions] = useState<
    Record<number, { x: number; y: number }>
  >({});
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Детерминированная раскладка подписей: позиции текста от модели игнорируем,
  // якорь — заземлённый центр объекта (arrow_to), вокруг него правила выбирают
  // чистое стабильное место (см. useSmartLabels). Один проход на загрузку src.
  const automaticPlacements = useSmartLabels(src, labels);
  const placements = useMemo(
    () =>
      automaticPlacements.map((placement, index) => {
        const requested = draftPositions[index] ?? labels[index]?.manual_position;
        if (!requested) return placement;
        const label = labels[index];
        const anchor = label?.arrow_to ?? (label ? { x: label.x, y: label.y } : undefined);
        return moveLabelPlacement(placement, anchor, requested);
      }),
    [automaticPlacements, draftPositions, labels],
  );

  useEffect(() => {
    // Черновик относится только к текущему растру; при рестайле/новой картинке
    // не позволяем старому незавершённому drag переехать в другой результат.
    dragRef.current = null;
    setDraggingIndex(null);
    setDraftPositions({});
  }, [src]);

  const activeIndex = draggingIndex ?? hoveredIndex ?? focusedIndex;
  const leaderPlacements = useMemo(
    () =>
      placements.map((placement, index) => {
        const manuallyPlaced =
          draggingIndex === index
          || draftPositions[index] != null
          || labels[index]?.manual_position != null;
        return manuallyPlaced
          ? placement
          : { ...placement, connector: null };
      }),
    [draftPositions, draggingIndex, labels, placements],
  );

  useEffect(() => {
    if (draggingIndex == null) return;

    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const bounds = containerRef.current?.getBoundingClientRect();
      const basePlacement = automaticPlacements[drag.index];
      const label = labels[drag.index];
      if (!bounds || bounds.width === 0 || bounds.height === 0 || !basePlacement || !label) {
        return;
      }

      event.preventDefault();
      const requested = {
        x: drag.origin.x + ((event.clientX - drag.startClient.x) / bounds.width) * 100,
        y: drag.origin.y + ((event.clientY - drag.startClient.y) / bounds.height) * 100,
      };
      const anchor = label.arrow_to ?? { x: label.x, y: label.y };
      const moved = moveLabelPlacement(basePlacement, anchor, requested);
      drag.current = { x: moved.x, y: moved.y };
      setDraftPositions((current) => ({
        ...current,
        [drag.index]: drag.current,
      }));
    };

    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      onLabelPositionChange?.(drag.index, drag.current);
      setDraftPositions((current) => {
        const next = { ...current };
        delete next[drag.index];
        return next;
      });
      dragRef.current = null;
      setDraggingIndex(null);
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp, { passive: false });
    window.addEventListener("pointercancel", handleUp, { passive: false });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [automaticPlacements, draggingIndex, labels, onLabelPositionChange]);

  const beginLabelDrag = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return;
    const placement = placements[index];
    if (!placement) return;

    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      index,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      origin: { x: placement.x, y: placement.y },
      current: { x: placement.x, y: placement.y },
    };
    setFocusedIndex(index);
    setDraggingIndex(index);
  };

  const resetLabelPosition = (
    event: React.MouseEvent<HTMLDivElement>,
    index: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDraftPositions((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    onLabelPositionChange?.(index, null);
  };

  const nudgeLabel = (
    event: React.KeyboardEvent<HTMLDivElement>,
    index: number,
  ) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      onLabelPositionChange?.(index, null);
      return;
    }

    const placement = placements[index];
    const basePlacement = automaticPlacements[index];
    const label = labels[index];
    if (!placement || !basePlacement || !label) return;
    const step = event.shiftKey ? 4 : 1;
    const delta = {
      x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
      y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
    };
    const anchor = label.arrow_to ?? { x: label.x, y: label.y };
    const moved = moveLabelPlacement(basePlacement, anchor, {
      x: placement.x + delta.x,
      y: placement.y + delta.y,
    });
    onLabelPositionChange?.(index, { x: moved.x, y: moved.y });
  };

  // Типографика: рукописный Caveat ТОЛЬКО для sketch (hand-lettering, как на
  // чернильных конспектах), остальным стилям — строгий современный sans
  // (Plus Jakarta). Подписи держим компактными: основную картинку должен вести
  // растр, а текст — быть тихим overlay-слоем.
  const handwritten = genStyle === "sketch";
  const labelFontClass = handwritten
    ? "absolute font-handwriting font-semibold"
    : "absolute font-sans font-medium";
  const labelFontSize = handwritten ? 15 : 12;

  return (
    <div
      ref={containerRef}
      data-illustration-id={id}
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

      {/* ── Слой 3 (z-15, выноски): линия начинается ЗА bbox текста. ── */}
      <IllustrationLeaderLines placements={leaderPlacements} activeIndex={activeIndex} />

      {/* ── Слой 4 (z-20, текст): подписи на детерминированных позициях ──
          Позиция — из useSmartLabels (правила вокруг якоря-объекта, а не
          «куда показалось модели»), шрифт — по стилю генерации (sketch →
          рукописный Caveat, прочие → sans), цвет — по реальной яркости
          пикселей под подписью, ореол АДАПТИВНЫЙ: включается только на
          пёстром / среднесером фоне и исчезает на чистом. KaTeX-формулы
          рендерятся математическим шрифтом KaTeX, но наследуют currentColor
          и text-shadow — композитинг тот же. */}
      {labels.map((label, i) => {
        const { content } = label;
        const place = placements[i];
        const active = activeIndex === i;
        const isManual = Boolean(draftPositions[i] ?? label.manual_position);
        const contrastStyles = contrastStylesFor(
          place?.sample ?? null,
          place?.needsBackdrop ?? false,
        );
        const darkBackdrop = (place?.sample?.luminance ?? 1) < 0.58;
        return (
          <div
            key={i}
            data-illustration-label={i}
            data-manual-position={isManual ? "true" : "false"}
            role="button"
            tabIndex={0}
            aria-label={`${content}. Перетащите подпись; двойной клик вернёт автоматическое положение.`}
            title="Перетащите подпись · двойной клик — вернуть автоматически"
            className={`${labelFontClass} touch-none cursor-grab outline-none transition-[box-shadow,background-color] duration-150 active:cursor-grabbing`}
            onPointerDown={(event) => beginLabelDrag(event, i)}
            onPointerEnter={() => setHoveredIndex(i)}
            onPointerLeave={() => setHoveredIndex((current) => (current === i ? null : current))}
            onFocus={() => setFocusedIndex(i)}
            onBlur={() => setFocusedIndex((current) => (current === i ? null : current))}
            onDoubleClick={(event) => resetLabelPosition(event, i)}
            onKeyDown={(event) => nudgeLabel(event, i)}
            style={{
              left: `${place?.x ?? label.x}%`,
              top: `${place?.y ?? label.y}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 20,
              pointerEvents: "auto",
              fontSize: labelFontSize,
              lineHeight: 1.1,
              width: "max-content",
              // Внутри кадра подпись жмём, чтобы она не накрывала схему. За
              // кадром жать нечего — там место как раз и искали, а перенос по
              // 34% ширины картинки рвал бы «Нормальная реакция N» на три
              // строки прямо на пустом поле.
              maxWidth: isManual ? "70%" : "34%",
              textAlign: "center",
              whiteSpace: "normal",
              ...contrastStyles,
              backgroundColor: active
                ? darkBackdrop
                  ? "rgba(255, 255, 255, 0.06)"
                  : "rgba(15, 23, 42, 0.05)"
                : "transparent",
              border: "none",
              borderRadius: active ? 4 : 0,
              padding: active ? "3px 5px" : 0,
              textShadow: "none",
              boxShadow:
                draggingIndex === i
                  ? darkBackdrop
                    ? "0 5px 16px rgba(0, 0, 0, 0.22)"
                    : "0 5px 16px rgba(15, 23, 42, 0.12)"
                  : "none",
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
