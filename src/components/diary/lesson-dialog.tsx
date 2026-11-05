"use client";

// Подробнее об уроке: задание, заметка, оценка, а у тестов ещё и предметы, к которым они
// относятся (без этого их оценки не попадают в итоговые).

import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { gradeField, taskText } from "@/lib/diary-tasks";
import { dayMonthLabel, lessonGrade, lessonTitle, weekdayLabel } from "@/lib/now-feed";
import { useResource } from "@/lib/resource-cache";
import {
  isFeynmanBlock,
  isTestBlock,
  type DiaryDay,
  type DiaryLesson,
} from "@/types/diary";
import { GradeChoice } from "./school-card";
import type { DiaryWeekApi } from "./use-diary-week";

interface SubjectOption {
  id: string;
  name: string;
}

async function fetchSubjects(): Promise<SubjectOption[]> {
  const response = await fetch("/api/subjects");
  if (!response.ok) throw new Error("Предметы не загрузились");
  const body = await response.json();
  const list: Array<{ id: string | number; name: string }> = Array.isArray(body)
    ? body
    : body.results ?? body.subjects ?? [];
  return list.map((subject) => ({ id: String(subject.id), name: subject.name }));
}

/** Предметы ученика, чтобы показать тест под настоящими названиями. */
export function useSubjects(enabled: boolean): SubjectOption[] {
  const { data } = useResource(enabled ? "diary:subjects" : null, fetchSubjects, { ttl: 5 * 60_000 });
  return data ?? [];
}

export function LessonDialog({
  target,
  api,
  onClose,
}: {
  target: { day: DiaryDay; lesson: DiaryLesson } | null;
  api: DiaryWeekApi;
  onClose: () => void;
}) {
  // Показываем свежий урок из недели: оценка могла поменяться, пока окно открыто.
  const day = target ? api.week?.days.find((item) => item.id === target.day.id) ?? target.day : null;
  const lesson = target && day
    ? day.lessons.find((item) => item.id === target.lesson.id) ?? target.lesson
    : null;

  const [homework, setHomework] = useState("");
  const [notes, setNotes] = useState("");
  const lessonId = lesson?.id;
  useEffect(() => {
    setHomework(lesson ? taskText(lesson) : "");
    setNotes(lesson?.notes ?? "");
    // Только при открытии другого урока: иначе ответ сервера стёр бы то, что сейчас печатают.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const needsSubjects = Boolean(lesson && (isTestBlock(lesson.blockType) || isFeynmanBlock(lesson.blockType)));
  const subjects = useSubjects(needsSubjects);

  if (!day || !lesson) return null;

  const close = () => {
    api.saveHomework(day, lesson, homework);
    api.saveNotes(day, lesson, notes);
    onClose();
  };

  const linked = lesson.linkedSubjectIds ?? [];
  const name = lessonTitle(lesson);

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent className="dy-dialog">
        <DialogTitle className="dy-dialog-title">{name}</DialogTitle>
        <DialogDescription className="dy-dialog-sub">
          {weekdayLabel(day.date)}, {dayMonthLabel(day.date)}
          {lesson.startTime ? `, ${lesson.startTime}–${lesson.endTime}` : ""}
        </DialogDescription>

        {gradeField(lesson) ? (
          <div className="dy-field">
            <span>Оценка</span>
            <GradeChoice
              value={lessonGrade(lesson)}
              label={name}
              onPick={(grade) => api.setGrade(day, lesson, grade)}
            />
          </div>
        ) : null}

        <label className="field">
          Что задано
          <textarea
            rows={2}
            value={homework}
            onChange={(event) => setHomework(event.target.value)}
            onBlur={() => api.saveHomework(day, lesson, homework)}
          />
        </label>

        <label className="field">
          Заметка
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => api.saveNotes(day, lesson, notes)}
          />
        </label>

        {needsSubjects && subjects.length ? (
          <div className="dy-field">
            <span>К каким предметам относится</span>
            <div className="dy-chips">
              {subjects.map((subject) => {
                const selected = linked.includes(subject.id);
                return (
                  <button
                    key={subject.id}
                    type="button"
                    className="btn btn-line"
                    aria-pressed={selected}
                    onClick={() =>
                      api.saveLinkedSubjects(
                        day,
                        lesson,
                        selected
                          ? linked.filter((id) => id !== subject.id)
                          : [...linked, subject.id],
                      )
                    }
                  >
                    {subject.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
