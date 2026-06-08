"use client";

/**
 * ScientificIllustration
 * ------------------------------------------------------------------
 * Рендерит команды `image_with_labels` из массива `board_steps`.
 *
 * ── КАК УСТАНОВИТЬ imagetracerjs ──────────────────────────────────
 *
 * Библиотека imagetracerjs (v1.2.6, последний релиз ~2020) доступна
 * в npm и совместима с современными бандлерами при правильной настройке:
 *
 *   npm install imagetracerjs
 *
 * Типов нет — создаём объявление вручную (src/types/imagetracerjs.d.ts):
 *
 *   declare module 'imagetracerjs' {
 *     interface ImageTracerOptions { [key: string]: unknown; }
 *     interface ImageData { width: number; height: number; data: Uint8ClampedArray; }
 *     const ImageTracer: {
 *       imageToSVG(url: string, cb: (svg: string) => void, opts?: string | object): void;
 *       imagedataToSVG(imgData: ImageData, opts?: string | object): string;
 *       loadImage(url: string, cb: (canvas: HTMLCanvasElement) => void, opts?: object): void;
 *       getImgdata(canvas: HTMLCanvasElement): ImageData;
 *     };
 *     export default ImageTracer;
 *   }
 *
 * ВАЖНО для Next.js (App Router):
 *   • Компонент должен быть `"use client"` — imagetracerjs обращается к
 *     window, document и Canvas API, которых нет в Node.js.
 *   • Импорт библиотеки делаем через dynamic import внутри useEffect,
 *     чтобы бандлер не пытался включить её в серверный чанк.
 *   • Если изображение хостится на стороннем домене, сервер должен
 *     отдавать заголовок Access-Control-Allow-Origin: *. Если этого нет,
 *     хук автоматически переходит на проксирование через Canvas (drawImage
 *     на canvas с crossOrigin='Anonymous' + toDataURL) — см. useVectorizeImage.
 *
 * ── Z-INDEX SANDWICH ──────────────────────────────────────────────
 *
 *   Слой 1 (z-index: 10) — <div dangerouslySetInnerHTML> с SVG-строкой
 *                           от imagetracerjs; mix-blend-mode: multiply
 *   Слой 2 (z-index: 20) — <svg> со стрелками-указателями (arrow_to)
 *   Слой 3 (z-index: 30) — абсолютные <div> с KaTeX-лейблами
 * ──────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useId, useRef, useState } from "react";
import { InlineMath, BlockMath } from "react-katex";
import { motion, AnimatePresence } from "framer-motion";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

/* ============================================================
 * Типы JSON-схемы
 * ========================================================== */

export interface ArrowTarget {
  x: number;
  y: number;
}

export interface IllustrationLabel {
  content: string;
  x: number;
  y: number;
  color?: string;
  fontSize?: number;
  arrow_to?: ArrowTarget;
}

export interface ImageWithLabelsCommand {
  type: "image_with_labels";
  image_url: string;
  labels?: IllustrationLabel[];
  alt?: string;
}

export interface IllustrationStep {
  step_number?: number;
  title?: string;
  commands: Array<ImageWithLabelsCommand | { type: string; [key: string]: unknown }>;
}

export interface ScientificIllustrationProps {
  board_steps: IllustrationStep[];
  className?: string;
  maxWidth?: string;
  showStepTitle?: boolean;
  animate?: boolean;
  /**
   * Preset imagetracerjs для трассировки. Строковые пресеты:
   * 'default' | 'posterized1' | 'posterized2' | 'posterized3' |
   * 'curvy' | 'sharp' | 'detailed' | 'smoothed' | 'grayscale' |
   * 'fixedpalette' | 'randomsampling1' | 'randomsampling2' | 'artistic1' |
   * 'artistic2' | 'artistic3' | 'artistic4' | 'blobs' | 'photo'.
   * Либо объект с настройками (см. imagetracerjs/options.md).
   * По умолчанию — 'posterized2' (хороший баланс для научных иллюстраций).
   */
  tracerOptions?: string | Record<string, unknown>;
}

/* ============================================================
 * Хук: useVectorizeImage
 * ========================================================== */

type VectorizeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; svg: string }
  | { status: "error"; message: string };

/**
 * Загружает растровое изображение по URL и конвертирует его в SVG-строку
 * при помощи imagetracerjs на стороне клиента.
 *
 * Алгоритм обхода CORS:
 *   1. Пробуем загрузить изображение напрямую с crossOrigin='Anonymous'.
 *      Если сервер отдаёт нужные CORS-заголовки — Canvas не будет «запятнан»
 *      (tainted), и мы получим ImageData без ошибки.
 *   2. Если Canvas оказывается tainted (SecurityError при getImageData) —
 *      значит CORS-заголовков нет. Тогда грузим изображение через fetch
 *      (fetch при наличии CORS всегда работает, если сервер разрешает),
 *      конвертируем Blob в Data URL (base64) и скармливаем его Canvas.
 *      Base64 Data URL считается «same-origin» для Canvas API.
 *   3. Если fetch тоже заблокирован (opaque response) — сообщаем об ошибке.
 */
export function useVectorizeImage(
  imageUrl: string,
  options: string | Record<string, unknown> = "posterized2"
): VectorizeState {
  const [state, setState] = useState<VectorizeState>({ status: "idle" });
  // Отменяем устаревшие запросы при смене URL
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!imageUrl) return;

    // Отменяем предыдущий запрос, если URL изменился
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({ status: "loading" });

    let cancelled = false;

    (async () => {
      try {
        // ── Шаг 1: Динамически импортируем imagetracerjs ──
        // Обязательно: dynamic import внутри useEffect, а не на уровне модуля,
        // чтобы Next.js не включал DOM-зависимую библиотеку в серверный бандл.
        const ImageTracerModule = await import(
          /* webpackChunkName: "imagetracer" */
          "imagetracerjs"
        );
        // imagetracerjs экспортирует синглтон через module.exports = new ImageTracer()
        const ImageTracer =
          (ImageTracerModule as unknown as { default: unknown }).default ??
          ImageTracerModule;

        if (cancelled) return;

        const it = ImageTracer as {
          imagedataToSVG(
            imgData: ImageData,
            opts?: string | Record<string, unknown>
          ): string;
        };

        // ── Шаг 2: Загружаем изображение в Canvas ──
        const imageData = await loadImageDataSafely(imageUrl, abort.signal);
        if (cancelled) return;

        // ── Шаг 3: Трассируем ──
        const svgString = it.imagedataToSVG(imageData, options);

        if (!cancelled) {
          setState({ status: "done", svg: svgString });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Vectorization failed";
          setState({ status: "error", message: msg });
        }
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [imageUrl, options]);

  return state;
}

/**
 * Загружает изображение в Canvas и возвращает ImageData.
 *
 * Стратегия двойной попытки для CORS:
 *   1. crossOrigin='Anonymous' → если getImageData не бросает SecurityError → ✅
 *   2. fetch → Blob → base64 DataURL → Canvas (всегда same-origin) → ✅
 */
async function loadImageDataSafely(
  url: string,
  signal: AbortSignal
): Promise<ImageData> {
  // Попытка 1: прямая загрузка с CORS
  try {
    return await loadViaImageTag(url, true);
  } catch {
    // Скорее всего, SecurityError — Canvas tainted или нет CORS-заголовков
  }

  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  // Попытка 2: fetch → Blob → base64
  try {
    const response = await fetch(url, { signal, mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const dataUrl = await blobToDataURL(blob);
    return await loadViaImageTag(dataUrl, false);
  } catch (fetchErr) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw new Error(
      `Cannot load image for vectorization. ` +
        `Ensure the image server sends Access-Control-Allow-Origin header. ` +
        `Original error: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`
    );
  }
}

/** Грузит изображение через <img>, рисует на Canvas, извлекает ImageData. */
function loadViaImageTag(url: string, cors: boolean): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "Anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas 2D context unavailable"));
      ctx.drawImage(img, 0, 0);
      try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(data);
      } catch (e) {
        reject(e); // SecurityError → Canvas tainted
      }
    };

    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Blob → base64 Data URL через FileReader. */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ============================================================
 * Skeleton Loader
 * ========================================================== */

function IllustrationSkeleton() {
  return (
    <div
      className="w-full overflow-hidden rounded-md"
      style={{ aspectRatio: "4/3" }}
      role="status"
      aria-label="Векторизация изображения…"
    >
      <motion.div
        className="h-full w-full"
        style={{
          background:
            "linear-gradient(90deg, #1f1f23 0%, #27272a 40%, #3f3f46 50%, #27272a 60%, #1f1f23 100%)",
          backgroundSize: "200% 100%",
        }}
        animate={{ backgroundPosition: ["200% 0", "-200% 0"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
      />
      <div className="mt-2 flex items-center gap-1.5">
        <motion.div
          className="h-1.5 w-1.5 rounded-full bg-blue-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: 0 }}
        />
        <motion.div
          className="h-1.5 w-1.5 rounded-full bg-blue-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: 0.3 }}
        />
        <motion.div
          className="h-1.5 w-1.5 rounded-full bg-blue-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: 0.6 }}
        />
        <span className="ml-1 text-[10px] text-zinc-500">Векторизация…</span>
      </div>
    </div>
  );
}

/* ============================================================
 * Error state
 * ========================================================== */

function IllustrationError({ message, imageUrl }: { message: string; imageUrl: string }) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-red-900/40 bg-red-950/20 p-3">
      <p className="text-xs font-semibold text-red-400">Ошибка векторизации</p>
      <p className="text-[11px] leading-relaxed text-red-300/70">{message}</p>
      {/* Фолбэк: оригинальная растровая картинка */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Fallback illustration"
        className="mt-1 w-full rounded opacity-60"
        style={{ mixBlendMode: "multiply" }}
      />
    </div>
  );
}

/* ============================================================
 * SVG-слой стрелок (Слой 2, z-index: 20)
 * ========================================================== */

interface ArrowsLayerProps {
  labels: IllustrationLabel[];
  animate: boolean;
}

function ArrowsLayer({ labels, animate }: ArrowsLayerProps) {
  const markerId = useId();
  // Уникальный id через useId: react гарантирует отсутствие коллизий
  const safeId = markerId.replace(/:/g, "");
  const arrowLabels = labels.filter((l) => l.arrow_to != null);
  if (arrowLabels.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 20,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        <marker
          id={`arrow-${safeId}`}
          markerWidth="7"
          markerHeight="7"
          refX="5"
          refY="3.5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <polyline
            points="0,0 7,3.5 0,7"
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </marker>
      </defs>

      {arrowLabels.map((label, i) => {
        const { x, y, arrow_to, color = "rgba(255,255,255,0.85)" } = label;
        // Стартуем из правого-нижнего угла лейбла (≈ +2% X, +1.5% Y)
        const x1 = x + 2;
        const y1 = y + 1.5;
        const x2 = arrow_to!.x;
        const y2 = arrow_to!.y;

        const line = (
          <line
            x1={`${x1}%`}
            y1={`${y1}%`}
            x2={`${x2}%`}
            y2={`${y2}%`}
            stroke={color}
            strokeWidth="1.5"
            markerEnd={`url(#arrow-${safeId})`}
            style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.7))" }}
          />
        );

        if (animate) {
          return (
            <motion.g
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.25 }}
            >
              {line}
            </motion.g>
          );
        }
        return <g key={i}>{line}</g>;
      })}
    </svg>
  );
}

/* ============================================================
 * Один лейбл (Слой 3, z-index: 30)
 * ========================================================== */

function hasLatex(text: string) { return /\$/.test(text); }
function isBlockLatex(text: string) { return /^\$\$[\s\S]+\$\$$/.test(text.trim()); }
function extractLatex(text: string): string {
  const t = text.trim();
  if (/^\$\$[\s\S]+\$\$$/.test(t)) return t.slice(2, -2).trim();
  if (/^\$[\s\S]+\$$/.test(t))     return t.slice(1, -1).trim();
  return t;
}

interface LabelProps {
  label: IllustrationLabel;
  animate: boolean;
}

function Label({ label, animate }: LabelProps) {
  const { content, x, y, color = "#ffffff", fontSize = 0.85 } = label;

  const inner = hasLatex(content)
    ? isBlockLatex(content)
      ? <BlockMath errorColor="#f87171">{extractLatex(content)}</BlockMath>
      : <InlineMath>{extractLatex(content)}</InlineMath>
    : <span>{content}</span>;

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${x}%`,
    top: `${y}%`,
    color,
    fontSize: `${fontSize}rem`,
    lineHeight: 1.35,
    zIndex: 30,
    maxWidth: `${Math.max(10, 100 - x)}%`,
    textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)",
    pointerEvents: "none",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  if (animate) {
    return (
      <motion.div
        style={style}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {inner}
      </motion.div>
    );
  }

  return <div style={style}>{inner}</div>;
}

/* ============================================================
 * Слой 1: Векторизованное SVG (z-index: 10)
 * ========================================================== */

/**
 * Патчим SVG-строку от imagetracerjs:
 *  • Убираем жёстко заданные width/height в пикселях — хотим чтобы SVG
 *    занимало 100% ширины родительского контейнера.
 *  • Добавляем preserveAspectRatio для корректного масштабирования.
 *  • Добавляем style="mix-blend-mode: multiply" — белый фон растворяется.
 */
function patchSvgString(raw: string): string {
  return raw
    // Убираем фиксированный width="NNNpx" и height="NNNpx"
    .replace(/\s+width="[^"]*"/, ' width="100%"')
    .replace(/\s+height="[^"]*"/, ' height="auto"')
    // Добавляем preserveAspectRatio если его ещё нет
    .replace(/<svg([^>]*)>/, (match, attrs: string) => {
      const hasPAR = /preserveAspectRatio/.test(attrs);
      const hasStyle = /style=/.test(attrs);
      const newAttrs = [
        attrs,
        !hasPAR ? 'preserveAspectRatio="xMidYMid meet"' : "",
        !hasStyle ? 'style="display:block;mix-blend-mode:multiply;width:100%;height:auto;"' : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<svg ${newAttrs}>`;
    });
}

interface VectorLayerProps {
  imageUrl: string;
  tracerOptions: string | Record<string, unknown>;
  animate: boolean;
}

function VectorLayer({ imageUrl, tracerOptions, animate }: VectorLayerProps) {
  const state = useVectorizeImage(imageUrl, tracerOptions);

  return (
    <AnimatePresence mode="wait">
      {state.status === "idle" || state.status === "loading" ? (
        <motion.div
          key="skeleton"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{ position: "relative", zIndex: 10, width: "100%" }}
        >
          <IllustrationSkeleton />
        </motion.div>
      ) : state.status === "error" ? (
        <motion.div
          key="error"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{ position: "relative", zIndex: 10, width: "100%" }}
        >
          <IllustrationError message={state.message} imageUrl={imageUrl} />
        </motion.div>
      ) : (
        <motion.div
          key="svg"
          initial={animate ? { opacity: 0, scale: 0.98 } : undefined}
          animate={animate ? { opacity: 1, scale: 1 } : undefined}
          transition={{ duration: 0.5, ease: "easeOut" }}
          style={{
            position: "relative",
            zIndex: 10,
            width: "100%",
            // mix-blend-mode применяется и к контейнеру на случай если
            // SVG патч не отработал (напр. нестандартный формат вывода)
            mixBlendMode: "multiply",
            lineHeight: 0, // убирает щель под inline-block SVG
          }}
          // dangerouslySetInnerHTML безопасен здесь: SVG генерируется
          // локально клиентской библиотекой imagetracerjs, а не с сервера.
          dangerouslySetInnerHTML={{ __html: patchSvgString(state.svg) }}
        />
      )}
    </AnimatePresence>
  );
}

/* ============================================================
 * Одна иллюстрация (полный Z-index sandwich)
 * ========================================================== */

interface IllustrationProps {
  command: ImageWithLabelsCommand;
  maxWidth: string;
  showTitle?: string;
  animate: boolean;
  tracerOptions: string | Record<string, unknown>;
}

function Illustration({
  command,
  maxWidth,
  showTitle,
  animate,
  tracerOptions,
}: IllustrationProps) {
  const { image_url, labels = [] } = command;

  return (
    <div style={{ maxWidth, width: "100%" }}>
      {showTitle && (
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {showTitle}
        </p>
      )}

      {/*
       * Контейнер: position: relative — точка отсчёта для всех абсолютных слоёв.
       * display: inline-block: ширина прижимается к контенту (SVG), не к viewport.
       * background: transparent: сквозной — изображение сливается с доской.
       */}
      <div
        style={{
          position: "relative",
          display: "inline-block",
          width: "100%",
          background: "transparent",
        }}
      >
        {/* ── Слой 1: Векторизованное SVG (z-index: 10) ── */}
        <VectorLayer
          imageUrl={image_url}
          tracerOptions={tracerOptions}
          animate={animate}
        />

        {/* ── Слой 2: SVG стрелки (z-index: 20) ── */}
        <ArrowsLayer labels={labels} animate={animate} />

        {/* ── Слой 3: KaTeX лейблы (z-index: 30) ── */}
        {labels.map((label, i) => (
          <Label key={i} label={label} animate={animate} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * Публичный компонент
 * ========================================================== */

export function ScientificIllustration({
  board_steps,
  className,
  maxWidth = "100%",
  showStepTitle = false,
  animate = true,
  tracerOptions = "posterized2",
}: ScientificIllustrationProps) {
  const illustrations: Array<{
    command: ImageWithLabelsCommand;
    title?: string;
  }> = [];

  const steps = Array.isArray(board_steps) ? board_steps : [];

  for (const step of steps) {
    const commands = Array.isArray(step?.commands) ? step.commands : [];
    for (const cmd of commands) {
      if (cmd.type === "image_with_labels") {
        illustrations.push({
          command: cmd as ImageWithLabelsCommand,
          title: step.title,
        });
      }
    }
  }

  if (illustrations.length === 0) return null;

  return (
    <div
      className={cn("flex w-full flex-col gap-6", className)}
      role="region"
      aria-label="Научные иллюстрации"
    >
      {illustrations.map(({ command, title }, idx) => (
        <Illustration
          key={`${command.image_url}-${idx}`}
          command={command}
          maxWidth={maxWidth}
          showTitle={showStepTitle && title ? title : undefined}
          animate={animate}
          tracerOptions={tracerOptions}
        />
      ))}
    </div>
  );
}

export default ScientificIllustration;
