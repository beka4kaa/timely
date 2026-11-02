"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./slime.module.css";

// Слайм — талисман лендинга.
//
// Вся жизнь — в одном rAF-цикле, который пишет атрибуты SVG напрямую, без
// ререндеров React: дыхание, покачивание макушки, моргание, взгляд за курсором
// и прыжок с приземлением «на пружине». Цикл крутится, только пока слайм виден
// на экране; при prefers-reduced-motion слайм просто стоит.

const CX = 120;
const GROUND = 204;
const HALF = 94;
const TOP = 72;
const EYE_Y = 130;
// Рамка плотно облегает слайм; прыжки и падение рисуются за её пределами
// (overflow: visible), поэтому запас сверху не нужен.
const VIEW = { x: 16, y: 62, w: 208, h: 158 };

const n = (value: number, digits = 2) => value.toFixed(digits);

/**
 * Круглый приплюснутый купол: самое широкое место чуть выше земли, дно
 * подобрано под себя. `tip` сдвигает макушку вбок — отсюда «желейное»
 * покачивание.
 */
function bodyPath(tip: number) {
  const l = CX - HALF;
  const r = CX + HALF;
  const belly = GROUND - 44;
  return (
    `M${l} ${belly}` +
    `C${l} ${TOP + 26} ${n(CX - 62 + tip * 0.6)} ${TOP} ${n(CX + tip)} ${TOP}` +
    `C${n(CX + 62 + tip * 0.6)} ${TOP} ${r} ${TOP + 26} ${r} ${belly}` +
    `C${r} ${GROUND - 10} ${r - 26} ${GROUND} ${CX + 46} ${GROUND}` +
    `L${CX - 46} ${GROUND}` +
    `C${l + 26} ${GROUND} ${l} ${GROUND - 10} ${l} ${belly}Z`
  );
}

const RESTING_PATH = bodyPath(0);

type Spring = { v: number; vel: number };

function step(s: Spring, target: number, stiffness: number, damping: number, dt: number) {
  s.vel += (-stiffness * (s.v - target) - damping * s.vel) * dt;
  s.v += s.vel * dt;
}

type SlimeProps = {
  className?: string;
  /** Падает сверху при первом показе. */
  drop?: boolean;
  /** Глаза следят за курсором, наведение радует, клик — прыжок. */
  interactive?: boolean;
  /** Каждое новое значение — повод подпрыгнуть (например, смена вкладки). */
  hop?: number;
  /** Без подписи слайм — украшение и скрыт от скринридеров. */
  label?: string;
};

export function Slime({
  className,
  drop = false,
  interactive = false,
  hop = 0,
  label,
}: SlimeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const shapeRef = useRef<SVGPathElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const gazeRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const jumpRef = useRef<(power?: number) => void>(() => {});
  const lastHop = useRef(hop);

  useEffect(() => {
    const svg = svgRef.current;
    const body = bodyRef.current;
    const shape = shapeRef.current;
    const face = faceRef.current;
    const gaze = gazeRef.current;
    const eyes = eyesRef.current;
    const shadow = shadowRef.current;
    if (!svg || !body || !shape || !face || !gaze || !eyes || !shadow) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      svg.dataset.ready = "true";
      return;
    }

    const GRAVITY = 2600;
    const squash: Spring = { v: 0, vel: 0 };
    const tip: Spring = { v: 0, vel: 0 };
    const eye = { x: 0, y: 0, tx: 0, ty: 0 };
    let y = drop ? -380 : 0;
    let vy = 0;
    let airborne = drop;
    const holdUntil = drop ? performance.now() + 420 : 0;
    let t = Math.random() * 10;
    let last = performance.now();
    let raf = 0;
    let visible = false;
    let pointer: { x: number; y: number } | null = null;
    let nextLook = 0;
    let nextBlink = t + 1.2 + Math.random() * 2;
    let blinkStart = -10;
    let doubleBlink = false;

    const jump = (power = 1) => {
      if (airborne) return;
      airborne = true;
      vy = -560 * power;
      squash.vel -= 2.5;
      tip.vel += (Math.random() - 0.5) * 160;
      schedule();
    };
    jumpRef.current = jump;

    const frame = (now: number) => {
      raf = 0;

      // Сначала все чтения раскладки, потом записи — без лишних reflow.
      let rect: DOMRect | null = null;
      if (pointer && interactive) rect = svg.getBoundingClientRect();

      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      t += dt;

      if (now < holdUntil) {
        schedule();
        return;
      }
      if (svg.dataset.ready !== "true") svg.dataset.ready = "true";

      if (airborne) {
        vy += GRAVITY * dt;
        y += vy * dt;
        if (y >= 0) {
          const impact = Math.min(vy / 1000, 1.3);
          y = 0;
          // После большого падения — маленький отскок, потом покой.
          if (impact > 0.75) vy = -vy * 0.28;
          else {
            vy = 0;
            airborne = false;
          }
          squash.vel += 6 * impact;
          tip.vel += (Math.random() - 0.5) * 220 * impact;
        }
      }

      const stretch = airborne ? -Math.min(Math.abs(vy) / 4200, 0.13) : 0;
      step(squash, stretch, 240, 13, dt);
      step(tip, 0, 90, 6.5, dt);

      const breath = airborne ? 0 : 0.018 * Math.sin(t * 2.1);
      const sq = squash.v + breath;
      const sx = 1 + sq;
      const sy = Math.max(1 - sq * 1.15, 0.55);

      if (rect) {
        const ex = rect.left + rect.width * ((CX - VIEW.x) / VIEW.w);
        const ey = rect.top + rect.height * ((EYE_Y - VIEW.y) / VIEW.h);
        const dx = pointer!.x - ex;
        const dy = pointer!.y - ey;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(dist / 280, 1);
        eye.tx = (dx / dist) * 7 * reach;
        eye.ty = (dy / dist) * 5 * reach;
      } else if (t > nextLook) {
        // Без курсора слайм иногда сам оглядывается.
        nextLook = t + 1.8 + Math.random() * 2.6;
        const look = Math.random() < 0.4;
        eye.tx = look ? (Math.random() - 0.5) * 12 : 0;
        eye.ty = look ? (Math.random() - 0.5) * 6 : 0;
      }
      const follow = 1 - Math.exp(-dt * 9);
      eye.x += (eye.tx - eye.x) * follow;
      eye.y += (eye.ty - eye.y) * follow;

      if (t > nextBlink) {
        blinkStart = t;
        doubleBlink = Math.random() < 0.2;
        nextBlink = t + 2.6 + Math.random() * 3.4;
      }
      const bp = (t - blinkStart) / 0.15;
      let open = 1;
      if (bp >= 0 && bp < 1) open = 1 - 0.92 * Math.sin(Math.PI * bp);
      else if (doubleBlink && bp >= 1.6 && bp < 2.6)
        open = 1 - 0.92 * Math.sin(Math.PI * (bp - 1.6));

      body.setAttribute(
        "transform",
        `translate(0 ${n(y)}) translate(${CX} ${GROUND}) scale(${n(sx, 4)} ${n(sy, 4)}) translate(${-CX} ${-GROUND})`,
      );
      shape.setAttribute("d", bodyPath(4 * Math.sin(t * 1.3) + tip.v));
      gaze.setAttribute("transform", `translate(${n(eye.x)} ${n(eye.y)})`);
      eyes.setAttribute(
        "transform",
        `translate(0 ${EYE_Y}) scale(1 ${n(open, 3)}) translate(0 ${-EYE_Y})`,
      );
      face.setAttribute("transform", `translate(${n(eye.x * 0.45)} ${n(eye.y * 0.35)})`);

      const lift = Math.min(-y / 260, 0.7);
      const ss = 1 - lift;
      shadow.setAttribute(
        "transform",
        `translate(${CX} ${GROUND + 8}) scale(${n(sx * ss, 3)} ${n(ss, 3)}) translate(${-CX} ${-(GROUND + 8)})`,
      );
      shadow.style.opacity = n(1 - lift, 3);

      schedule();
    };

    function schedule() {
      if (visible && !document.hidden && !raf) raf = requestAnimationFrame(frame);
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        last = performance.now();
        schedule();
      }
    });
    io.observe(svg);

    const onVisibility = () => {
      last = performance.now();
      schedule();
    };
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    const onLeaveWindow = () => {
      pointer = null;
    };
    const onEnter = () => {
      svg.dataset.happy = "true";
      squash.vel += 1.6;
    };
    const onLeave = () => {
      delete svg.dataset.happy;
    };
    const onDown = () => jump(1);

    document.addEventListener("visibilitychange", onVisibility);
    if (interactive) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeaveWindow);
      svg.addEventListener("pointerenter", onEnter);
      svg.addEventListener("pointerleave", onLeave);
      svg.addEventListener("pointerdown", onDown);
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeaveWindow);
      svg.removeEventListener("pointerenter", onEnter);
      svg.removeEventListener("pointerleave", onLeave);
      svg.removeEventListener("pointerdown", onDown);
      jumpRef.current = () => {};
    };
  }, [drop, interactive]);

  useEffect(() => {
    if (lastHop.current === hop) return;
    lastHop.current = hop;
    jumpRef.current(0.8);
  }, [hop]);

  const shape = `${uid}p`;

  return (
    <svg
      ref={svgRef}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      className={`${styles.slime} ${className ?? ""}`}
      data-drop={drop ? "true" : undefined}
      data-interactive={interactive ? "true" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        {/* Цвета — CSS-переменные из slime.module.css: в тёмной теме слайм
            становится светлым, а глаза тёмными. */}
        <radialGradient id={`${uid}b`} cx="0.34" cy="0.24" r="0.92">
          <stop offset="0" style={{ stopColor: "var(--slime-hi)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--slime-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--slime-lo)" }} />
        </radialGradient>
        <radialGradient id={`${uid}g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}e`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.35" style={{ stopColor: "var(--slime-eye)" }} />
          <stop offset="1" style={{ stopColor: "var(--slime-eye-shade)" }} />
        </linearGradient>
        <radialGradient id={`${uid}s`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <path ref={shapeRef} id={shape} d={RESTING_PATH} />
        <clipPath id={`${uid}c`}>
          <use href={`#${shape}`} />
        </clipPath>
      </defs>

      <ellipse
        ref={shadowRef}
        cx={CX}
        cy={GROUND + 8}
        rx="92"
        ry="12"
        fill={`url(#${uid}s)`}
      />

      <g ref={bodyRef}>
        <use href={`#${shape}`} fill={`url(#${uid}b)`} />
        <g clipPath={`url(#${uid}c)`}>
          <ellipse
            className={styles.sheen}
            cx="104"
            cy="92"
            rx="78"
            ry="44"
            fill={`url(#${uid}g)`}
          />
          <ellipse className={styles.rim} cx="120" cy="230" rx="112" ry="40" />
        </g>
        <ellipse
          className={styles.gloss}
          cx="76"
          cy="100"
          rx="19"
          ry="8.5"
          transform="rotate(-30 76 100)"
          fill="#ffffff"
        />
        <circle className={styles.gloss} cx="98" cy="86" r="3.6" fill="#ffffff" />

        <g ref={faceRef}>
          <ellipse className={styles.mouth} cx="121" cy="164" rx="6.5" ry="4.8" />
        </g>

        <g ref={gazeRef}>
          <g ref={eyesRef} className={styles.eyesOpen}>
            <ellipse
              cx="95"
              cy={EYE_Y}
              rx="15"
              ry="20"
              transform={`rotate(-8 95 ${EYE_Y})`}
              fill={`url(#${uid}e)`}
            />
            <ellipse
              cx="146"
              cy={EYE_Y}
              rx="15.5"
              ry="20.5"
              transform={`rotate(8 146 ${EYE_Y})`}
              fill={`url(#${uid}e)`}
            />
          </g>
          <g className={styles.eyesHappy}>
            <path d={`M80 ${EYE_Y + 5} Q95 ${EYE_Y - 14} 110 ${EYE_Y + 5}`} />
            <path d={`M131 ${EYE_Y + 5} Q146 ${EYE_Y - 14} 161 ${EYE_Y + 5}`} />
          </g>
        </g>
      </g>
    </svg>
  );
}
