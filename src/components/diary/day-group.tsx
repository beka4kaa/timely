"use client";

// Один день сдачи: заголовок, задания и строка «Добавить задание».

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { useSmoothInput } from "@/components/shell/smooth-input";
import {
  freeClasses,
  splitTestWords,
  taskText,
  taskTitle,
  type DayGroup,
} from "@/lib/diary-tasks";
import { TASK_MINUTES } from "@/lib/diary-plan";
import { lessonTitle } from "@/lib/now-feed";
import { isTestBlock, type DiaryDay, type DiaryLesson, type DiaryWeek } from "@/types/diary";
import type { DiaryPlanApi } from "./use-diary-plan";
import type { DiaryWeekApi } from "./use-diary-week";

/** Текст задания: слова про контрольную выделены, как в согласованном прототипе. */
function TaskText({ text }: { text: string }) {
  return (
    <>
      {splitTestWords(text).map((part, index) =>
        part.test ? (
          <span key={index} className="test">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Правка текста на месте. Enter и уход с поля сохраняют, Esc отменяет. */
function TaskInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (text: string, viaKeyboard: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const fieldRef = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  useSmoothInput(fieldRef);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const finish = (viaKeyboard: boolean) => {
    if (closed.current) return;
    closed.current = true;
    onCommit(value, viaKeyboard);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closed.current = true;
      onCancel();
    }
  };

  return (
    <span className="ti-host dy-input">
      <input
        ref={fieldRef}
        value={value}
        aria-label={label}
        placeholder="Что задано"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(false)}
      />
    </span>
  );
}

function PlanPreview({
  day,
  lesson,
  plan,
  week,
}: {
  day: DiaryDay;
  lesson: DiaryLesson;
  plan: DiaryPlanApi;
  week: DiaryWeek;
}) {
  const step = plan.step?.lessonId === lesson.id ? plan.step : null;
  if (!step || step.kind === "finding") return null;

  if (step.kind === "preview") {
    return (
      <div className="dy-plan" role="status">
        <span>
          Поставлю {plan.whenLabel(step.slot.start, step.timeZone)}, на {TASK_MINUTES} минут.
        </span>
        <span className="dy-plan-acts">
          <button
            type="button"
            className="btn btn-main"
            disabled={step.saving}
            onClick={() => void plan.place(day, lesson)}
          >
            {step.saving ? "Ставлю…" : "Поставить"}
          </button>
          <button type="button" className="btn btn-text" onClick={() => plan.askHelper(lesson)}>
            Другое время
          </button>
          <button type="button" className="btn btn-text" onClick={plan.close}>
            Отмена
          </button>
        </span>
      </div>
    );
  }

  if (step.kind === "no-window") {
    return (
      <div className="dy-plan" role="status">
        <span>До сдачи свободного окна нет. Помощник может что-нибудь подвинуть.</span>
        <span className="dy-plan-acts">
          <button type="button" className="btn btn-line" onClick={() => plan.askHelper(lesson)}>
            Спросить помощника
          </button>
          <button type="button" className="btn btn-text" onClick={plan.close}>
            Отмена
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="dy-plan" role="status">
      <span>План сейчас не отвечает. Ничего не изменилось.</span>
      <span className="dy-plan-acts">
        <button type="button" className="btn btn-line" onClick={() => void plan.find(week, day, lesson)}>
          Ещё раз
        </button>
        <button type="button" className="btn btn-text" onClick={plan.close}>
          Отмена
        </button>
      </span>
    </div>
  );
}

function TaskRow({
  week,
  day,
  lesson,
  canPlan,
  api,
  plan,
  subjectNames,
}: {
  week: DiaryWeek;
  day: DiaryDay;
  lesson: DiaryLesson;
  canPlan: boolean;
  api: DiaryWeekApi;
  plan: DiaryPlanApi;
  subjectNames: Map<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const textButton = useRef<HTMLButtonElement>(null);

  const subject = lessonTitle(lesson);
  const text = taskText(lesson);
  const done = Boolean(lesson.homeworkDone);
  const isTest = isTestBlock(lesson.blockType);
  const linked = (lesson.linkedSubjectIds ?? [])
    .map((id) => subjectNames.get(id))
    .filter((name): name is string => Boolean(name));

  const stopEditing = (viaKeyboard: boolean) => {
    setEditing(false);
    // Вернуть фокус с клавиатуры. Если ушли мышью, его забирать нельзя.
    if (viaKeyboard) requestAnimationFrame(() => textButton.current?.focus());
  };

  const toggle = () => {
    if (!done) mascot.hop(0.5, "quiet");
    api.toggleDone(day, lesson);
  };

  const entry = plan.available && !done ? plan.entryFor(day, lesson) : null;
  const finding = plan.step?.kind === "finding" && plan.step.lessonId === lesson.id;

  return (
    <li className="td" data-attach={taskTitle(lesson)}>
      <button
        type="button"
        className="td-check"
        role="checkbox"
        aria-checked={done}
        aria-label={`Сделано: ${subject}`}
        onClick={toggle}
      >
        <Icon name="check" />
      </button>
      <span className="td-b">
        <span className={isTest ? "td-s test" : "td-s"}>{subject}</span>
        {editing ? (
          <TaskInput
            initial={text}
            label={`Что задано: ${subject}`}
            onCommit={(next, viaKeyboard) => {
              api.saveHomework(day, lesson, next);
              stopEditing(viaKeyboard);
            }}
            onCancel={() => stopEditing(true)}
          />
        ) : (
          <button
            ref={textButton}
            type="button"
            className={text || linked.length ? "td-h dy-text" : "td-h dy-text is-empty"}
            aria-label={`Изменить задание. ${taskTitle(lesson)}`}
            onClick={() => setEditing(true)}
          >
            {linked.length ? <span>{linked.join(", ")}</span> : null}
            {linked.length && text ? ", " : null}
            {text ? <TaskText text={text} /> : linked.length ? null : canPlan ? "Что повторить?" : "Тема не записана"}
          </button>
        )}
      </span>
      {entry?.start_at ? (
        <Link className="td-plan" href="/dashboard/plan">
          {plan.whenLabel(entry.start_at)}
        </Link>
      ) : canPlan && plan.available && !done ? (
        finding ? (
          <span className="td-plan" role="status">
            Ищу окно…
          </span>
        ) : (
          <button
            type="button"
            className="td-plan"
            aria-label={`В план: ${taskTitle(lesson)}`}
            onClick={() => void plan.find(week, day, lesson)}
          >
            В план
          </button>
        )
      ) : (
        <span />
      )}
      <PlanPreview day={day} lesson={lesson} plan={plan} week={week} />
    </li>
  );
}

/** «Добавить задание»: урок этого дня и текст. Форма остаётся, пока есть свободные уроки. */
function AddTask({
  day,
  api,
  empty,
}: {
  day: DiaryDay;
  api: DiaryWeekApi;
  empty: boolean;
}) {
  const free = freeClasses(day);
  const [open, setOpen] = useState(false);
  const [lessonId, setLessonId] = useState("");
  const [text, setText] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const selected = free.find((lesson) => lesson.id === lessonId) ?? free[0];
  const showForm = open && Boolean(selected);
  useSmoothInput(fieldRef, showForm);

  useEffect(() => {
    if (showForm) fieldRef.current?.focus();
  }, [showForm]);

  const close = () => {
    setOpen(false);
    setText("");
    requestAnimationFrame(() => openButton.current?.focus());
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || !selected) return;
    api.saveHomework(day, selected, value);
    setText("");
    setLessonId("");
  };

  if (!selected) {
    return empty ? <li className="dy-add dy-none">Ничего не задано</li> : null;
  }

  if (!showForm) {
    return (
      <li className="dy-add">
        <span className="dy-none">{empty ? "Ничего не задано" : ""}</span>
        <button ref={openButton} type="button" className="btn btn-text" onClick={() => setOpen(true)}>
          <Icon name="plus" />
          Добавить задание
        </button>
      </li>
    );
  }

  return (
    <li>
      <form
        className="dy-add-form"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <select
          className="dy-select"
          aria-label="Урок"
          value={selected?.id ?? ""}
          onChange={(event) => setLessonId(event.target.value)}
        >
          {free.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lessonTitle(lesson)}
            </option>
          ))}
        </select>
        <span className="ti-host dy-input">
          <input
            ref={fieldRef}
            value={text}
            aria-label="Что задано"
            placeholder="Что задано"
            onChange={(event) => setText(event.target.value)}
          />
        </span>
        <button type="submit" className="btn btn-main" disabled={!text.trim()}>
          Записать
        </button>
        <button type="button" className="btn btn-text" onClick={close}>
          Отмена
        </button>
      </form>
    </li>
  );
}

export function DayGroupCard({
  group,
  week,
  canPlan,
  api,
  plan,
  subjectNames,
}: {
  group: DayGroup;
  week: DiaryWeek;
  canPlan: boolean;
  api: DiaryWeekApi;
  plan: DiaryPlanApi;
  subjectNames: Map<string, string>;
}) {
  return (
    <section className="td-day">
      <h2 className="sec">
        {group.title}
        <span>{group.when}</span>
      </h2>
      <ul className="card">
        {group.tasks.map((lesson) => (
          <TaskRow
            key={lesson.id}
            week={week}
            day={group.day}
            lesson={lesson}
            canPlan={canPlan}
            api={api}
            plan={plan}
            subjectNames={subjectNames}
          />
        ))}
        <AddTask day={group.day} api={api} empty={group.tasks.length === 0} />
      </ul>
    </section>
  );
}
