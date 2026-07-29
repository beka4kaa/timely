import React, { useState, useEffect, useRef } from 'react';
import rough from 'roughjs/bin/rough';
import Latex from 'react-latex-next';
import 'katex/dist/katex.min.css';
import type { ShapeKind } from '@/stores/whiteboard';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Пауза в наборе, после которой черновик текста уезжает в стор доски (и,
 * следом, в автосохранение сессии). */
const TEXT_DRAFT_COMMIT_MS = 800;

/** Deterministic roughness seed derived from an element id. */
function hashSeed(id: string): number {
  let seed = 0;
  for (let i = 0; i < id.length; i++) {
    seed = (seed << 5) - seed + id.charCodeAt(i);
    seed |= 0;
  }
  return Math.abs(seed) || 1;
}

// ==========================================
// TextRenderer
// ==========================================

export interface TextRendererProps {
  id: string;
  content: string;
  typewriterDelay?: number;
  width?: number;
  fontSize?: number;
  lineHeight?: number;
  color?: string;
  variant?: 'heading' | 'body' | 'formula' | 'table';
  autoFocus?: boolean;
  /**
   * @param options.startsNewHistoryStep — правка открывает новый шаг Undo.
   * Промежуточные коммиты одного сеанса редактирования его не открывают, иначе
   * каждая пауза при наборе становилась бы отдельным Ctrl+Z.
   */
  onContentChange?: (
    content: string,
    options?: { startsNewHistoryStep?: boolean },
  ) => void;
  onEditingComplete?: () => void;
}

/**
 * Хук для эффекта пишущей машинки с поддержкой LaTeX.
 * Если встречается '$', он выводит весь математический блок целиком,
 * чтобы избежать артефактов парсинга незаконченных формул.
 */
function useTypewriter(content: string, speed: number) {
  const [displayed, setDisplayed] = useState(() => (speed <= 0 ? content : ""));

  useEffect(() => {
    if (speed <= 0) {
      setDisplayed(content);
      return;
    }

    setDisplayed("");
    let i = 0;
    let isInsideMath = false;

    const interval = setInterval(() => {
      if (i >= content.length) {
        clearInterval(interval);
        return;
      }

      if (content[i] === '$') {
        isInsideMath = !isInsideMath;
      }

      if (isInsideMath) {
        let endMathIndex = content.indexOf('$', i + 1);
        if (endMathIndex !== -1) {
          i = endMathIndex + 1;
          setDisplayed(content.slice(0, i));
          isInsideMath = false;
          return;
        }
      }

      i++;
      setDisplayed(content.slice(0, i));
    }, speed);

    return () => clearInterval(interval);
  }, [content, speed]);

  return displayed;
}

export const TextRenderer: React.FC<TextRendererProps> = ({ 
  id,
  content, 
  typewriterDelay = 30,
  width,
  fontSize,
  lineHeight,
  color,
  variant = 'body',
  autoFocus = false,
  onContentChange,
  onEditingComplete,
}) => {
  const displayedContent = useTypewriter(content, typewriterDelay);
  const isTable = variant === 'table';
  const isHeading = variant === 'heading';
  const effectiveFontSize = fontSize ?? (isHeading ? 24 : isTable ? 16 : 20);
  const effectiveLineHeight = lineHeight ?? (isHeading ? 1.16 : isTable ? 1.35 : 1.42);
  const [isEditing, setIsEditing] = useState(autoFocus);
  const [draft, setDraft] = useState(content);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorialFont = 'Georgia, "Times New Roman", Times, serif';

  useEffect(() => {
    if (!isEditing) setDraft(content);
  }, [content, isEditing]);

  useEffect(() => {
    if (autoFocus) setIsEditing(true);
  }, [autoFocus]);

  useEffect(() => {
    if (!isEditing) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.select();
  }, [isEditing]);

  // Был ли в этом сеансе редактирования хотя бы один коммит. Нужен, чтобы шаг
  // Undo открывал ПЕРВЫЙ коммит: тогда отмена возвращает текст, который был до
  // начала правки, а не промежуточное состояние набора.
  const committedDuringEditRef = useRef(false);
  useEffect(() => {
    if (isEditing) committedDuringEditRef.current = false;
  }, [isEditing]);

  const commitContent = (next: string) => {
    if (next === content) return;
    onContentChange?.(next, {
      startsNewHistoryStep: !committedDuringEditRef.current,
    });
    committedDuringEditRef.current = true;
  };

  // Промежуточный коммит черновика по паузе в наборе.
  //
  // Без него набранный текст жил только в этом компоненте до потери фокуса:
  // ученик печатал, перезагружал страницу и терял всё, потому что автосейв
  // доски подписан на стор и об изменении просто не знал.
  const commitContentRef = useRef(commitContent);
  commitContentRef.current = commitContent;
  useEffect(() => {
    if (!isEditing) return;
    const next = draft.trim();
    // Пустой черновик не коммитим: подставлять за ученика 'Текст' посреди
    // набора нельзя, это делает только осознанное завершение правки.
    if (!next) return;
    const timer = window.setTimeout(
      () => commitContentRef.current(next),
      TEXT_DRAFT_COMMIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [draft, isEditing]);

  const finishEditing = (commit: boolean) => {
    if (commit) {
      commitContent(draft.trim() || 'Текст');
    } else {
      setDraft(content);
    }
    setIsEditing(false);
    onEditingComplete?.();
  };

  if (isEditing) {
    return (
      <textarea
        ref={editorRef}
        data-whiteboard-text-editor={id}
        aria-label="Редактирование текста на доске"
        value={draft}
        rows={Math.max(1, draft.split('\n').length)}
        placeholder="Введите текст…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finishEditing(true)}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            finishEditing(false);
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            finishEditing(true);
          }
        }}
        className="resize-none overflow-hidden rounded-md border border-[#c7a06c] bg-[#fffdf9]/95 px-2 py-1.5 text-[#302d2a] shadow-[0_8px_24px_rgba(65,54,41,0.12)] outline-none"
        style={{
          width: width ?? 280,
          minHeight: effectiveFontSize * effectiveLineHeight + 14,
          fontFamily: isTable ? 'ui-monospace, monospace' : editorialFont,
          fontSize: effectiveFontSize,
          lineHeight: effectiveLineHeight,
          fontWeight: isHeading ? 600 : 400,
          letterSpacing: '-0.015em',
          color,
        }}
      />
    );
  }

  return (
    <div
      data-whiteboard-text={id}
      title="Двойной клик — редактировать"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setDraft(content);
        setIsEditing(true);
      }}
      className={[
        'whitespace-pre-wrap break-words !text-[#302d2a]',
        onContentChange ? 'cursor-text rounded-md transition-colors hover:bg-[#ebe6de]/55' : '',
      ].join(' ')}
      style={{
        width,
        maxWidth: width,
        padding: onContentChange ? '2px 4px' : undefined,
        fontFamily: isTable ? 'ui-monospace, monospace' : editorialFont,
        fontSize: effectiveFontSize,
        lineHeight: effectiveLineHeight,
        fontWeight: isHeading ? 600 : 400,
        color,
        letterSpacing: '-0.015em',
      }}
    >
      <Latex>{displayedContent}</Latex>
    </div>
  );
};

// ==========================================
// GraphRenderer
// ==========================================

export interface GraphRendererProps {
  id: string;
  func: string; // Форма функции, например "x * x - 4"
  domain: [number, number]; // [min, max]
  width?: number;
  height?: number;
  autoFocus?: boolean;
  onFunctionChange?: (func: string) => void;
  onEditingComplete?: () => void;
}

const ALLOWED_GRAPH_IDENTIFIERS = new Set([
  'x',
  'sin',
  'cos',
  'tan',
  'sqrt',
  'abs',
  'exp',
  'log',
]);

/** Ограниченный эвалюатор: только числа, x, арифметика и белый список Math. */
const evaluate = (funcStr: string, x: number) => {
  try {
    const safeFunc = funcStr.replace(/\^/g, '**').trim();
    if (!/^[0-9a-zA-Z_+\-*/().,\s]*$/.test(safeFunc)) return Number.NaN;
    const identifiers = safeFunc.match(/[a-zA-Z_]+/g) ?? [];
    if (identifiers.some((identifier) => !ALLOWED_GRAPH_IDENTIFIERS.has(identifier))) {
      return Number.NaN;
    }
    const evaluator = new Function(
      'x',
      'sin',
      'cos',
      'tan',
      'sqrt',
      'abs',
      'exp',
      'log',
      `"use strict"; return (${safeFunc});`,
    );
    const value = evaluator(
      x,
      Math.sin,
      Math.cos,
      Math.tan,
      Math.sqrt,
      Math.abs,
      Math.exp,
      Math.log,
    );
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
};

export const GraphRenderer: React.FC<GraphRendererProps> = ({ 
  id, 
  func, 
  domain, 
  width = 300, 
  height = 300,
  autoFocus = false,
  onFunctionChange,
  onEditingComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(autoFocus);
  const [draftFunction, setDraftFunction] = useState(func);

  useEffect(() => {
    if (!isEditing) setDraftFunction(func);
  }, [func, isEditing]);

  useEffect(() => {
    if (autoFocus) setIsEditing(true);
  }, [autoFocus]);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const finishGraphEditing = (commit: boolean) => {
    const normalized = draftFunction.trim();
    if (commit && normalized && normalized !== func) onFunctionChange?.(normalized);
    if (!commit) setDraftFunction(func);
    setIsEditing(false);
    onEditingComplete?.();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Очистка холста
    ctx.clearRect(0, 0, width, height);

    // Генерация точек графика
    const steps = 180;
    const [minX, maxX] = domain;
    
    let minY = Infinity;
    let maxY = -Infinity;
    const rawPoints: Array<{ x: number; y: number }> = [];
    
    // Вычисление значений функции
    for (let i = 0; i <= steps; i++) {
      const x = minX + (maxX - minX) * (i / steps);
      const y = evaluate(func, x);
      if (!Number.isFinite(y)) continue;
      rawPoints.push({ x, y });
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (rawPoints.length === 0) return;
    minY = Math.min(minY, 0);
    maxY = Math.max(maxY, 0);
    const yPadding = Math.max(1, (maxY - minY) * 0.12);
    minY -= yPadding;
    maxY += yPadding;

    const pad = { left: 34, right: 14, top: 14, bottom: 28 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const mapX = (x: number) => pad.left + ((x - minX) / (maxX - minX || 1)) * plotWidth;
    const mapY = (y: number) => pad.top + (1 - (y - minY) / (maxY - minY || 1)) * plotHeight;

    ctx.strokeStyle = '#ddd9d2';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const gx = pad.left + (plotWidth * i) / 5;
      const gy = pad.top + (plotHeight * i) / 5;
      ctx.beginPath();
      ctx.moveTo(gx, pad.top);
      ctx.lineTo(gx, pad.top + plotHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + plotWidth, gy);
      ctx.stroke();
    }

    const axisX = minX <= 0 && maxX >= 0 ? mapX(0) : pad.left;
    const axisY = minY <= 0 && maxY >= 0 ? mapY(0) : pad.top + plotHeight;
    ctx.strokeStyle = '#9f9990';
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.moveTo(pad.left, axisY);
    ctx.lineTo(pad.left + plotWidth, axisY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(axisX, pad.top);
    ctx.lineTo(axisX, pad.top + plotHeight);
    ctx.stroke();

    ctx.fillStyle = '#777168';
    ctx.font = '12px Georgia, "Times New Roman", serif';
    ctx.fillText('x', width - 12, Math.min(height - 8, axisY + 18));
    ctx.fillText('y', Math.max(6, axisX - 16), 13);
    ctx.fillText(String(minX), pad.left - 5, height - 8);
    ctx.fillText(String(maxX), width - pad.right - 12, height - 8);

    ctx.strokeStyle = '#b7792d';
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    rawPoints.forEach((point, index) => {
      const px = mapX(point.x);
      const py = mapY(point.y);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

  }, [id, func, domain, width, height]);

  return (
    <div
      data-whiteboard-graph={id}
      title="Двойной клик — изменить функцию"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setIsEditing(true);
      }}
      className="relative overflow-hidden rounded-[18px] border border-[#d8d3cb] bg-[#fbfaf7] shadow-[0_10px_30px_rgba(64,54,42,0.09)]"
    >
      <div className="flex h-10 items-center justify-between gap-3 border-b border-[#e2ded7] px-3.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#a09a91]">
          График
        </span>
        {isEditing ? (
          <input
            ref={inputRef}
            aria-label="Функция графика"
            value={draftFunction}
            onChange={(event) => setDraftFunction(event.target.value)}
            onBlur={() => finishGraphEditing(true)}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') finishGraphEditing(true);
              if (event.key === 'Escape') finishGraphEditing(false);
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-[#c7a06c] bg-white px-2 font-mono text-sm text-[#302d2a] outline-none"
          />
        ) : (
          <span className="min-w-0 truncate font-serif text-[13px] tracking-tight text-[#5f574e]">
            y = {func.replace(/\*/g, '·')}
          </span>
        )}
      </div>
      <div className="p-3">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          title={`x ∈ [${domain[0]}, ${domain[1]}]`}
          className="block rounded-md"
        />
      </div>
    </div>
  );
};

// ==========================================
// ShapeRenderer (hand-drawn via rough.js)
// ==========================================

export interface ShapeRendererProps {
  id: string;
  shape: ShapeKind;
  width: number;
  height: number;
  points?: [number, number][];
  flip?: boolean;
  color?: string;
  strokeWidth?: number;
  fill?: string;
  seed?: number;
}

/** Padding around the bbox so sketchy strokes/arrowheads aren't clipped. */
const SHAPE_PAD = 14;

export const ShapeRenderer: React.FC<ShapeRendererProps> = ({
  id,
  shape,
  width,
  height,
  points,
  flip,
  color = '#e4e4e7',
  strokeWidth = 2.5,
  fill,
  seed,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);

  // Derive bbox dimensions (point-based shapes may omit width/height).
  let W = Math.abs(width);
  let H = Math.abs(height);
  if ((shape === 'path' || shape === 'polygon') && points && points.length) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    W = Math.max(W, Math.max(0, ...xs));
    H = Math.max(H, Math.max(0, ...ys));
  }
  W = Math.max(W, 1);
  H = Math.max(H, 1);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const rc = rough.svg(svg);
    const options: any = {
      seed: seed ?? hashSeed(id),
      stroke: color,
      strokeWidth,
      roughness: 1.4,
      bowing: 1,
    };
    if (fill) {
      options.fill = fill;
      options.fillStyle = 'hachure';
      options.fillWeight = 2;
      options.hachureGap = 6;
    }

    const ox = SHAPE_PAD;
    const oy = SHAPE_PAD;
    let node: SVGGElement | null = null;

    switch (shape) {
      case 'rect':
        node = rc.rectangle(ox, oy, W, H, options);
        break;
      case 'ellipse':
        node = rc.ellipse(ox + W / 2, oy + H / 2, W, H, options);
        break;
      case 'line':
      case 'arrow': {
        // Default diagonal: top-left → bottom-right. flip → bottom-left → top-right.
        const sx = ox;
        const sy = flip ? oy + H : oy;
        const ex = ox + W;
        const ey = flip ? oy : oy + H;
        const line = rc.line(sx, sy, ex, ey, options);
        if (shape === 'arrow') {
          const ang = Math.atan2(ey - sy, ex - sx);
          const len = Math.max(12, Math.min(26, Math.hypot(W, H) * 0.22));
          const head = rc.linearPath(
            [
              [ex + Math.cos(ang + Math.PI - 0.45) * len, ey + Math.sin(ang + Math.PI - 0.45) * len],
              [ex, ey],
              [ex + Math.cos(ang + Math.PI + 0.45) * len, ey + Math.sin(ang + Math.PI + 0.45) * len],
            ],
            options
          );
          const grp = document.createElementNS(SVG_NS, 'g') as unknown as SVGGElement;
          grp.appendChild(line);
          grp.appendChild(head);
          node = grp;
        } else {
          node = line;
        }
        break;
      }
      case 'polygon':
      case 'path': {
        const raw: [number, number][] =
          points && points.length ? points : [[0, 0], [W, H]];
        const pts: [number, number][] = raw.map(([x, y]) => [ox + x, oy + y]);
        node = shape === 'polygon' ? rc.polygon(pts, options) : rc.curve(pts, options);
        break;
      }
      default:
        node = rc.rectangle(ox, oy, W, H, options);
    }

    if (node) svg.appendChild(node);
  }, [id, shape, W, H, points, flip, color, strokeWidth, fill, seed]);

  return (
    <svg
      ref={svgRef}
      width={W + SHAPE_PAD * 2}
      height={H + SHAPE_PAD * 2}
      style={{ display: 'block', marginLeft: -SHAPE_PAD, marginTop: -SHAPE_PAD, overflow: 'visible' }}
    />
  );
};

// ==========================================
// ImageRenderer
// ==========================================

export interface ImageRendererProps {
  id: string;
  src: string;
  width: number;
  height: number;
}

export const ImageRenderer: React.FC<ImageRendererProps> = ({ src, width, height }) => {
  return (
    <img 
      src={src} 
      alt="Whiteboard Element" 
      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
      draggable={false} // Disable native browser drag
    />
  );
};
