"use client";

// Новая цель: выбор слева, живая плашка справа. То же окно правит уже созданную цель.
// Строка «своими словами» только заполняет его: сохраняет человек своей кнопкой.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { HabitGlyph } from "@/components/habits/habit-card";
import { Icon } from "@/components/shell/icons";
import type { Habit } from "@/components/habits/lib";
import { coverClass } from "@/lib/curriculum-cover";

import { GoalCard } from "./goal-plaque";
import { TONES, dueOptions, type Goal, type GoalScope, type Tone } from "./goal-logic";
import type { Lesson } from "./lessons-data";

export interface GoalDraft {
  /** `null`: цель новая. */
  id: string | null;
  title: string;
  scope: GoalScope;
  due: string | null;
  tone: Tone;
  lessons: string[];
  /** Уже существующие привычки, которые ведут к цели. */
  habitIds: number[];
  /** Какие из предложенных привычек создать вместе с целью. */
  newHabits: string[];
  /** Предложенные привычки: их ещё нет. */
  ideas: string[];
  /** Что понял разбор: показывается под названием. */
  note: string;
  progress: number;
}

const TONE_NAMES: Record<Tone, string> = {
  indigo: "индиго",
  rose: "розовый",
  teal: "бирюзовый",
  blue: "синий",
  amber: "янтарный",
};

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Chip({
  label,
  pressed,
  suggested,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  suggested?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      className="gs-chip"
      type="button"
      aria-pressed={pressed}
      data-suggested={suggested ? "" : undefined}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** Что под названием цели: обложки её предметов и значки привычек с числом дней. */
export function GoalLinks({
  lessons,
  habits,
  linked = true,
}: {
  lessons: ReadonlyArray<Pick<Lesson, "id" | "subject">>;
  habits: readonly Habit[];
  /** В предпросмотре значки не ведут никуда: окно ещё открыто. */
  linked?: boolean;
}) {
  return (
    <>
      {lessons.map((lesson) => (
        <span key={lesson.id} className={`book mini ${coverClass(lesson.subject)}`} title={lesson.subject} />
      ))}
      {habits.map((habit) => {
        const title = `${habit.name}, серия ${habit.streak}`;
        const body = (
          <>
            <HabitGlyph name={habit.name} emoji={habit.emoji} />
            {habit.streak}
          </>
        );
        return linked ? (
          <Link key={habit.id} className="gl-hb" href={`/dashboard/habits#h${habit.id}`} title={title} aria-label={title}>
            {body}
          </Link>
        ) : (
          <span key={habit.id} className="gl-hb" title={title}>
            {body}
          </span>
        );
      })}
    </>
  );
}

export function GoalSheet({
  seed,
  today,
  habits,
  lessons,
  onClose,
  onSave,
}: {
  seed: GoalDraft;
  today: string;
  habits: readonly Habit[];
  /** `null`: предметы ещё грузятся или не загрузились. */
  lessons: readonly Lesson[] | null;
  onClose: () => void;
  /** Бросает ошибку, если цель не сохранилась: окно остаётся открытым, ничего не теряется. */
  onSave: (draft: GoalDraft) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(seed);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    titleField.current?.focus();
  }, []);

  const set = (patch: Partial<GoalDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      titleField.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ ...draft, title });
      dialog.current?.close();
    } catch {
      setError("Не получилось сохранить цель. Проверь связь и попробуй ещё раз.");
      setSaving(false);
    }
  };

  const options = dueOptions(today);
  const custom = draft.due !== null && !options.some((option) => option.date === draft.due);

  const preview: Goal = {
    id: draft.id ?? "preview",
    title: draft.title.trim() || "Твоя цель",
    type: "goal",
    status: "active",
    scope: draft.scope,
    tone: draft.tone,
    isMain: false,
    progress: draft.progress,
    savedProgress: draft.progress,
    manual: true,
    due: draft.due,
    lessons: draft.lessons,
  };
  const previewLessons = (lessons ?? []).filter((lesson) => draft.lessons.includes(lesson.id));
  const previewHabits = habits.filter((habit) => draft.habitIds.includes(habit.id));

  return (
    <dialog
      ref={dialog}
      className="gsheet"
      aria-label={draft.id ? "Изменить цель" : "Новая цель"}
      onClose={onClose}
      onClick={(event) => {
        // Нажатие мимо окна попадает в сам <dialog>: его подложка часть элемента.
        if (event.target === dialog.current && !saving) dialog.current.close();
      }}
    >
      <form
        className="gs"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="gs-form">
          <h2 className="sec">{draft.id ? "Изменить цель" : "Новая цель"}</h2>
          <label className="gs-title">
            <span className="sr">Что хочешь</span>
            <input
              ref={titleField}
              type="text"
              value={draft.title}
              maxLength={512}
              onChange={(event) => set({ title: event.target.value })}
              placeholder="Что хочешь?"
              autoComplete="off"
            />
          </label>
          <p className="gs-ai" role={error ? "alert" : undefined}>
            {error || draft.note}
          </p>

          <div className="gs-row">
            <span className="gs-l">Какая</span>
            <div className="tabs gr-kind" role="group" aria-label="Какая цель">
              <button type="button" aria-pressed={draft.scope === "study"} onClick={() => set({ scope: "study" })}>
                Учёба
              </button>
              <button type="button" aria-pressed={draft.scope === "general"} onClick={() => set({ scope: "general" })}>
                Общая
              </button>
            </div>
          </div>

          <div className="gs-row">
            <span className="gs-l">Срок</span>
            <div className="gs-chips" role="group" aria-label="Срок">
              {options.map((option) => (
                <Chip
                  key={option.label}
                  label={option.label}
                  pressed={draft.due === option.date}
                  onClick={() => set({ due: option.date })}
                />
              ))}
              <input
                className="gs-date"
                type="date"
                value={custom ? (draft.due as string) : ""}
                min={today}
                data-on={custom ? "true" : undefined}
                onChange={(event) => {
                  if (event.target.value) set({ due: event.target.value });
                }}
                aria-label="Своя дата"
              />
              <Chip label="Без срока" pressed={draft.due === null} onClick={() => set({ due: null })} />
            </div>
          </div>

          <div className="gs-row">
            <span className="gs-l">Уроки</span>
            <div className="gs-chips" role="group" aria-label="Какие уроки входят">
              {lessons === null ? <span className="small-note gs-empty">Загружаю предметы…</span> : null}
              {lessons?.length === 0 ? (
                <span className="small-note gs-empty">
                  Предметов пока нет. <Link className="link" href="/dashboard/curriculum">Добавить</Link>
                </span>
              ) : null}
              {lessons?.map((lesson) => (
                <Chip
                  key={lesson.id}
                  label={lesson.subject}
                  pressed={draft.lessons.includes(lesson.id)}
                  onClick={() => set({ lessons: toggled(draft.lessons, lesson.id) })}
                >
                  <span className={`book mini ${coverClass(lesson.subject)}`} aria-hidden="true" />
                </Chip>
              ))}
            </div>
          </div>

          <div className="gs-row">
            <span className="gs-l">Привычки</span>
            <div className="gs-chips" role="group" aria-label="Какие привычки помогут">
              {habits.map((habit) => (
                <Chip
                  key={habit.id}
                  label={habit.name}
                  pressed={draft.habitIds.includes(habit.id)}
                  onClick={() => set({ habitIds: toggled(draft.habitIds, habit.id) })}
                >
                  <HabitGlyph name={habit.name} emoji={habit.emoji} />
                </Chip>
              ))}
              {draft.ideas.map((name) => (
                <Chip
                  key={name}
                  label={name}
                  suggested
                  pressed={draft.newHabits.includes(name)}
                  onClick={() => set({ newHabits: toggled(draft.newHabits, name) })}
                >
                  <Icon name="plus" />
                </Chip>
              ))}
              {habits.length === 0 && draft.ideas.length === 0 ? (
                <span className="small-note gs-empty">Привычек пока нет.</span>
              ) : null}
            </div>
          </div>

          <div className="gs-row">
            <span className="gs-l">Цвет</span>
            <div className="gs-tones" role="group" aria-label="Цвет карточки">
              {TONES.map((tone) => (
                <button
                  key={tone}
                  className={`gs-tone p-${tone}`}
                  type="button"
                  aria-pressed={draft.tone === tone}
                  aria-label={`Цвет: ${TONE_NAMES[tone]}`}
                  onClick={() => set({ tone })}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="gs-side">
          <div className="js-gs-preview">
            <GoalCard
              goal={preview}
              today={today}
              links={<GoalLinks lessons={previewLessons} habits={previewHabits} linked={false} />}
            />
          </div>
          <div className="gs-acts">
            <button className="btn btn-main" type="submit" disabled={saving}>
              {saving ? "Сохраняю…" : draft.id ? "Сохранить" : "Сохранить цель"}
            </button>
            <button className="btn btn-text" type="button" disabled={saving} onClick={() => dialog.current?.close()}>
              Отмена
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
