// Пролёт уровней: «сейчас» и «цель» на одной шкале.
//
// Два независимых выпадающих списка позволяли поставить цель НИЖЕ текущего
// уровня и получить курс, который ничему не учит. Здесь это невозможно по
// построению: пара живёт в одном объекте состояния (два независимых `useState`
// оставили бы невалидное состояние представимым — то есть оставили бы ровно тот
// баг, который чиним), а инвариант держится выталкиванием соседа.
//
// Почему не два `radiogroup`: значение лежит на упорядоченной шкале, и
// двенадцать радиокнопок вместо двух контролов озвучиваются как каша. Два
// `slider` над одной дорожкой — то, чем это является.

"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRef, useState } from "react";

import type { Level } from "@/lib/curriculum-api";
import {
  LEVEL_ORDER,
  LEVEL_SHORT_LABELS,
  type LevelPair,
  type MovedMarker,
  clampLevelPair,
  fractionForLevel,
  levelAt,
  levelFromFraction,
  levelIndex,
  levelLabel,
  spanAnnouncement,
  spanCaption,
} from "@/lib/curriculum-levels";
import { paperCaption, paperFocus, paperStrip } from "./paper";

const LAST_INDEX = LEVEL_ORDER.length - 1;

export function LevelSpan({
  value,
  onChange,
  disabled,
}: {
  value: LevelPair;
  onChange: (pair: LevelPair) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<MovedMarker | null>(null);
  const reduceMotion = useReducedMotion();

  const currentIndex = levelIndex(value.current);
  const targetIndex = levelIndex(value.target);

  const apply = (marker: MovedMarker, level: Level) => {
    const next = clampLevelPair(
      marker === "current"
        ? { current: level, target: value.target }
        : { current: value.current, target: level },
      marker,
    );
    if (next.current !== value.current || next.target !== value.target) onChange(next);
  };

  const nudge = (marker: MovedMarker, delta: number) => {
    const base = marker === "current" ? currentIndex : targetIndex;
    apply(marker, levelAt(base + delta));
  };

  const levelAtPointer = (clientX: number): Level => {
    const track = trackRef.current;
    if (!track) return LEVEL_ORDER[0];
    const rect = track.getBoundingClientRect();
    return levelFromFraction((clientX - rect.left) / Math.max(rect.width, 1));
  };

  // Только Pointer Events: один путь для мыши, тача и пера. Захват указателя
  // держит перетаскивание живым, даже когда палец ушёл за пределы дорожки.
  const startDrag = (
    event: React.PointerEvent<HTMLElement>,
    marker: MovedMarker,
  ) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(marker);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>, marker: MovedMarker) => {
    if (dragging !== marker) return;
    apply(marker, levelAtPointer(event.clientX));
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  };

  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const level = levelAtPointer(event.clientX);
    const index = levelIndex(level);
    // Ближайший маркер и есть тот, который человек хотел взять. Ничья решается
    // направлением: важно, когда маркеры стоят на одной ступени и «ближайший»
    // не определён — клик ниже двигает «сейчас», клик выше двигает цель.
    const toCurrent = Math.abs(index - currentIndex);
    const toTarget = Math.abs(index - targetIndex);
    const marker: MovedMarker =
      toCurrent < toTarget
        ? "current"
        : toTarget < toCurrent
          ? "target"
          : index < currentIndex
            ? "current"
            : "target";
    apply(marker, level);
  };

  const keyHandler =
    (marker: MovedMarker) => (event: React.KeyboardEvent<HTMLElement>) => {
      const deltas: Record<string, number> = {
        ArrowLeft: -1,
        ArrowDown: -1,
        ArrowRight: 1,
        ArrowUp: 1,
        PageDown: -2,
        PageUp: 2,
      };
      if (event.key in deltas) {
        event.preventDefault();
        nudge(marker, deltas[event.key]);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        apply(marker, LEVEL_ORDER[0]);
      }
      if (event.key === "End") {
        event.preventDefault();
        apply(marker, LEVEL_ORDER[LAST_INDEX]);
      }
    };

  // Анимация выключается на время перетаскивания: иначе маркер тянется за
  // пальцем с задержкой, и это читается как лаг, а не как плавность.
  const transition = {
    duration: reduceMotion || dragging ? 0 : 0.22,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  const marker = (which: MovedMarker) => {
    const index = which === "current" ? currentIndex : targetIndex;
    const level = which === "current" ? value.current : value.target;
    return (
      <motion.div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={which === "current" ? "Текущий уровень" : "Целевой уровень"}
        aria-valuemin={0}
        aria-valuemax={LAST_INDEX}
        aria-valuenow={index}
        aria-valuetext={levelLabel(level)}
        aria-disabled={disabled || undefined}
        onKeyDown={keyHandler(which)}
        onPointerDown={(event) => startDrag(event, which)}
        onPointerMove={(event) => moveDrag(event, which)}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        initial={false}
        animate={{ left: `${(index / LAST_INDEX) * 100}%` }}
        transition={transition}
        // Цель нажатия 44×44 набирается паддингом, а сам маркер остаётся мелким.
        // `touch-none` обязателен: иначе горизонтальный драг съедает прокрутка.
        className={`${paperFocus} absolute top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full p-[15px] ${
          disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <span
          aria-hidden
          className={`block h-3.5 w-3.5 rounded-full border-2 border-[#fffdfa] shadow-[0_2px_6px_rgba(70,54,36,0.28)] ${
            which === "current" ? "bg-[#b79261]" : "bg-[#8a5b24]"
          }`}
        />
      </motion.div>
    );
  };

  return (
    <div className={`${paperStrip} p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={paperCaption}>Уровень</p>
        <p className="text-[11px] text-[#9b9186]">
          {levelLabel(value.current)} → {levelLabel(value.target)}
        </p>
      </div>

      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        className="relative mx-[15px] my-6 h-1.5 touch-none rounded-full bg-[#e9e2d7]"
      >
        {LEVEL_ORDER.map((level) => (
          <span
            key={level}
            aria-hidden
            className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#cfc6b8]"
            style={{ left: `${fractionForLevel(level) * 100}%` }}
          />
        ))}

        <motion.span
          aria-hidden
          className="absolute inset-y-0 rounded-full bg-[#c9a878]"
          initial={false}
          animate={{
            left: `${(currentIndex / LAST_INDEX) * 100}%`,
            width: `${((targetIndex - currentIndex) / LAST_INDEX) * 100}%`,
          }}
          transition={transition}
        />

        {marker("current")}
        {marker("target")}
      </div>

      <div className="flex items-baseline justify-between text-[10px] text-[#a1978b]">
        <span>{LEVEL_SHORT_LABELS[LEVEL_ORDER[0]]}</span>
        <span>{LEVEL_SHORT_LABELS[LEVEL_ORDER[LAST_INDEX]]}</span>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-[#7f776e]">{spanCaption(value)}</p>

      {/* Смысл контрола — пролёт целиком, и ни один слайдер сам по себе его
          объявить не может. */}
      <span className="sr-only" aria-live="polite">
        {spanAnnouncement(value)}
      </span>
    </div>
  );
}
