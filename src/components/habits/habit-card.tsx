"use client";

// Карточка привычки. Нажатие в любом месте отмечает сегодня: цвет разливается от места
// нажатия, разлетаются конфетти, число серии перекатывается, по квадратикам бежит волна.
//
// Один квадратик это один день, и прошлые дни не нажимаются: отметка бывает только за
// сегодня, а повторное нажатие снимает только её.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";

import { Icon } from "@/components/shell/icons";

import { CardMenu } from "./card-menu";
import { habitColors, habitIcon, plural, streakWord, weekCells } from "./habit-days";
import { habitWhen, sameSchedule, type HabitSchedule } from "./habit-schedule";
import type { Habit } from "./lib";
import { SchedulePicker } from "./schedule-picker";

function motionOk(): boolean {
  return window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
}

export function HabitGlyph({ name, emoji }: { name: string; emoji: string }) {
  const icon = habitIcon(name);
  if (icon) return <Icon name={icon} />;
  if (emoji) {
    return (
      <span className="hb-emoji" aria-hidden="true">
        {emoji}
      </span>
    );
  }
  return <Icon name="flame" />;
}

/** Число серии: старое уезжает вверх, новое приезжает снизу. */
function StreakRoll({ value }: { value: number }) {
  const [state, setState] = useState({ shown: value, leaving: null as number | null, rolling: false });
  const shownRef = useRef(value);

  useEffect(() => {
    const previous = shownRef.current;
    if (previous === value) return;
    shownRef.current = value;
    if (!motionOk()) {
      setState({ shown: value, leaving: null, rolling: false });
      return;
    }
    setState({ shown: value, leaving: previous, rolling: true });
    const gone = window.setTimeout(() => setState((now) => ({ ...now, leaving: null })), 300);
    const settled = window.setTimeout(() => setState((now) => ({ ...now, rolling: false })), 320);
    return () => {
      window.clearTimeout(gone);
      window.clearTimeout(settled);
    };
  }, [value]);

  return (
    <span className="hb-roll">
      {state.leaving !== null ? (
        <b key={`old-${state.leaving}`} className="out">
          {state.leaving}
        </b>
      ) : null}
      <b key={`now-${state.shown}`} className={state.rolling ? "in" : undefined}>
        {state.shown}
      </b>
    </span>
  );
}

function burst(host: HTMLElement, x: number, y: number, colors: readonly string[]) {
  for (let i = 0; i < 20; i += 1) {
    const bit = document.createElement("span");
    const angle = (i / 20) * Math.PI * 2 + Math.random() * 0.5;
    const reach = 46 + Math.random() * 74;
    bit.className = `hb-bit${i % 3 === 0 ? " round" : ""}`;
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.setProperty("--dx", `${(Math.cos(angle) * reach).toFixed(0)}px`);
    bit.style.setProperty("--dy", `${(Math.sin(angle) * reach - 18).toFixed(0)}px`);
    bit.style.setProperty("--rot", `${(Math.random() * 500 - 250).toFixed(0)}deg`);
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${(Math.random() * 60).toFixed(0)}ms`;
    host.appendChild(bit);
    window.setTimeout(() => bit.remove(), 900);
  }
}

function wave(card: HTMLElement, streak: number) {
  const cells = Array.from(card.querySelectorAll<HTMLElement>(".hb-days i[data-day]"));
  cells.slice(-Math.max(1, Math.min(streak, 16))).forEach((cell, index) => {
    cell.style.animationDelay = `${index * 26}ms`;
    cell.classList.add("wave");
    window.setTimeout(() => {
      cell.classList.remove("wave");
      cell.style.animationDelay = "";
    }, 460 + index * 26);
  });
}

export interface GoalOption {
  id: string;
  title: string;
}

export function HabitCard({
  habit,
  goals,
  fresh,
  onToggle,
  onRename,
  onSchedule,
  onLink,
  onDelete,
}: {
  habit: Habit;
  /** Цели, с которыми можно связать привычку. */
  goals: readonly GoalOption[];
  fresh: boolean;
  /** Переключает сегодня и говорит, что получилось. `null`: нажатие ничего не изменило. */
  onToggle: (habit: Habit) => { done: boolean; streak: number } | null;
  onRename: (habit: Habit, name: string) => void;
  onSchedule: (habit: Habit, schedule: HabitSchedule) => void;
  onLink: (habit: Habit, goalId: string | null) => void;
  onDelete: (habit: Habit) => void;
}) {
  const card = useRef<HTMLElement>(null);
  const bits = useRef<HTMLSpanElement>(null);
  const { h1, h2 } = habitColors(habit.color, habit.id);
  const cells = useMemo(() => weekCells(habit.calendar), [habit.calendar]);
  const weeks = Math.ceil(cells.length / 7);
  const when = habitWhen(habit);
  const resting = !habit.dueToday && !habit.doneToday;

  const press =(event: MouseEvent<HTMLElement>) => {
    const element = card.current;
    if (!element || (event.target as HTMLElement).closest("a")) return;
    const box = element.getBoundingClientRect();
    // Нажатие с клавиатуры приходит без координат: тогда из центра.
    const keyboard = event.detail === 0;
    const x = keyboard ? box.width / 2 : event.clientX - box.left;
    const y = keyboard ? box.height / 2 : event.clientY - box.top;
    element.style.setProperty("--x", `${x}px`);
    element.style.setProperty("--y", `${y}px`);

    const result = onToggle(habit);
    if (!result?.done || !motionOk()) return;
    // Классы карточки и квадратиков пишет React: своё добавляем уже после него.
    requestAnimationFrame(() => {
      element.classList.remove("pop");
      void element.offsetWidth;
      element.classList.add("pop");
      if (bits.current) burst(bits.current, x, y, [h1, h2, "#ffffff", "#ffe27a", "#ff9ec9"]);
      wave(element, result.streak);
    });
  };

  return (
    <article
      ref={card}
      id={`h${habit.id}`}
      className={`hb${habit.doneToday ? " is-done" : ""}${resting ? " is-rest" : ""}${fresh ? " fresh" : ""}`}
      style={{ "--h1": h1, "--h2": h2 } as CSSProperties}
      data-attach={`Привычка: ${habit.name}`}
      onClick={press}
    >
      <span className="hb-bg" aria-hidden="true">
        <span className="hb-fill" />
      </span>
      <button
        className="hb-tap"
        type="button"
        aria-pressed={habit.doneToday}
        aria-label={`${habit.name}, сегодня${when ? `. ${when}` : ""}`}
      >
        <span className="hb-ic">
          <HabitGlyph name={habit.name} emoji={habit.emoji} />
          <Icon name="check" className="hb-ok" />
        </span>
        <span className="hb-name">
          {habit.name}
          {when ? <span className="hb-when">{when}</span> : null}
        </span>
        <span className="hb-n">
          <StreakRoll value={habit.streak} />
          <small>{streakWord(habit.streak, habit.frequency === "daily")}</small>
        </span>
      </button>
      <div className="hb-line">
        {habit.goalId ? (
          <Link className="hb-goal" href="/dashboard/goals">
            {habit.goalTitle}
          </Link>
        ) : (
          <span className="hb-goal none">Без цели</span>
        )}
        <CardMenu label={`Меню привычки: ${habit.name}`}>
          {(close) => (
            <HabitMenu
              habit={habit}
              goals={goals}
              close={close}
              onRename={onRename}
              onSchedule={onSchedule}
              onLink={onLink}
              onDelete={onDelete}
            />
          )}
        </CardMenu>
      </div>
      <div
        className="hb-days"
        role="img"
        aria-label={`Последние ${weeks} ${plural(weeks, "неделя", "недели", "недель")}, серия ${habit.streak}`}
      >
        {cells.map((cell) =>
          cell.real ? (
            <i
              key={cell.key}
              data-day={cell.key}
              className={[cell.done ? "on" : "", cell.off ? "off" : "", cell.today ? "today" : ""].filter(Boolean).join(" ") || undefined}
            />
          ) : (
            <i key={cell.key} className="future" />
          ),
        )}
      </div>
      {/* Конфетти добавляются сюда мимо React: коробки у этого узла нет, отсчёт идёт от карточки. */}
      <span ref={bits} className="hb-bits" aria-hidden="true" />
    </article>
  );
}

function HabitMenu({
  habit,
  goals,
  close,
  onRename,
  onSchedule,
  onLink,
  onDelete,
}: {
  habit: Habit;
  goals: readonly GoalOption[];
  close: () => void;
  onRename: (habit: Habit, name: string) => void;
  onSchedule: (habit: Habit, schedule: HabitSchedule) => void;
  onLink: (habit: Habit, goalId: string | null) => void;
  onDelete: (habit: Habit) => void;
}) {
  const [page, setPage] = useState<"root" | "rename" | "schedule" | "goal">("root");
  const [name, setName] = useState(habit.name);
  const [schedule, setSchedule] = useState<HabitSchedule>(habit);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (page === "root") return;
    const first = box.current?.querySelector<HTMLElement>("input, button");
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, [page]);

  if (page === "rename") {
    return (
      <div ref={box}>
        <form
          className="gm-form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (next && next !== habit.name) onRename(habit, next);
            close();
          }}
        >
          <input
            className="gm-input"
            type="text"
            value={name}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            aria-label="Новое название привычки"
            autoComplete="off"
          />
          <div className="gm-acts">
            <button className="btn btn-main" type="submit">
              Сохранить
            </button>
            <button className="btn btn-text" type="button" onClick={close}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (page === "schedule") {
    return (
      <div ref={box}>
        <form
          className="gm-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!sameSchedule(schedule, habit)) onSchedule(habit, schedule);
            close();
          }}
        >
          <SchedulePicker value={schedule} onChange={setSchedule} />
          <div className="gm-acts">
            <button className="btn btn-main" type="submit">
              Сохранить
            </button>
            <button className="btn btn-text" type="button" onClick={close}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (page === "goal") {
    const pick = (goalId: string | null) => {
      if (goalId !== habit.goalId) onLink(habit, goalId);
      close();
    };
    return (
      <div ref={box}>
        {goals.length === 0 ? (
          <p className="gm-note">
            Целей пока нет. <Link className="link" href="/dashboard/goals">Создать</Link>
          </p>
        ) : null}
        {goals.map((goal) => (
          <button key={goal.id} className="gm-item" type="button" onClick={() => pick(goal.id)}>
            <span className="gm-text">{goal.title}</span>
            {habit.goalId === goal.id ? <Icon name="check" /> : null}
          </button>
        ))}
        <button className="gm-item" type="button" onClick={() => pick(null)}>
          <span className="gm-text">Без цели</span>
          {habit.goalId === null ? <Icon name="check" /> : null}
        </button>
      </div>
    );
  }

  return (
    <>
      <button className="gm-item" type="button" onClick={() => setPage("rename")}>
        <Icon name="pencil" />
        <span className="gm-text">Переименовать</span>
      </button>
      <button className="gm-item" type="button" onClick={() => setPage("schedule")}>
        <Icon name="plan" />
        <span className="gm-text">Как часто</span>
      </button>
      <button className="gm-item" type="button" onClick={() => setPage("goal")}>
        <Icon name="mountain" />
        <span className="gm-text">{habit.goalId ? "Другая цель" : "Связать с целью"}</span>
      </button>
      <button
        className="gm-item"
        type="button"
        onClick={() => {
          close();
          onDelete(habit);
        }}
      >
        <Icon name="x" />
        <span className="gm-text">Удалить</span>
      </button>
    </>
  );
}
