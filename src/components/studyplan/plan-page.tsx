// «План» — один календарь времени ученика, а не календарь отдельного курса.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import { usePageSchedule } from "@/contexts/active-schedule";
import {
  paperButton,
  paperCaption,
  paperCard,
  paperPrimaryButton,
  paperTile,
} from "@/components/curriculum/paper";
import {
  buildCourseAccents,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import { weekLoad } from "@/lib/studyplan-load";
import {
  createCommitment,
  type FixedCommitment,
  type StudySchedule,
} from "@/lib/studyplan-api";
import { layoutWeek, visibleRange, zonedDateKey } from "@/lib/studyplan-calendar";
import {
  durationLabel,
  weekLabel,
  weekdayOnLabel,
} from "@/lib/studyplan-visuals";

import { BlockDetails } from "./block-details";
import { DayView } from "./day-view";
import { type CalendarEntry, useSchedule } from "./use-schedule";
import { WeekGrid } from "./week-grid";

type Mode = "week" | "day";

const EMPTY_ENTRIES: CalendarEntry[] = [];

/**
 * Один шаг истории удаления.
 *
 * Занятия и занятое время удаляются разными способами: занятие получает статус
 * «отменено» и живо на сервере, а занятость удаляется совсем — вернуть её можно
 * только пересозданием. Поэтому шаг хранит и идентификаторы занятий, и полные
 * записи занятости.
 */
interface DeleteStep {
  blockIds: string[];
  commitments: FixedCommitment[];
}
const RELEASED_STATUSES = new Set(["cancelled", "rescheduled"]);

/** «1 занятие», «2 занятия», «5 занятий». */
function blockWord(count: number): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return "занятий";
  const units = count % 10;
  if (units === 1) return "занятие";
  if (units >= 2 && units <= 4) return "занятия";
  return "занятий";
}

export function StudyPlanPage() {
  const schedule = useSchedule();
  const [mode, setMode] = useState<Mode>("week");
  // Выделение — список, а не одно занятие: рамкой можно захватить несколько и
  // отменить их одним Delete. Карточка разбора показывается, когда выбрано
  // ровно одно: у пачки нет «того самого» занятия, которое стоит разбирать.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dayKey, setDayKey] = useState<string | null>(null);

  const entries = useMemo(() => {
    if (schedule.data.state !== "ready") return EMPTY_ENTRIES;
    return [...schedule.data.blocks, ...schedule.data.commitments];
  }, [schedule.data]);
  const range = useMemo(
    () => visibleRange(entries, schedule.timeZone),
    [entries, schedule.timeZone],
  );
  const columns = useMemo(
    () =>
      layoutWeek(entries, {
        timeZone: schedule.timeZone,
        days: schedule.days,
        range,
      }),
    [entries, schedule.timeZone, schedule.days, range],
  );

  const todayKey = zonedDateKey(new Date(), schedule.timeZone);
  const activeDay =
    dayKey && schedule.days.includes(dayKey)
      ? dayKey
      : schedule.days.includes(todayKey)
        ? todayKey
        : schedule.days[0];
  const selected =
    selectedIds.length === 1
      ? entries.find((entry) => entry.id === selectedIds[0]) ?? null
      : null;

  const toggleSelected = useCallback((entryId: string, additive: boolean) => {
    setSelectedIds((current) => {
      if (!additive) return [entryId];
      return current.includes(entryId)
        ? current.filter((item) => item !== entryId)
        : [...current, entryId];
    });
  }, []);

  /**
   * Что удалили последним Delete.
   *
   * Занятия и занятое время удаляются РАЗНЫМИ способами: занятие получает
   * статус «отменено» и живо на сервере, а занятость удаляется совсем и
   * восстанавливается пересозданием. Поэтому шаг истории держит и то и другое,
   * а не список идентификаторов.
   */
  const [undoStack, setUndoStack] = useState<DeleteStep[]>([]);
  const [redoStack, setRedoStack] = useState<DeleteStep[]>([]);

  /** Сколько всего удалено последним Delete — для строки состояния. */
  const lastStep = undoStack[undoStack.length - 1];
  const deletedCount = lastStep
    ? lastStep.blockIds.length + lastStep.commitments.length
    : 0;

  /** Выполнить удаление и вернуть шаг истории, если что-то действительно ушло. */
  const applyDelete = useCallback(
    async (step: DeleteStep): Promise<DeleteStep | null> => {
      const cancelled = step.blockIds.length
        ? await schedule.cancel(step.blockIds)
        : [];
      for (const item of step.commitments) {
        await schedule.removeCommitment(item.id);
      }
      if (cancelled.length === 0 && step.commitments.length === 0) return null;
      return { blockIds: cancelled, commitments: step.commitments };
    },
    [schedule],
  );

  /**
   * Delete удаляет выделенное.
   *
   * Раньше занятое время отсеивалось здесь же — «школу и репетитора календарь
   * не отменяет», — и на экране из одних только таких блоков клавиша молча не
   * делала ничего. Теперь удаляется и оно: занятость это отдельная запись, и
   * убрать её ученик вправе.
   */
  const deleteSelected = useCallback(async () => {
    const chosen = entries.filter((entry) => selectedIds.includes(entry.id));
    const blockIds = chosen
      .filter((entry) => !isCommitmentEntry(entry))
      .map((entry) => entry.id);

    // Повторяющаяся занятость развёрнута в пять блоков одной записи — по
    // идентификатору записи их и схлопываем, иначе одно удаление ушло бы
    // на сервер пятью запросами.
    const commitmentIds = new Set(
      chosen.filter(isCommitmentEntry).map((entry) => entry.commitment_id),
    );
    const commitments = (
      schedule.data.state === "ready" ? schedule.data.commitmentSources : []
    ).filter((item) => commitmentIds.has(item.id));

    if (blockIds.length === 0 && commitments.length === 0) return;

    const done = await applyDelete({ blockIds, commitments });
    if (!done) return;
    setUndoStack((current) => [...current, done]);
    // Новое действие обрывает ветку повтора — как в любом редакторе.
    setRedoStack([]);
    setSelectedIds([]);
  }, [applyDelete, entries, schedule.data, selectedIds]);

  /**
   * Ctrl+Z — вернуть удалённое.
   *
   * Занятие восстанавливается статусом, занятость — пересозданием, поэтому у
   * неё меняется идентификатор. Шаг истории обновляется новыми: без этого
   * повтор через Ctrl+Shift+Z бил бы по строке, которой уже нет.
   */
  const undo = useCallback(async () => {
    const step = undoStack[undoStack.length - 1];
    if (!step) {
      // Удалять нечего — откатываем последний перенос. Ученику не нужно
      // помнить, что именно он сделал последним.
      if (schedule.lastRevision) {
        await schedule.undoLast();
        return true;
      }
      return false;
    }

    setUndoStack((current) => current.slice(0, -1));
    if (step.blockIds.length) await schedule.restore(step.blockIds);

    const restored: FixedCommitment[] = [];
    for (const item of step.commitments) {
      const created = await schedule.recreateCommitment(item);
      if (created) restored.push(created);
    }

    setRedoStack((current) => [
      ...current,
      { blockIds: step.blockIds, commitments: restored },
    ]);
    return true;
  }, [schedule, undoStack]);

  /** Ctrl+Shift+Z — удалить снова то, что только что вернули. */
  const redo = useCallback(async () => {
    const step = redoStack[redoStack.length - 1];
    if (!step) return false;
    setRedoStack((current) => current.slice(0, -1));
    const done = await applyDelete(step);
    if (done) setUndoStack((current) => [...current, done]);
    return true;
  }, [applyDelete, redoStack]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Пока курсор в поле ввода, эти клавиши принадлежат тексту, а не
      // календарю: Delete стирает символ, Ctrl+Z откатывает набор.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // Ctrl+Shift+Z и Ctrl+Y — два общепринятых написания одного действия.
      if (modifier && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        void redo();
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        void undo();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedIds.length === 0) return;
      event.preventDefault();
      void deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, redo, selectedIds.length, undo]);

  // Считаем УЧЕБНОЕ время, без школы и репетитора: столько же показывает лента
  // в шапке сетки, и это единственное время, которое ученик здесь двигает.
  // Занятое время видно в самом календаре.
  const load = useMemo(
    () =>
      weekLoad(
        columns.map((column) => column.dateKey),
        columns.flatMap((column) =>
          column.blocks.flatMap((item) => {
            const entry = item.block;
            if (isCommitmentEntry(entry)) return [];
            return [
              {
                dateKey: column.dateKey,
                minutes: entry.duration_minutes,
                // Здесь цвет не нужен — важны только суммы и пик, — поэтому
                // группируем прямо по программе.
                accent: entry.course_plan,
                released: RELEASED_STATUSES.has(entry.status),
              },
            ];
          }),
        ),
      ),
    [columns],
  );
  const weekMinutes = load.totalMinutes;

  // «Плотнее всего в среду» имеет смысл, только когда занятых дней больше
  // одного: у единственного дня недели пик — он сам, и подпись превращается
  // в тавтологию.
  const busyDays = load.days.filter((day) => day.totalMinutes > 0).length;
  const peakColumn =
    busyDays > 1
      ? columns.find((column) => column.dateKey === load.peakDateKey) ?? null
      : null;

  // Какое расписание правит помощник в панели справа.
  //
  // Считается ДО ранних возвратов ниже: `usePageSchedule` — хук, и после
  // `return` его вызвать нельзя. Пока данные грузятся, расписания нет, и панель
  // честно говорит, что выбрать нечего.
  const ready = schedule.data.state === "ready" ? schedule.data : null;
  const selectedLearning =
    selected && !isCommitmentEntry(selected) ? selected : null;
  const assistantSchedule = ready
    ? selectedLearning
      ? ready.schedules.find((item) => item.id === selectedLearning.schedule) ??
        null
      : ready.schedules.length === 1
        ? ready.schedules[0]
        : null
    : null;
  // `""` — расписаний нет вовсе, бэкенд возьмёт последнее неархивное сам.
  // `null` — программ несколько, а занятие не выбрано: чью двигать, неясно.
  const assistantScheduleId = !ready
    ? null
    : ready.schedules.length === 0
      ? ""
      : assistantSchedule?.id ?? null;

  usePageSchedule({
    scheduleId: assistantScheduleId,
    timeZone: assistantSchedule?.timezone ?? schedule.timeZone,
    onApplied: () => void schedule.reload(),
    onCommitments: async (items) => {
      for (const item of items) {
        await createCommitment(
          {
            title: item.title,
            kind: item.kind,
            weekday: item.weekday,
            start_time: item.start_time,
            duration_minutes: item.duration_minutes,
            valid_from: item.valid_from ?? null,
            valid_until: item.valid_until ?? null,
            start_at: item.start_at,
            end_at: item.end_at,
          },
          "chat",
        );
      }
      await schedule.reload();
    },
  });

  if (schedule.data.state === "loading") {
    return (
      <CoffeePageShell>
        <div className={`${paperCard} h-[60vh] animate-pulse`} />
      </CoffeePageShell>
    );
  }

  if (schedule.data.state === "error") {
    return (
      <CoffeePageShell>
        <div className={`${paperCard} p-6`}>
          <p className="text-[14px] text-[#4a443d]">{schedule.data.message}</p>
          <button
            type="button"
            className={`${paperButton} mt-4`}
            onClick={() => void schedule.reload()}
          >
            Попробовать снова
          </button>
        </div>
      </CoffeePageShell>
    );
  }

  const data = schedule.data;
  // Цвета программ раздаются по порядку списка, а не по хешу: иначе два курса
  // могли достаться одному цвету, и правило «цвет = предмет» ломалось бы ровно
  // там, где оно нужнее всего.
  const accents = buildCourseAccents(data.plans);

  return (
    <CoffeePageShell fillHeight maxWidthClassName="max-w-none">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Одна строка вместо четырёх. Раньше над календарём стояли надстрочник,
            заголовок, сводка и отдельная полоса программ — пять блоков, из-за
            которых неделя начиналась только на трети экрана. Всё, что осталось,
            стоит в один ряд: дата, сводка, легенда, навигация. */}
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[18px] tracking-[-0.02em] text-[#312c27]">
              {weekLabel(schedule.days)}
            </h1>
            <p className="text-[12px] text-[#8d857b]">
              {weekMinutes > 0 ? (
                <>
                  {durationLabel(weekMinutes)} учёбы
                  {peakColumn ? (
                    <>
                      {" · плотнее "}
                      {weekdayOnLabel(peakColumn.weekday)}
                    </>
                  ) : null}
                </>
              ) : (
                "свободна"
              )}
            </p>
            {/* Легенды с названиями программ здесь больше нет. Названия у книг
                длинные («_OceanofPDF.com_Hands-On_Machine_Learning_with…»), и
                любая их подпись наверху съедала строку ради того, что и так
                написано на каждом блоке третьей строкой. Цвет объясняет сам
                блок. */}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Предыдущая неделя"
              className={paperButton}
              onClick={() => {
                setDayKey(null);
                schedule.goToWeek(-1);
              }}
            >
              ←
            </button>
            <button
              type="button"
              className={paperButton}
              onClick={() => {
                setDayKey(null);
                schedule.goToWeek(0);
              }}
            >
              Сегодня
            </button>
            <button
              type="button"
              aria-label="Следующая неделя"
              className={paperButton}
              onClick={() => {
                setDayKey(null);
                schedule.goToWeek(1);
              }}
            >
              →
            </button>
            <div className="ml-1 inline-flex overflow-hidden rounded-full border border-[#d8d1c7]">
              {(["week", "day"] as Mode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`px-3 py-1.5 text-[12.5px] transition-colors ${
                    mode === value
                      ? "bg-[#8a5b24] text-[#fdf8ef]"
                      : "bg-[#fffdfa] text-[#5f584f] hover:bg-[#fff8ec]"
                  }`}
                >
                  {value === "week" ? "Неделя" : "День"}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Одна полоска на всё. Раньше здесь стопкой стояли карточка «не
            помещается» с полным именем книги, сообщение об устаревшей версии и
            строка отмены — три блока, съедавшие треть экрана над календарём.
            Имена программ убраны совсем: они длинные, и на каждом блоке и так
            написано, к какому курсу он относится. */}
        <CalendarNotice
          proposals={data.proposals}
          notice={schedule.notice}
          cancelledCount={deletedCount}
          hasUndo={Boolean(schedule.lastRevision)}
          busy={schedule.busy}
          onConfirm={(id) => void schedule.confirm(id)}
          onDismiss={schedule.dismissNotice}
          onUndo={() => void schedule.undoLast()}
          onRestore={() => void undo()}
        />

        {/* Календарь занимает всё оставшееся место, как в любом календарном
            приложении. Раньше рядом стояла колонка в 320 px, которая почти
            всегда пустовала, — из-за неё неделя жалась, а под сеткой оставалась
            полоса мёртвого пространства. Программы уехали строкой наверх,
            карточка занятия всплывает поверх сетки и только когда нужна. */}
        <div className="relative min-h-0 flex-1">
          <div
            className={`h-full ${mode === "week" ? "hidden lg:block" : "hidden"}`}
          >
            <WeekGrid
                columns={columns}
                range={range}
                timeZone={schedule.timeZone}
                todayKey={todayKey}
                selectedIds={selectedIds}
                busy={schedule.busy}
                accents={accents}
                onSelect={(entry, additive) => toggleSelected(entry.id, additive)}
                onSelectMany={setSelectedIds}
                renderDetails={(entry) => (
                  <BlockDetails
                    block={entry}
                    timeZone={schedule.timeZone}
                    busy={schedule.busy}
                    onClose={() => setSelectedIds([])}
                    onTogglePinned={(pinned) =>
                      void schedule.setPinned([entry.id], pinned)
                    }
                  />
                )}
                onMove={(entry, startAt, duration) => {
                  if (!isCommitmentEntry(entry)) {
                    void schedule.move(entry, startAt, duration);
                  }
                }}
            />
          </div>

          <div
            className={`h-full overflow-y-auto ${
              mode === "week" ? "lg:hidden" : ""
            }`}
          >
            <DayView
              column={columns.find((column) => column.dateKey === activeDay)}
              dateKey={activeDay}
              todayKey={todayKey}
              selectedId={selectedIds[0] ?? null}
              accents={accents}
              onSelect={(entry) => setSelectedIds([entry.id])}
              onChangeDay={(nextDay) => {
                setDayKey(nextDay);
                if (nextDay < schedule.days[0]) schedule.goToWeek(-1);
                else if (nextDay > schedule.days[schedule.days.length - 1]) {
                  schedule.goToWeek(1);
                }
              }}
            />

            {/* На узком экране всплывающей карточке негде встать, поэтому там
                разбор занятия идёт следом за списком. */}
            {selected ? (
              <div className="mt-3 lg:hidden">
                <BlockDetails
                  block={selected}
                  timeZone={schedule.timeZone}
                  busy={schedule.busy}
                  onClose={() => setSelectedIds([])}
                  onTogglePinned={(pinned) =>
                    void schedule.setPinned([selected.id], pinned)
                  }
                />
              </div>
            ) : null}
          </div>

          {/* Помощник по расписанию живёт в панели справа: два разговора в одном
              углу экрана заставляли выбирать между ними глазами. Страница
              только сообщает панели, какое расписание на экране, — см.
              `usePageSchedule` выше. */}
        </div>
      </div>
    </CoffeePageShell>
  );
}

/**
 * Единственная полоска состояния над календарём.
 *
 * Показывает РОВНО ОДНО сообщение и одно действие. Раньше три источника —
 * предложения, ошибки и отмена переноса — рисовались каждый своей карточкой и
 * складывались стопкой; в худшем случае календарь начинался на середине экрана.
 * Порядок приоритета: ошибка важнее отмены, отмена важнее предложения.
 *
 * Названий программ здесь нет ни в одной ветке. Они длинные, а к какому курсу
 * относится занятие, написано на самом занятии.
 */
function CalendarNotice({
  proposals,
  notice,
  cancelledCount,
  hasUndo,
  busy,
  onConfirm,
  onDismiss,
  onUndo,
  onRestore,
}: {
  proposals: StudySchedule[];
  notice: string | null;
  cancelledCount: number;
  hasUndo: boolean;
  busy: boolean;
  onConfirm: (proposalId: string) => void;
  onDismiss: () => void;
  onUndo: () => void;
  onRestore: () => void;
}) {
  const row = `${paperTile} flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]`;

  // Отмена пачкой важнее всего остального: одна клавиша убрала несколько
  // занятий, и выход назад должен быть на виду, а не за следующим сообщением.
  if (cancelledCount > 0) {
    return (
      <div className={row}>
        <span className="text-[#5f584f]">
          Удалено {cancelledCount} {blockWord(cancelledCount)}
          <span className="ml-2 text-[#8d857b]">
            Ctrl+Shift+Z — удалить снова
          </span>
        </span>
        <button
          type="button"
          className={`${paperButton} shrink-0 px-3 py-1 text-[12px]`}
          disabled={busy}
          onClick={onRestore}
        >
          Вернуть · Ctrl+Z
        </button>
      </div>
    );
  }

  if (notice) {
    return (
      <div className={row}>
        <span className="min-w-0 truncate text-[#a2543a]">{notice}</span>
        <button
          type="button"
          className={`${paperButton} shrink-0 px-3 py-1 text-[12px]`}
          onClick={onDismiss}
        >
          Понятно
        </button>
      </div>
    );
  }

  if (hasUndo) {
    return (
      <div className={row}>
        <span className="text-[#5f584f]">Занятие перенесено</span>
        <button
          type="button"
          className={`${paperButton} shrink-0 px-3 py-1 text-[12px]`}
          disabled={busy}
          onClick={onUndo}
        >
          Вернуть как было
        </button>
      </div>
    );
  }

  const feasible = proposals.find((proposal) => proposal.feasible);
  if (feasible) {
    return (
      <div className={row}>
        <span className="text-[#5f584f]">
          Новое расписание показано пунктиром
        </span>
        <button
          type="button"
          className={`${paperPrimaryButton} shrink-0 px-3 py-1 text-[12px]`}
          disabled={busy}
          onClick={() => onConfirm(feasible.id)}
        >
          Подтвердить
        </button>
      </div>
    );
  }

  if (proposals.length > 0) {
    // Сколько именно не хватает и что с этим делать — вопрос к помощнику: он
    // умеет и продлить курс, и разгрузить дни, а страница только сообщает факт.
    return (
      <div className={row}>
        <span className="text-[#a2543a]">
          Программа не помещается в свободное время
        </span>
        <span className="shrink-0 text-[#8d857b]">
          спроси помощника, что подвинуть
        </span>
      </div>
    );
  }

  return null;
}
