import React, { useState, useEffect, useRef } from 'react';
import rough from 'roughjs/bin/rough';
import Latex from 'react-latex-next';
import 'katex/dist/katex.min.css';
import type { ShapeKind } from '@/stores/whiteboard';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
}

/**
 * Хук для эффекта пишущей машинки с поддержкой LaTeX.
 * Если встречается '$', он выводит весь математический блок целиком,
 * чтобы избежать артефактов парсинга незаконченных формул.
 */
function useTypewriter(content: string, speed: number) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
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
  content, 
  typewriterDelay = 30,
  width,
  fontSize,
  lineHeight,
  color,
  variant = 'body',
}) => {
  const displayedContent = useTypewriter(content, typewriterDelay);
  const isTable = variant === 'table';
  const isHeading = variant === 'heading';
  const effectiveFontSize = fontSize ?? (isHeading ? 24 : isTable ? 16 : 20);
  const effectiveLineHeight = lineHeight ?? (isHeading ? 1.18 : isTable ? 1.35 : 1.28);

  return (
    <div
      className={[
        isTable ? 'font-mono' : 'font-virgil',
        'whitespace-pre-wrap break-words text-zinc-100',
        isHeading ? 'font-semibold' : '',
      ].join(' ')}
      style={{
        width,
        maxWidth: width,
        fontSize: effectiveFontSize,
        lineHeight: effectiveLineHeight,
        color: color ?? '#f8fafc',
        letterSpacing: 0,
        textShadow: '0 1px 2px rgba(0,0,0,0.45)',
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
}

/** Простой эвалюатор функции с заменой x^2 на x**2 */
const evaluate = (funcStr: string, x: number) => {
  try {
    const safeFunc = funcStr.replace(/\^/g, '**');
    const evaluator = new Function('x', `with(Math) { return ${safeFunc}; }`);
    return evaluator(x);
  } catch (e) {
    return 0;
  }
};

export const GraphRenderer: React.FC<GraphRendererProps> = ({ 
  id, 
  func, 
  domain, 
  width = 300, 
  height = 300 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Очистка холста
    ctx.clearRect(0, 0, width, height);

    // Подключение rough.js
    const rc = rough.canvas(canvas);
    
    // Генерация фиксированного seed на основе ID элемента
    let seed = 0;
    for (let i = 0; i < id.length; i++) {
      seed = (seed << 5) - seed + id.charCodeAt(i);
      seed |= 0;
    }
    const safeSeed = Math.abs(seed) || 1;

    const options = {
      seed: safeSeed,
      stroke: '#e4e4e7', // zinc-200
      strokeWidth: 2,
      roughness: 1.5,
      bowing: 1,
    };

    // Отрисовка координатных осей
    rc.line(0, height / 2, width, height / 2, { ...options, strokeWidth: 1, stroke: '#52525b' });
    rc.line(width / 2, 0, width / 2, height, { ...options, strokeWidth: 1, stroke: '#52525b' });

    // Генерация точек графика
    const points: [number, number][] = [];
    const steps = 60;
    const [minX, maxX] = domain;
    
    let minY = Infinity;
    let maxY = -Infinity;
    const rawPoints = [];
    
    // Вычисление значений функции
    for (let i = 0; i <= steps; i++) {
      const x = minX + (maxX - minX) * (i / steps);
      const y = evaluate(func, x);
      rawPoints.push({ x, y });
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Защита от деления на ноль для константных функций
    const MathRangeX = maxX - minX || 1;
    const MathRangeY = maxY - minY || 1;

    rawPoints.forEach(p => {
      // Масштабирование x и инверсия y для canvas
      const px = ((p.x - minX) / MathRangeX) * width;
      const py = height - ((p.y - minY) / MathRangeY) * height;
      points.push([px, py]);
    });

    // Отрисовка скетч-линии
    if (points.length > 1) {
      rc.curve(points, options);
    }

  }, [id, func, domain, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
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
