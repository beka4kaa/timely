"use client";

// Боковая карточка: уроки одного дня по порядку и оценки от руки.

import { useState } from "react";

import { Icon } from "@/components/shell/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { classesOfDay, gradeField } from "@/lib/diary-tasks";
import { lessonGrade, lessonTitle } from "@/lib/now-feed";
import type { DiaryDay, DiaryLesson, Grade } from "@/types/diary";
import type { DiaryWeekApi } from "./use-diary-week";

const GRADES: Exclude<Grade, null | 1>[] = [2, 3, 4, 5];

/** Маленький выбор оценки. Единица в старых записях показывается, но новой не ставится. */
export function GradeChoice({
  value,
  label,
  onPick,
}: {
  value: number | null;
  label: string;
  onPick: (grade: Grade) => void;
}) {
  return (
    <div className="dy-grades-row" role="group" aria-label={`Оценка: ${label}`}>
      {GRADES.map((grade) => (
        <button
          key={grade}
          type="button"
          className={`dy-g g${grade}`}
          aria-pressed={value === grade}
          aria-label={`Оценка ${grade}`}
          onClick={() => onPick(grade)}
        >
          {grade}
        </button>
      ))}
      {value !== null ? (
        <button
          type="button"
          className="dy-g dy-g-clear"
          aria-label="Убрать оценку"
          onClick={() => onPick(null)}
        >
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}

function GradeControl({
  lesson,
  onPick,
}: {
  lesson: DiaryLesson;
  onPick: (grade: Grade) => void;
}) {
  const [open, setOpen] = useState(false);
  const title = lessonTitle(lesson);
  const value = lessonGrade(lesson);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={value !== null ? `dy-grade g g${value}` : "dy-grade g is-empty"}
          aria-label={value !== null ? `${title}: оценка ${value}. Изменить` : `${title}: поставить оценку`}
        >
          {value ?? "–"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="left"
        sideOffset={8}
        collisionPadding={8}
        className="dy-grades w-auto rounded-xl border-0 p-1"
      >
        <GradeChoice
          value={value}
          label={title}
          onPick={(grade) => {
            onPick(grade);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function SchoolCard({
  title,
  day,
  today,
  quiet = false,
  past = false,
  api,
  onOpenLesson,
}: {
  title: string;
  day: DiaryDay | undefined;
  today: string;
  quiet?: boolean;
  /** Первой прячется на узком экране, пока не развернули всю неделю. */
  past?: boolean;
  api: DiaryWeekApi;
  onOpenLesson: (day: DiaryDay, lesson: DiaryLesson) => void;
}) {
  const lessons = day ? classesOfDay(day) : [];
  const className = ["tcard", "card", quiet ? "quiet" : "", past ? "tcard-past" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={className}>
      <h2>{title}</h2>
      {lessons.length && day ? (
        <ol>
          {lessons.map((lesson, index) => {
            const name = lessonTitle(lesson);
            return (
              <li key={lesson.id} data-attach={`${name}, урок ${index + 1}, ${title.toLowerCase()}`}>
                <span className="n">{index + 1}</span>
                <button
                  type="button"
                  className="dy-lesson"
                  aria-label={`${name}: подробнее об уроке`}
                  onClick={() => onOpenLesson(day, lesson)}
                >
                  {name}
                </button>
                {/* За урок, которого ещё не было, оценку не ставят. */}
                {gradeField(lesson) && day.date <= today ? (
                  <GradeControl lesson={lesson} onPick={(grade) => api.setGrade(day, lesson, grade)} />
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="small-note">Уроков нет.</p>
      )}
    </section>
  );
}
