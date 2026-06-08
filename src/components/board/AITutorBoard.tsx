"use client";

/**
 * AITutorBoard
 * ------------------------------------------------------------------
 * Визуализирует пошаговое решение задачи, полученное от ИИ-бэкенда
 * в строгой JSON-схеме с координатами на виртуальном холсте 1000x1000.
 *
 * Архитектура рендеринга — ГИБРИД (без Canvas API):
 *   • line / circle / rect  → нативные SVG-примитивы (<svg viewBox>)
 *   • text                  → абсолютно позиционированные <div> поверх SVG
 *                             (LaTeX внутри `$...$` через react-latex-next)
 *
 * Масштабирование: SVG авто-масштабируется через `viewBox`, а слой текста —
 * через CSS `transform: scale()`, рассчитанный от реальной ширины контейнера
 * (ResizeObserver). Обе плоскости делят одну виртуальную систему координат,
 * поэтому текст и фигуры всегда совмещены пиксель-в-пиксель.
 *
 * Анимация присутствия: команды раскрываются последовательно
 * (по умолчанию интервал 400 мс) — пользователь видит, как решение
 * «пишется» шаг за шагом.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import Latex from "react-latex-next";
import { BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScientificIllustration, type ImageWithLabelsCommand } from "./ScientificIllustration";

/* ============================================================
 * Типы входящей JSON-схемы
 * ========================================================== */

export interface TextCommand {
  type: "text";
  x: number;
  y: number;
  content: string;
  color?: string;
  /** Размер шрифта в виртуальных px (на холсте 1000x1000). */
  fontSize?: number;
}

export interface LineCommand {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
  width?: number;
}

export interface CircleCommand {
  type: "circle";
  x: number;
  y: number;
  r: number;
  color?: string;
  /** Заливка. Если задана (не "none") — фигура считается заполненной. */
  fill?: string;
  width?: number;
}

export interface RectCommand {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  fill?: string;
  width?: number;
  /** Скругление углов в виртуальных px. */
  radius?: number;
}

export interface TableCommand {
  type: "table";
  x: number;
  y: number;
  /** Заголовки столбцов. */
  headers?: string[];
  /** Строки таблицы — массив массивов ячеек. */
  rows: string[][];
  /** Размер шрифта в виртуальных px (на холсте 1000x1000). */
  fontSize?: number;
}

export interface FormulaCommand {
  type: "formula";
  x: number;
  y: number;
  /** LaTeX-код БЕЗ знаков `$` — рендерится через react-katex BlockMath. */
  content: string;
  color?: string;
  /** Размер шрифта в виртуальных px (на холсте 1000x1000). */
  fontSize?: number;
}

export interface BarChartCommand {
  type: "barchart";
  x: number;
  y: number;
  /** Размеры графика в виртуальных px. По умолчанию 360×240. */
  width?: number;
  height?: number;
  /** Подписи столбцов по оси X. */
  labels: string[];
  /** Числовые значения столбцов (тот же порядок, что и `labels`). */
  values: number[];
  /** Необязательный заголовок над графиком. */
  title?: string;
  /** Цвет столбцов (hex). */
  color?: string;
}

export type BoardCommand =
  | TextCommand
  | LineCommand
  | CircleCommand
  | RectCommand
  | TableCommand
  | FormulaCommand
  | BarChartCommand
  | ImageWithLabelsCommand;

/** Команды, рендерящиеся как HTML-слой (div/table/formula/barchart), а не SVG-фигуры основного холста. */
function isHtmlCommand(
  command: BoardCommand
): command is TextCommand | TableCommand | FormulaCommand | BarChartCommand | ImageWithLabelsCommand {
  return (
    command.type === "text" ||
    command.type === "table" ||
    command.type === "formula" ||
    command.type === "barchart" ||
    command.type === "image_with_labels"
  );
}

export interface BoardStep {
  step_number: number;
  title: string;
  commands: BoardCommand[];
}

export interface BoardData {
  subject: string;
  topic: string;
  board_steps: BoardStep[];
}

export interface AITutorBoardProps {
  /** Данные решения от бэкенда. */
  data: BoardData;
  /** Доп. классы внешнего контейнера. */
  className?: string;
  /** Интервал появления команд, мс. По умолчанию 400. */
  stepInterval?: number;
  /** Размер виртуального холста. По умолчанию 1000. */
  virtualSize?: number;
  /** Показывать шапку (предмет / тема). По умолчанию true. */
  showHeader?: boolean;
  /** Показывать фоновую координатную сетку. По умолчанию true. */
  showGrid?: boolean;
  /** Запускать анимацию при монтировании. По умолчанию true.
   *  Если false — всё решение показывается сразу. */
  autoPlay?: boolean;
  /** Колбэк по завершении анимации всех команд. */
  onComplete?: () => void;
}

/* ============================================================
 * Утилиты
 * ========================================================== */

const DEFAULT_TEXT_COLOR = "#e4e4e7"; // zinc-200 — читаемо на тёмной доске
const DEFAULT_STROKE_COLOR = "#93c5fd"; // blue-300
const DEFAULT_STROKE_WIDTH = 3;
const DEFAULT_FONT_SIZE = 28;

/** Безопасно приводит значение к конечному числу. */
function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isFilled(fill?: string): boolean {
  return !!fill && fill.toLowerCase() !== "none" && fill !== "transparent";
}

interface FlatItem {
  key: string;
  stepIndex: number;
  stepNumber: number;
  title: string;
  command: BoardCommand;
}

/* ============================================================
 * Рендер одной SVG-команды (line / circle / rect)
 * ========================================================== */

function ShapeCommand({ command }: { command: BoardCommand }) {
  // Общая анимация: для контурных фигур «прорисовываем» обводку (pathLength),
  // для залитых — мягко проявляем (opacity), т.к. pathLength ломает заливку.
  const drawTransition = { duration: 0.4, ease: "easeInOut" as const };

  if (command.type === "line") {
    const color = command.color || DEFAULT_STROKE_COLOR;
    return (
      <motion.line
        x1={num(command.x1)}
        y1={num(command.y1)}
        x2={num(command.x2)}
        y2={num(command.y2)}
        stroke={color}
        strokeWidth={num(command.width, DEFAULT_STROKE_WIDTH)}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={drawTransition}
      />
    );
  }

  if (command.type === "circle") {
    const color = command.color || DEFAULT_STROKE_COLOR;
    const filled = isFilled(command.fill);
    return (
      <motion.circle
        cx={num(command.x)}
        cy={num(command.y)}
        r={Math.max(0, num(command.r))}
        stroke={color}
        strokeWidth={num(command.width, DEFAULT_STROKE_WIDTH)}
        fill={filled ? command.fill : "none"}
        initial={filled ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
        animate={filled ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={drawTransition}
      />
    );
  }

  if (command.type === "rect") {
    const color = command.color || DEFAULT_STROKE_COLOR;
    const filled = isFilled(command.fill);
    return (
      <motion.rect
        x={num(command.x)}
        y={num(command.y)}
        width={Math.max(0, num(command.w))}
        height={Math.max(0, num(command.h))}
        rx={num(command.radius, 0)}
        stroke={color}
        strokeWidth={num(command.width, DEFAULT_STROKE_WIDTH)}
        fill={filled ? command.fill : "none"}
        initial={filled ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
        animate={filled ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={drawTransition}
      />
    );
  }

  return null;
}

/* ============================================================
 * Рендер одной text-команды (абсолютный <div> + LaTeX)
 * ========================================================== */

function TextCommandView({
  command,
  virtualSize,
}: {
  command: TextCommand;
  virtualSize: number;
}) {
  const x = num(command.x);
  const y = num(command.y);
  return (
    <motion.div
      className="absolute font-sans font-medium leading-snug"
      style={{
        left: x,
        top: y,
        color: command.color || DEFAULT_TEXT_COLOR,
        fontSize: num(command.fontSize, DEFAULT_FONT_SIZE),
        // Не вылезаем за правый край виртуального холста.
        maxWidth: Math.max(40, virtualSize - x - 16),
        // Строгий sans-serif + nowrap: формулы вида "м/с^2" не должны рваться
        // посреди строки случайным переносом — пусть лучше выходят за рамку
        // (контейнер ниже скроллится по горизонтали при необходимости).
        whiteSpace: "nowrap",
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <Latex>{command.content ?? ""}</Latex>
    </motion.div>
  );
}

/* ============================================================
 * Рендер table-команды — нативный <table>, идеально ровная сетка
 * ========================================================== */

function TableCommandView({ command }: { command: TableCommand }) {
  const x = num(command.x);
  const y = num(command.y);
  const headers = Array.isArray(command.headers) ? command.headers : [];
  const rows = Array.isArray(command.rows) ? command.rows : [];
  const fontSize = num(command.fontSize, 22);

  return (
    <motion.div
      className="absolute"
      style={{ left: x, top: y, fontSize, whiteSpace: "nowrap" }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <table className="border-collapse border border-gray-500 font-sans text-zinc-100">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="border border-gray-500 bg-zinc-800/70 p-2 text-center font-semibold"
                >
                  <Latex>{h ?? ""}</Latex>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(Array.isArray(row) ? row : []).map((cell, ci) => (
                <td
                  key={ci}
                  className="border border-gray-500 p-2 text-center font-normal"
                >
                  <Latex>{cell ?? ""}</Latex>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </motion.div>
  );
}

/* ============================================================
 * Рендер formula-команды — react-katex BlockMath (LaTeX без $...$)
 * ========================================================== */

function FormulaCommandView({
  command,
  virtualSize,
}: {
  command: FormulaCommand;
  virtualSize: number;
}) {
  const x = num(command.x);
  const y = num(command.y);
  return (
    <motion.div
      className="absolute font-sans"
      style={{
        left: x,
        top: y,
        color: command.color || DEFAULT_TEXT_COLOR,
        fontSize: num(command.fontSize, DEFAULT_FONT_SIZE),
        maxWidth: Math.max(40, virtualSize - x - 16),
        whiteSpace: "nowrap",
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <BlockMath errorColor="#f87171">{command.content ?? ""}</BlockMath>
    </motion.div>
  );
}

/* ============================================================
 * Рендер barchart-команды — гистограмма, рассчитанная от данных
 * (а не «нарисованная» моделью линиями), поэтому оси, столбцы и
 * подписи всегда идеально выровнены друг относительно друга.
 * ========================================================== */

const BAR_AXIS_COLOR = "#52525b"; // zinc-600
const BAR_LABEL_COLOR = "#a1a1aa"; // zinc-400
const BAR_VALUE_COLOR = "#e4e4e7"; // zinc-200

function BarChartCommandView({ command }: { command: BarChartCommand }) {
  const x = num(command.x);
  const y = num(command.y);
  const width = Math.max(80, num(command.width, 360));
  const height = Math.max(60, num(command.height, 240));
  const labels = Array.isArray(command.labels) ? command.labels : [];
  const values = Array.isArray(command.values)
    ? command.values.map((v) => num(v))
    : [];
  const n = Math.max(labels.length, values.length);
  const color = command.color || DEFAULT_STROKE_COLOR;

  // Геометрия рассчитывается из реальных данных — никаких «на глазок».
  const padLeft = 40;
  const padRight = 16;
  const padTop = command.title ? 34 : 16;
  const padBottom = 36;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom);
  const maxVal = Math.max(1, ...values, 0);
  const slot = n > 0 ? plotW / n : plotW;
  const barWidth = Math.max(6, Math.min(56, slot * 0.56));

  return (
    <motion.div
      className="absolute font-sans"
      style={{ left: x, top: y, width }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {command.title && (
        <div
          className="mb-1 text-center text-[15px] font-semibold leading-tight"
          style={{ color: DEFAULT_TEXT_COLOR }}
        >
          {command.title}
        </div>
      )}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Оси */}
        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={padTop + plotH}
          stroke={BAR_AXIS_COLOR}
          strokeWidth={1.5}
        />
        <line
          x1={padLeft}
          y1={padTop + plotH}
          x2={padLeft + plotW}
          y2={padTop + plotH}
          stroke={BAR_AXIS_COLOR}
          strokeWidth={1.5}
        />

        {Array.from({ length: n }).map((_, i) => {
          const v = values[i] ?? 0;
          const barH = maxVal > 0 ? (Math.max(0, v) / maxVal) * plotH : 0;
          const slotX = padLeft + slot * i;
          const bx = slotX + (slot - barWidth) / 2;
          const byTarget = padTop + plotH - barH;
          const baseline = padTop + plotH;
          return (
            <g key={i}>
              <motion.rect
                x={bx}
                width={barWidth}
                rx={3}
                fill={color}
                initial={{ y: baseline, height: 0 }}
                animate={{ y: byTarget, height: Math.max(0, barH) }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
              <text
                x={bx + barWidth / 2}
                y={Math.max(padTop - 6, byTarget - 6)}
                textAnchor="middle"
                fontSize={11}
                fill={BAR_VALUE_COLOR}
              >
                {v}
              </text>
              <text
                x={bx + barWidth / 2}
                y={baseline + 16}
                textAnchor="middle"
                fontSize={11}
                fill={BAR_LABEL_COLOR}
              >
                {labels[i] ?? ""}
              </text>
            </g>
          );
        })}
      </svg>
    </motion.div>
  );
}

/* ============================================================
 * Основной компонент
 * ========================================================== */

export function AITutorBoard({
  data,
  className,
  stepInterval = 400,
  virtualSize = 1000,
  showHeader = true,
  showGrid = true,
  autoPlay = true,
  onComplete,
}: AITutorBoardProps) {
  const gridId = useId();

  /* --- 1. Плоский упорядоченный список команд по всем шагам --- */
  const flat = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    const steps = Array.isArray(data?.board_steps) ? data.board_steps : [];
    steps.forEach((step, si) => {
      const commands = Array.isArray(step?.commands) ? step.commands : [];
      commands.forEach((command, ci) => {
        items.push({
          key: `${si}-${ci}`,
          stepIndex: si,
          stepNumber: step?.step_number ?? si + 1,
          title: step?.title ?? `Шаг ${si + 1}`,
          command,
        });
      });
    });
    return items;
  }, [data]);

  /* --- 2. Последовательное раскрытие команд (эффект «написания») --- */
  const [visibleCount, setVisibleCount] = useState(0);
  const [runId, setRunId] = useState(0); // инкремент → перезапуск анимации

  useEffect(() => {
    if (!autoPlay) {
      setVisibleCount(flat.length);
      return;
    }
    setVisibleCount(0);
    if (flat.length === 0) return;

    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= flat.length) {
        window.clearInterval(id);
        onComplete?.();
      }
    }, Math.max(0, stepInterval));

    return () => window.clearInterval(id);
    // onComplete намеренно не в зависимостях, чтобы не перезапускать таймер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, autoPlay, stepInterval, runId]);

  const visibleItems = flat.slice(0, visibleCount);

  /* --- 3. Масштабирование: реальная ширина → scale для слоя текста --- */
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = containerWidth > 0 ? containerWidth / virtualSize : 0;

  /* --- 4. Производные данные для шапки / прогресса --- */
  const current = visibleItems[visibleItems.length - 1];
  const totalSteps = data?.board_steps?.length ?? 0;
  const isPlaying = autoPlay && visibleCount < flat.length;
  const progress = flat.length ? visibleCount / flat.length : 1;

  const handleReplay = () => {
    setVisibleCount(0);
    setRunId((v) => v + 1);
  };

  /* --- 5. Пустое состояние --- */
  if (flat.length === 0) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-500",
          className
        )}
      >
        Нет данных для отображения
      </div>
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {/* Шапка */}
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {data.subject && (
              <span className="inline-block rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-blue-300">
                {data.subject}
              </span>
            )}
            {data.topic && (
              <h3 className="mt-1 truncate text-lg font-semibold text-zinc-100">
                {data.topic}
              </h3>
            )}
          </div>

          <div className="flex items-center gap-2">
            {current && (
              <span className="rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1 text-xs text-zinc-300">
                Шаг {current.stepNumber}
                {totalSteps ? ` / ${totalSteps}` : ""}
                {current.title ? ` · ${current.title}` : ""}
              </span>
            )}
            <button
              type="button"
              onClick={handleReplay}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Проиграть заново"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Заново
            </button>
          </div>
        </div>
      )}

      {/* Доска: квадрат 1:1, ширина — от родителя (адаптивность) */}
      <div
        ref={containerRef}
        className="relative aspect-square w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-inner"
      >
        {/* Слой фигур: SVG авто-масштабируется через viewBox */}
        <svg
          viewBox={`0 0 ${virtualSize} ${virtualSize}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
        >
          {showGrid && (
            <>
              <defs>
                <pattern
                  id={`grid-${gridId}`}
                  width={50}
                  height={50}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 50 0 L 0 0 0 50"
                    fill="none"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth={1}
                  />
                </pattern>
              </defs>
              <rect
                width={virtualSize}
                height={virtualSize}
                fill={`url(#grid-${gridId})`}
              />
            </>
          )}

          {visibleItems
            .filter((it) => !isHtmlCommand(it.command))
            .map((it) => (
              <ShapeCommand key={it.key} command={it.command} />
            ))}
        </svg>

        {/* Слой HTML-элементов (text / table / formula): абсолютные div'ы,
            масштаб через transform: scale() — все три типа делят одну
            систему координат с SVG-слоем. */}
        {scale > 0 && (
          <div className="pointer-events-none absolute inset-0">
            <div
              style={{
                width: virtualSize,
                height: virtualSize,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {visibleItems
                .filter(
                  (
                    it
                  ): it is FlatItem & {
                    command: TextCommand | TableCommand | FormulaCommand | BarChartCommand | ImageWithLabelsCommand;
                  } => isHtmlCommand(it.command)
                )
                .map((it) => {
                  if (it.command.type === "image_with_labels") {
                    return (
                      <div
                        key={it.key}
                        className="absolute pointer-events-auto"
                        style={{ left: 0, top: 0, width: virtualSize, height: virtualSize }}
                      >
                        <ScientificIllustration board_steps={[{ commands: [it.command] }]} />
                      </div>
                    );
                  }
                  if (it.command.type === "table") {
                    return <TableCommandView key={it.key} command={it.command} />;
                  }
                  if (it.command.type === "formula") {
                    return (
                      <FormulaCommandView
                        key={it.key}
                        command={it.command}
                        virtualSize={virtualSize}
                      />
                    );
                  }
                  if (it.command.type === "barchart") {
                    return <BarChartCommandView key={it.key} command={it.command} />;
                  }
                  return (
                    <TextCommandView
                      key={it.key}
                      command={it.command}
                      virtualSize={virtualSize}
                    />
                  );
                })}
            </div>
          </div>
        )}

        {/* Индикатор прогресса прорисовки */}
        {isPlaying && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-800/60">
            <motion.div
              className="h-full bg-blue-500"
              initial={false}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * LessonFlow
 * ------------------------------------------------------------------
 * Облегчённый «потоковый» рендер board_steps для УЗКИХ контейнеров
 * (например, пузырей чата), где квадратный масштабируемый холст
 * AITutorBoard выглядел бы нечитаемо мелким: при scale ≈ 0.25
 * (контейнер ~250px / виртуальный холст 1000px) текст и таблицы
 * сжимаются до пары пикселей.
 *
 * LessonFlow игнорирует виртуальные x/y и transform:scale — вместо
 * этого рендерит команды единым вертикальным потоком в естественном
 * размере контейнера (как обычный документ/конспект урока). Линии/
 * круги/прямоугольники показываются мини-превью с авто-bbox.
 * ========================================================== */

export interface LessonFlowProps {
  /** Данные решения от бэкенда (та же схема, что и у AITutorBoard). */
  data: BoardData;
  className?: string;
  /** Показывать шапку (предмет / тема). По умолчанию true. */
  showHeader?: boolean;
}

export function LessonFlow({ data, className, showHeader = true }: LessonFlowProps) {
  const steps = Array.isArray(data?.board_steps) ? data.board_steps : [];
  const visibleSteps = steps.filter(
    (s) => Array.isArray(s?.commands) && s.commands.length > 0
  );

  if (visibleSteps.length === 0) return null;

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3",
        className
      )}
    >
      {showHeader && (data.subject || data.topic) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/70 pb-2">
          {data.subject && (
            <span className="inline-block rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
              {data.subject}
            </span>
          )}
          {data.topic && (
            <span className="text-[13px] font-semibold leading-snug text-zinc-100">
              {data.topic}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {visibleSteps.map((step, si) => (
          <div key={si} className="flex flex-col gap-2.5">
            {step.title && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Шаг {step.step_number ?? si + 1} · {step.title}
              </div>
            )}
            {step.commands.map((cmd, ci) => (
              <FlowCommand key={ci} command={cmd} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowCommand({ command }: { command: BoardCommand }) {
  switch (command.type) {
    case "image_with_labels":
      return <ScientificIllustration board_steps={[{ commands: [command] }]} />;
    case "text":
      return (
        <div className="font-sans text-[13px] leading-relaxed text-zinc-200">
          <Latex>{command.content ?? ""}</Latex>
        </div>
      );
    case "formula":
      return (
        <div className="overflow-x-auto rounded-lg bg-zinc-900/60 px-3 py-2.5 text-zinc-100">
          <BlockMath errorColor="#f87171">{command.content ?? ""}</BlockMath>
        </div>
      );
    case "table":
      return <FlowTable command={command} />;
    case "barchart":
      return <FlowBarChart command={command} />;
    case "line":
    case "circle":
    case "rect":
      return <FlowShapePreview command={command} />;
    default:
      return null;
  }
}

function FlowTable({ command }: { command: TableCommand }) {
  const headers = Array.isArray(command.headers) ? command.headers : [];
  const rows = Array.isArray(command.rows) ? command.rows : [];
  return (
    <div className="overflow-x-auto rounded-lg">
      <table className="w-full border-collapse border border-gray-500 font-sans text-[12px] text-zinc-100">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="border border-gray-500 bg-zinc-800/70 p-2 text-center font-semibold"
                >
                  <Latex>{h ?? ""}</Latex>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(Array.isArray(row) ? row : []).map((cell, ci) => (
                <td key={ci} className="border border-gray-500 p-2 text-center font-normal">
                  <Latex>{cell ?? ""}</Latex>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FLOW_CHART_W = 480;
const FLOW_CHART_H = 230;

function FlowBarChart({ command }: { command: BarChartCommand }) {
  const labels = Array.isArray(command.labels) ? command.labels : [];
  const values = Array.isArray(command.values) ? command.values.map((v) => num(v)) : [];
  const n = Math.max(labels.length, values.length);
  const color = command.color || DEFAULT_STROKE_COLOR;

  const padLeft = 42;
  const padRight = 16;
  const padTop = command.title ? 30 : 14;
  const padBottom = 34;
  const plotW = FLOW_CHART_W - padLeft - padRight;
  const plotH = FLOW_CHART_H - padTop - padBottom;
  const maxVal = Math.max(1, ...values, 0);
  const slot = n > 0 ? plotW / n : plotW;
  const barWidth = Math.max(8, Math.min(64, slot * 0.56));

  return (
    <div className="rounded-lg bg-zinc-900/40 px-2 py-2.5">
      {command.title && (
        <div className="mb-1 text-center text-[12px] font-semibold text-zinc-200">
          {command.title}
        </div>
      )}
      <svg
        viewBox={`0 0 ${FLOW_CHART_W} ${FLOW_CHART_H}`}
        className="block w-full"
        style={{ height: "auto" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke={BAR_AXIS_COLOR} strokeWidth={1.5} />
        <line
          x1={padLeft}
          y1={padTop + plotH}
          x2={padLeft + plotW}
          y2={padTop + plotH}
          stroke={BAR_AXIS_COLOR}
          strokeWidth={1.5}
        />
        {Array.from({ length: n }).map((_, i) => {
          const v = values[i] ?? 0;
          const barH = maxVal > 0 ? (Math.max(0, v) / maxVal) * plotH : 0;
          const slotX = padLeft + slot * i;
          const bx = slotX + (slot - barWidth) / 2;
          const baseline = padTop + plotH;
          const byTarget = baseline - barH;
          return (
            <g key={i}>
              <motion.rect
                x={bx}
                width={barWidth}
                rx={3}
                fill={color}
                initial={{ y: baseline, height: 0 }}
                animate={{ y: byTarget, height: Math.max(0, barH) }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
              <text x={bx + barWidth / 2} y={Math.max(padTop - 6, byTarget - 6)} textAnchor="middle" fontSize={12} fill={BAR_VALUE_COLOR}>
                {v}
              </text>
              <text x={bx + barWidth / 2} y={baseline + 18} textAnchor="middle" fontSize={12} fill={BAR_LABEL_COLOR}>
                {labels[i] ?? ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Мини-превью простой геометрической команды с авто-вычисленным bbox —
 * для потокового режима достаточно показать форму саму по себе, без
 * привязки к общей системе координат остальной доски. */
function FlowShapePreview({ command }: { command: LineCommand | CircleCommand | RectCommand }) {
  let minX = 0,
    minY = 0,
    maxX = 100,
    maxY = 100;

  if (command.type === "line") {
    minX = Math.min(num(command.x1), num(command.x2));
    maxX = Math.max(num(command.x1), num(command.x2));
    minY = Math.min(num(command.y1), num(command.y2));
    maxY = Math.max(num(command.y1), num(command.y2));
  } else if (command.type === "circle") {
    const r = Math.max(0, num(command.r));
    minX = num(command.x) - r;
    maxX = num(command.x) + r;
    minY = num(command.y) - r;
    maxY = num(command.y) + r;
  } else if (command.type === "rect") {
    minX = num(command.x);
    maxX = num(command.x) + Math.max(0, num(command.w));
    minY = num(command.y);
    maxY = num(command.y) + Math.max(0, num(command.h));
  }

  const pad = Math.max(12, num(("width" in command ? command.width : undefined), DEFAULT_STROKE_WIDTH) * 2);
  const w = Math.max(40, maxX - minX) + pad * 2;
  const h = Math.max(40, maxY - minY) + pad * 2;
  const vbX = minX - pad;
  const vbY = minY - pad;

  return (
    <div className="flex justify-center rounded-lg bg-zinc-900/30 py-2.5">
      <svg
        viewBox={`${vbX} ${vbY} ${w} ${h}`}
        className="block"
        style={{ width: "100%", maxWidth: 280, height: "auto" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <ShapeCommand command={command} />
      </svg>
    </div>
  );
}

export default AITutorBoard;
