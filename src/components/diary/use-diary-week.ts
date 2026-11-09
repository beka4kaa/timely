"use client";

// Неделя дневника и всё, что в ней можно поменять.
//
// Здесь собраны три свойства API, о которые легко споткнуться:
//
// 1. GET пишет. Первый запрос создаёт неделю, а неделю без единой записи пересобирает
//    из шаблона с НОВЫМИ id уроков. PATCH со старым id отвечает 200 и не меняет ничего,
//    поэтому каждый ответ сверяется, и при промахе урок ищется по месту в неделе.
// 2. Запись читает неделю и кладёт её целиком. Две записи одновременно затрут друг
//    друга, поэтому все они идут по очереди.
// 3. У отметки «сделано» нет своего поля в PATCH: такие записи идут целой неделей.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  applyLessonEdits,
  LessonChangedError,
  locateById,
  locateBySlot,
  mapLesson,
  type LessonEdit,
} from "@/components/diary/diary-edits";
import { gradeField, taskText, weekRangeLabel } from "@/lib/diary-tasks";
import {
  canRedo,
  canUndo,
  clearUndoHistory,
  performRedo,
  performUndo,
  pushGradeUndo,
  pushHomeworkUndo,
  pushTemplateUndo,
  subscribeHistory,
  type LessonPatchFn,
  type LessonSlot,
} from "@/lib/diary-undo";
import { lessonTitle } from "@/lib/now-feed";
import { dataChanged, useDataChanged } from "@/lib/data-changed";
import { invalidateResources } from "@/lib/resource-cache";
import type {
  DiaryDay,
  DiaryLesson,
  DiaryWeek,
  Grade,
  YoutubeLink,
} from "@/types/diary";

// ───────────────────────────── Запросы ───────────────────────────────────────

async function json<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) throw new Error(`${message} (${response.status})`);
  return response.json() as Promise<T>;
}

async function readWeek(weekStart: string): Promise<DiaryWeek> {
  const response = await fetch(`/api/diary/week?weekStart=${encodeURIComponent(weekStart)}`);
  return json<DiaryWeek>(response, "Дневник не загрузился");
}

async function putWeek(week: DiaryWeek): Promise<DiaryWeek> {
  const response = await fetch("/api/diary/week", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(week),
  });
  return json<DiaryWeek>(response, "Неделя не сохранилась");
}

async function patchWeek(body: Record<string, unknown>): Promise<DiaryWeek> {
  const response = await fetch("/api/diary/grade", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return json<DiaryWeek>(response, "Запись не сохранилась");
}

async function patchLinks(weekId: string, dayId: string, links: YoutubeLink[]): Promise<void> {
  const response = await fetch("/api/diary/day-links", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weekId, dayId, links }),
  });
  if (!response.ok) throw new Error(`Ссылки не сохранились (${response.status})`);
}

// ───────────────────────────── Поиск урока ───────────────────────────────────

interface LessonTarget {
  weekId: string;
  dayId: string;
  lessonId: string;
  slot: LessonSlot;
}

/** PATCH с проверкой, что запись попала в урок (см. п. 1 в начале файла). */
async function patchLesson(
  target: LessonTarget,
  change: Record<string, unknown>,
): Promise<DiaryWeek> {
  const answer = await patchWeek({
    weekId: target.weekId,
    dayId: target.dayId,
    lessonId: target.lessonId,
    ...change,
  });
  if (locateById(answer, target.dayId, target.lessonId)) return answer;

  const fresh = await readWeek(answer.weekStart);
  const found = locateBySlot(fresh, target.slot);
  if (!found) throw new LessonChangedError("Этого урока на неделе больше нет");
  return patchWeek({
    weekId: fresh.id,
    dayId: found.day.id,
    lessonId: found.lesson.id,
    ...change,
  });
}

/** Запись целой неделей: то, чего нет в PATCH. Основа берётся свежая, а не с экрана. */
async function rewriteLesson(
  weekStart: string,
  target: Pick<LessonTarget, "dayId" | "lessonId" | "slot">,
  patch: Partial<DiaryLesson>,
): Promise<DiaryWeek> {
  const fresh = await readWeek(weekStart);
  const found =
    locateById(fresh, target.dayId, target.lessonId) ?? locateBySlot(fresh, target.slot);
  if (!found) throw new LessonChangedError("Этого урока на неделе больше нет");
  return putWeek(
    mapLesson(fresh, found.day.id, found.lesson.id, (lesson) => ({ ...lesson, ...patch })),
  );
}

/** Отметка задания не со страницы дневника: из ответа тьютора. */
export async function markHomeworkDone(
  weekStart: string,
  place: { day_id: string; lesson_id: string; slot: LessonSlot },
  done: boolean,
): Promise<void> {
  await rewriteLesson(
    weekStart,
    { dayId: place.day_id, lessonId: place.lesson_id, slot: place.slot },
    { homeworkDone: done },
  );
  invalidateResources("now:diary:");
  dataChanged("diary");
}

/** Правки из карточки тьютора. Вся неделя одной записью: на полпути она не останется. */
export async function editLessons(weekStart: string, edits: LessonEdit[]): Promise<void> {
  await putWeek(applyLessonEdits(await readWeek(weekStart), edits));
  invalidateResources("now:diary:");
  dataChanged("diary");
}

function targetOf(week: DiaryWeek, day: DiaryDay, lesson: DiaryLesson): LessonTarget {
  return {
    weekId: week.id,
    dayId: day.id,
    lessonId: lesson.id,
    slot: {
      dayOfWeek: day.dayOfWeek,
      lessonNumber: lesson.lessonNumber,
      startTime: lesson.startTime,
    },
  };
}

function sameLinks(left: YoutubeLink[], right: YoutubeLink[]): boolean {
  return (
    left.length === right.length &&
    left.every((link, index) => link.url === right[index].url)
  );
}

// ─────────────────────────────── Хук ─────────────────────────────────────────

export type WeekStatus = "loading" | "ready" | "error";

const noUndo = () => false;

export function useDiaryWeek(weekStart: string | null) {
  const [week, setWeekState] = useState<DiaryWeek | null>(null);
  const [status, setStatus] = useState<WeekStatus>("loading");
  const [applying, setApplying] = useState(false);
  const hasUndo = useSyncExternalStore(subscribeHistory, canUndo, noUndo);

  const weekRef = useRef<DiaryWeek | null>(null);
  const weekStartRef = useRef(weekStart);
  weekStartRef.current = weekStart;

  const setWeek = useCallback((next: DiaryWeek | null) => {
    weekRef.current = next;
    setWeekState(next);
  }, []);

  // Загрузка: ответ для уже сменившейся недели не должен затереть новую.
  const ticket = useRef(0);
  const load = useCallback(
    async (target: string, quiet = false) => {
      const id = ++ticket.current;
      if (!quiet) {
        setWeek(null);
        setStatus("loading");
      }
      try {
        const next = await readWeek(target);
        if (id !== ticket.current) return;
        setWeek(next);
        setStatus("ready");
      } catch {
        if (id !== ticket.current || quiet) return;
        setStatus("error");
      }
    },
    [setWeek],
  );

  useEffect(() => {
    if (weekStart) void load(weekStart);
  }, [load, weekStart]);

  useDataChanged("diary", () => {
    if (weekStartRef.current) void load(weekStartRef.current, true);
  });

  // Очередь записей (см. п. 2 в начале файла).
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const inQueue = useRef(0);
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    inQueue.current += 1;
    const run = tail.current.then(task);
    tail.current = run
      .catch(() => undefined)
      .then(() => {
        inQueue.current -= 1;
      });
    return run;
  }, []);

  /** Ответ сервера. Если за ним стоит ещё запись, её ответ будет полнее этого. */
  const publish = useCallback(
    (next: DiaryWeek) => {
      // Главная держит неделю в кэше: иначе там ещё две минуты видно старое.
      invalidateResources("now:diary:");
      if (next.weekStart !== weekStartRef.current) return;
      if (inQueue.current > 1) return;
      setWeek(next);
    },
    [setWeek],
  );

  const failed = useCallback(
    (message: string) => {
      toast.error(message);
      const target = weekStartRef.current;
      if (target) void enqueue(() => load(target, true));
    },
    [enqueue, load],
  );

  const applyLessonValue = useCallback<LessonPatchFn>(
    async (action, value) => {
      const change =
        action.type === "grade"
          ? { type: action.gradeField, value }
          : { field: "homework", value };
      publish(await patchLesson(action, change));
    },
    [publish],
  );

  const restoreSnapshot = useCallback(
    async (_weekId: string, snapshot: DiaryWeek) => {
      publish(await putWeek(snapshot));
    },
    [publish],
  );

  const undo = useCallback(() => {
    if (!canUndo()) return;
    void enqueue(() => performUndo(applyLessonValue, restoreSnapshot))
      .then((label) => {
        if (label) toast("Отменено", { description: label });
      })
      .catch(() => failed("Не получилось отменить. Попробуй ещё раз."));
  }, [applyLessonValue, enqueue, failed, restoreSnapshot]);

  const redo = useCallback(() => {
    if (!canRedo()) return;
    void enqueue(() => performRedo(applyLessonValue))
      .then((label) => {
        if (label) toast("Возвращено", { description: label });
      })
      .catch(() => failed("Не получилось вернуть. Попробуй ещё раз."));
  }, [applyLessonValue, enqueue, failed]);

  const setGrade = useCallback(
    (day: DiaryDay, lesson: DiaryLesson, value: Grade) => {
      const current = weekRef.current;
      const field = gradeField(lesson);
      if (!current || !field) return;
      const before = lesson.grades[field];
      if (before === value) return;

      const target = targetOf(current, day, lesson);
      setWeek(
        mapLesson(current, day.id, lesson.id, (item) => ({
          ...item,
          grades: { ...item.grades, [field]: value },
        })),
      );
      void enqueue(async () => {
        publish(await patchLesson(target, { type: field, value }));
        pushGradeUndo({
          ...target,
          gradeField: field,
          before,
          after: value,
          label: `${lessonTitle(lesson)}: оценка ${value ?? "убрана"}`,
        });
      }).catch(() => failed("Оценка не сохранилась. Попробуй ещё раз."));
    },
    [enqueue, failed, publish, setWeek],
  );

  const saveHomework = useCallback(
    (day: DiaryDay, lesson: DiaryLesson, text: string) => {
      const current = weekRef.current;
      if (!current) return;
      const before = taskText(lesson);
      const after = text.trim();
      if (before === after) return;

      // Новый текст в строке, где от прежнего осталась отметка, не должен родиться сделанным.
      const resetDone = Boolean(lesson.homeworkDone) && (!after || !before);
      const target = targetOf(current, day, lesson);
      setWeek(
        mapLesson(current, day.id, lesson.id, (item) => ({
          ...item,
          homework: after,
          ...(resetDone ? { homeworkDone: false } : {}),
        })),
      );
      void enqueue(async () => {
        publish(
          resetDone
            ? await rewriteLesson(current.weekStart, target, { homework: after, homeworkDone: false })
            : await patchLesson(target, { field: "homework", value: after }),
        );
        pushHomeworkUndo({
          ...target,
          before,
          after,
          label: after ? `${lessonTitle(lesson)}: ${after}` : `${lessonTitle(lesson)}: задание удалено`,
        });
        if (!after) {
          toast("Задание удалено", {
            description: `${lessonTitle(lesson)}: ${before}`,
            action: { label: "Отменить", onClick: undo },
          });
        }
      }).catch(() => failed("Задание не сохранилось. Попробуй ещё раз."));
    },
    [enqueue, failed, publish, setWeek, undo],
  );

  const toggleDone = useCallback(
    (day: DiaryDay, lesson: DiaryLesson) => {
      const current = weekRef.current;
      if (!current) return;
      const done = !lesson.homeworkDone;
      const target = targetOf(current, day, lesson);
      setWeek(
        mapLesson(current, day.id, lesson.id, (item) => ({ ...item, homeworkDone: done })),
      );
      void enqueue(async () => {
        publish(await rewriteLesson(current.weekStart, target, { homeworkDone: done }));
      }).catch(() => failed("Отметка не сохранилась. Попробуй ещё раз."));
    },
    [enqueue, failed, publish, setWeek],
  );

  const saveNotes = useCallback(
    (day: DiaryDay, lesson: DiaryLesson, notes: string) => {
      const current = weekRef.current;
      if (!current || notes === lesson.notes) return;
      const target = targetOf(current, day, lesson);
      setWeek(mapLesson(current, day.id, lesson.id, (item) => ({ ...item, notes })));
      void enqueue(async () => {
        publish(await patchLesson(target, { field: "notes", value: notes }));
      }).catch(() => failed("Заметка не сохранилась. Попробуй ещё раз."));
    },
    [enqueue, failed, publish, setWeek],
  );

  const saveLinkedSubjects = useCallback(
    (day: DiaryDay, lesson: DiaryLesson, linkedSubjectIds: string[]) => {
      const current = weekRef.current;
      if (!current) return;
      const target = targetOf(current, day, lesson);
      setWeek(
        mapLesson(current, day.id, lesson.id, (item) => ({ ...item, linkedSubjectIds })),
      );
      void enqueue(async () => {
        publish(await patchLesson(target, { linkedSubjectIds }));
      }).catch(() => failed("Предметы не сохранились. Попробуй ещё раз."));
    },
    [enqueue, failed, publish, setWeek],
  );

  /** Ссылки на видео. Ответ этого PATCH недели не содержит, поэтому сверяем чтением. */
  const saveLinks = useCallback(
    (day: DiaryDay, links: YoutubeLink[]) => {
      const current = weekRef.current;
      if (!current) return;
      const { dayOfWeek } = day;
      setWeek({
        ...current,
        days: current.days.map((item) =>
          item.id === day.id ? { ...item, youtubeLinks: links } : item,
        ),
      });
      void enqueue(async () => {
        await patchLinks(current.id, day.id, links);
        let fresh = await readWeek(current.weekStart);
        const freshDay = fresh.days.find((item) => item.dayOfWeek === dayOfWeek);
        if (freshDay && !sameLinks(freshDay.youtubeLinks ?? [], links)) {
          await patchLinks(fresh.id, freshDay.id, links);
          fresh = await readWeek(current.weekStart);
        }
        publish(fresh);
      }).catch(() => failed("Ссылка не сохранилась. Попробуй ещё раз."));
    },
    [enqueue, failed, publish, setWeek],
  );

  /** Применить шаблон к открытой неделе. Прежняя неделя остаётся в истории целиком. */
  const applyTemplate = useCallback(async () => {
    const target = weekStartRef.current;
    if (!target) return;
    setApplying(true);
    try {
      await enqueue(async () => {
        // Свежая копия, а не та, что на экране: оценка могла ещё лететь.
        const snapshot = await readWeek(target).catch(() => null);
        const response = await fetch("/api/diary/week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart: target }),
        });
        const next = await json<DiaryWeek>(response, "Шаблон не применился");
        clearUndoHistory();
        if (snapshot) {
          pushTemplateUndo({
            weekId: snapshot.id,
            weekSnapshot: snapshot,
            label: `Шаблон на неделю ${weekRangeLabel(target)}`,
          });
        }
        publish(next);
      });
      toast("Шаблон применён", {
        description: "Оценки и задания этой недели сброшены.",
        action: { label: "Отменить", onClick: undo },
      });
    } catch {
      toast.error("Не удалось применить шаблон");
    } finally {
      setApplying(false);
    }
  }, [enqueue, publish, undo]);

  const reload = useCallback(() => {
    if (weekStartRef.current) void load(weekStartRef.current);
  }, [load]);

  return {
    week,
    status,
    applying,
    hasUndo,
    reload,
    undo,
    redo,
    setGrade,
    saveHomework,
    toggleDone,
    saveNotes,
    saveLinkedSubjects,
    saveLinks,
    applyTemplate,
  };
}

export type DiaryWeekApi = ReturnType<typeof useDiaryWeek>;
