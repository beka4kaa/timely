"use client";

// Плашка цели: гряда, тропа к флагу и слайм там, где ученик сейчас.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";

import { Icon } from "@/components/shell/icons";

import { dueLine, dueStub, ridgeShape, walkRidge, type Goal } from "./goal-logic";

function motionOk(): boolean {
  return window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
}

/** Плавно ведёт число к новому значению: слайм идёт по тропе, а не прыгает. */
function useTween(value: number, duration = 560): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (current.current === value) return;
    if (!motionOk()) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - started) / duration);
      const next = from + (value - from) * (1 - (1 - t) ** 3);
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
}

export function RidgeArt({ id, progress, wide }: { id: string; progress: number; wide?: boolean }) {
  const shape = useMemo(() => ridgeShape(id), [id]);
  const { at, walked } = walkRidge(shape, useTween(progress));
  return (
    <svg
      className="plq-art"
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      preserveAspectRatio={`xMaxYMax ${wide ? "slice" : "meet"}`}
      aria-hidden="true"
    >
      <path d={shape.fillBack} fill="currentColor" opacity=".1" />
      <path d={shape.fill} fill="currentColor" opacity=".16" />
      <path d={shape.trail} fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray="1 7" strokeLinecap="round" opacity=".7" />
      <path d={walked} fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={shape.flag} fill="#ffffff" stroke="#ffffff" strokeWidth="2" strokeLinejoin="round" />
      <use className="hop" href="#art-slime" x={(at[0] - 19).toFixed(1)} y={(at[1] - 26).toFixed(1)} width="38" height="27" />
    </svg>
  );
}

/** Имя для перехода между местами на странице: звезда переносит плашку, а не перерисовывает. */
function transitionName(id: string): CSSProperties {
  return { viewTransitionName: `goal-${id.replace(/[^a-zA-Z0-9_-]/g, "")}` } as CSSProperties;
}

export function GoalHero({
  goal,
  today,
  fresh,
  next,
  links,
  menu,
}: {
  goal: Goal;
  today: string;
  fresh?: boolean;
  /** Следующее занятие по предметам цели. */
  next: string | null;
  links: ReactNode;
  menu: ReactNode;
}) {
  const stub = dueStub(goal.due, today);
  return (
    <section
      className={`plq plq-hero gl p-${goal.tone}${fresh ? " fresh" : ""}`}
      style={transitionName(goal.id)}
      aria-label="Главная цель"
      data-attach={`Цель: ${goal.title}`}
    >
      <RidgeArt id={goal.id} progress={goal.progress} wide />
      <div className="plq-main">
        <p className="plq-date">Главная цель, {goal.progress}% пути</p>
        <h2 className="plq-name">{goal.title}</h2>
        {next ? <p className="plq-rules">Дальше: {next}</p> : null}
        <div className="gl-links">{links}</div>
      </div>
      <div className="plq-stub">
        <span className="gl-hero-menu">{menu}</span>
        {stub.count !== null ? (
          <p className="count">
            <b>{stub.count}</b> {stub.word}
          </p>
        ) : null}
        <p className="gl-due">{stub.line}</p>
        <Link className="btn btn-plq" href="/dashboard">
          Следующий шаг
        </Link>
      </div>
    </section>
  );
}

export function GoalCard({
  goal,
  today,
  fresh,
  links,
  onMain,
  menu,
}: {
  goal: Goal;
  today: string;
  fresh?: boolean;
  links: ReactNode;
  /** Нет у предпросмотра в окне новой цели. */
  onMain?: () => void;
  menu?: ReactNode;
}) {
  return (
    <article
      className={`plq plq-card gl p-${goal.tone}${fresh ? " fresh" : ""}`}
      style={onMain ? transitionName(goal.id) : undefined}
      data-attach={onMain ? `Цель: ${goal.title}` : undefined}
    >
      <RidgeArt id={goal.id} progress={goal.progress} />
      <div className="gl-top">
        <span className="plq-date">
          {goal.scope === "study" ? "Учёба" : "Общая"}, {goal.progress}%
        </span>
        <span className="gl-tools">
          {onMain ? (
            <button
              className="gl-pin"
              type="button"
              onClick={onMain}
              title="Сделать главной"
              aria-label={`Сделать главной: ${goal.title}`}
            >
              <Icon name="star" />
            </button>
          ) : null}
          {menu}
        </span>
      </div>
      <h3 className="plq-name">{goal.title}</h3>
      <p className="plq-rules">{dueLine(goal.due, today)}</p>
      <div className="gl-links">{links}</div>
    </article>
  );
}

/** Достигнутая цель: маленькая плашка, слайм уже у флага. */
export function GoalDone({ goal, menu }: { goal: Goal; menu: ReactNode }) {
  return (
    <article className={`plq plq-mini gl gl-done p-${goal.tone}`} data-attach={`Цель: ${goal.title}`}>
      <RidgeArt id={goal.id} progress={100} />
      <div className="gl-top">
        <span className="plq-date">
          {goal.scope === "study" ? "Учёба" : "Общая"}
        </span>
        <span className="gl-tools">{menu}</span>
      </div>
      <h3 className="plq-name">{goal.title}</h3>
    </article>
  );
}
