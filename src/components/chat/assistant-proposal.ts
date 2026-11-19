// Что помощник предлагает поменять в делах ученика, и как это назвать словами.
//
// Модель сама ничего не пишет: сервер присылает предложение, ученик видит карточку и нажимает
// «Применить» (CLAUDE.md §3.3). Решение хранится вместе с ответом, поэтому переживает перезагрузку.
// Здесь только типы и подписи, чистые функции. Запись в `assistant-proposal-actions.ts`.

import type { ScheduleRevision } from "@/lib/studyplan-api";
import type { ParsedCommitment, ParsedStudyWindow } from "@/lib/studyplan-chat";
import type { DayOfWeek, LessonGrades, TemplateLessonSlot } from "@/types/diary";

import { DAY_OF_WEEK_LABELS, DAYS_ORDER } from "../../types/diary";
import type { LessonValues, TimetableLesson } from "../diary/diary-edits";
import { dateLocale, getLocale, msg, plural, t } from "../../lib/i18n";
import { scheduleLabel, scheduleOf, type SchedulePatch } from "../habits/habit-schedule";

export type ProposalState = "applied" | "dismissed" | "undone" | "stale";

/** Что созданное нужно убрать, чтобы вернуть как было. */
export interface ProposalUndo {
  habitIds?: number[];
  goalId?: string;
  topicIds?: string[];
  subjectIds?: string[];
  commitmentIds?: string[];
  /** Что вернуть сервер решил сам: клиент хранит это, не разбирая. */
  quickPlan?: Record<string, unknown>;
  blockIds?: string[];
  /** Расписание, которое создали с нуля: отмена его удаляет. */
  templateId?: string;
  /** Что записали: если ученик поправил расписание сам, отмена его правки не сотрёт. */
  slots?: TemplateLessonSlot[];
}

export type BlockAction = "cancel" | "restore" | "pin" | "unpin";
export type RemovedCommitment = ParsedCommitment & { id: string };
export interface GoalChangeFields {
  title?: string;
  dueDate?: string | null;
  isMain?: boolean;
  status?: string;
}
export interface HabitChangeFields {
  name?: string;
  goal?: string | null;
}
export interface TopicChangeFields {
  name?: string;
  subjectId?: string;
  status?: string;
  lastRevisedAt?: string | null;
  nextReviewAt?: string | null;
  intervalDays?: number | null;
  easeFactor?: number;
}

export interface LessonSlotRef {
  dayOfWeek: DayOfWeek;
  lessonNumber: number;
  startTime: string;
}

export interface LessonChange {
  day_id: string;
  lesson_id: string;
  slot: LessonSlotRef;
  subject_id: string;
  subject: string;
  date: string;
  fields: LessonValues;
  before: LessonValues;
}

interface ProposalBase {
  id: string;
  /** Пусто: ждёт решения. */
  state?: ProposalState;
  undo?: ProposalUndo;
}

export type AssistantProposal = ProposalBase &
  (
    | ({ kind: "new_habit"; name: string; goal_id: string | null; goal_title: string | null } & Partial<SchedulePatch>)
    | ({ kind: "habit_schedule"; habit_id: number; name: string; before: SchedulePatch } & SchedulePatch)
    | { kind: "mark_habit"; habit_id: number; name: string; done: boolean }
    | { kind: "new_goal"; title: string; scope: "study" | "general"; deadline: string | null; habits: string[] }
    | { kind: "goal_progress"; goal_id: string; title: string; before: number; progress: number }
    | { kind: "new_topics"; topics: { title: string; subject: string }[] }
    | {
        kind: "mark_homework";
        week_start: string;
        day_id: string;
        lesson_id: string;
        slot: LessonSlotRef;
        subject: string;
        homework: string;
        done: boolean;
      }
    | { kind: "revision"; revision: ScheduleRevision; time_zone: string }
    | { kind: "commitments"; items: ParsedCommitment[] }
    | {
        kind: "study_windows";
        windows: ParsedStudyWindow[];
        replace: boolean;
        current: ParsedStudyWindow[];
        template_id: string;
      }
    | {
        kind: "study_plan";
        subject: string;
        /** Пусто: предмета ещё нет. */
        goal_id: string | null;
        is_new: boolean;
        path: "subject_only" | "new_sessions" | "book_topics" | "extra_sessions";
        /** Только у добавленных занятий: к какому расписанию. */
        schedule_id?: string | null;
        weekdays: number[];
        start_time: string | null;
        end_time: string | null;
        minutes: number;
        from_date: string | null;
        to_date: string | null;
        timezone: string;
        sessions: number;
        left_topics: number;
        approves_plan: boolean;
      }
    | { kind: "block_changes"; action: BlockAction; block_ids: string[]; titles: string[] }
    | { kind: "commitment_removal"; items: RemovedCommitment[] }
    | {
        kind: "goal_change";
        goal_id: string;
        title: string;
        fields: GoalChangeFields;
        before: GoalChangeFields;
        previous_main_id: string | null;
      }
    | {
        kind: "habit_change";
        habit_id: number;
        name: string;
        fields: HabitChangeFields;
        before: HabitChangeFields;
        goal_title: string | null;
        delete: boolean;
      }
    | {
        kind: "topic_change";
        topic_id: string;
        name: string;
        subject: string;
        fields: TopicChangeFields;
        before: TopicChangeFields;
        new_subject: string | null;
        reviewed: boolean;
        delete: boolean;
      }
    | {
        kind: "subject_change";
        goal_ids: string[];
        subject_ids: string[];
        name: string;
        new_name: string | null;
        delete: boolean;
        blocks: number;
        topics: number;
        books: number;
        chats: number;
      }
    | { kind: "diary_changes"; week_start: string; changes: LessonChange[] }
    | {
        kind: "school_timetable";
        lessons: TimetableLesson[];
        clear_weekdays: number[];
        /** Пусто: расписания ещё нет. */
        template_id: string;
        before_slots: TemplateLessonSlot[];
        /** Что уйдёт из названных дней. У старых карточек поля нет. */
        removed?: { weekday: number; start: string; name: string }[];
      }
  );

export interface ProposalRow {
  name: string;
  note: string;
}

const dayLabel = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(dateLocale(), { day: "numeric", month: "long" });
};

/** По-английски с большой буквы всегда: «I», «I’ll», дни недели и месяцы. */
const ENGLISH_CAPITALS =
  /^(?:I(?=$|[\s’'])|(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?\b|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b)/;

/** В середине фразы: по-русски всё строчными, по-английски только первая буква, и не у имён. */
const lowerFirst = (text: string) => {
  if (getLocale() === "ru") return text.toLowerCase();
  return ENGLISH_CAPITALS.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
};

const howOften = (raw: Partial<SchedulePatch>) => lowerFirst(scheduleLabel(scheduleOf(raw)));

function newHabitNote(proposal: Extract<AssistantProposal, { kind: "new_habit" }>): string {
  const goal = proposal.goal_title ? t("к цели «{goal}»", { goal: proposal.goal_title }) : "";
  if (!goal) return howOften(proposal);
  return scheduleOf(proposal).frequency === "daily" ? goal : `${howOften(proposal)}, ${goal}`;
}

type StudyPlanProposal = Extract<AssistantProposal, { kind: "study_plan" }>;

const sessionsLabel = (count: number) => plural(count, "{n} занятие", "{n} занятия", "{n} занятий");

function periodLabel(from: string, to: string): string {
  if (from === to) return dayLabel(from);
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${Number(from.slice(8))}–${dayLabel(to)}`
    : `${dayLabel(from)} – ${dayLabel(to)}`;
}

/** Когда занятия, одной строкой. У разового занятия дни недели только мешают. */
function studyPlanWhen(proposal: StudyPlanProposal): string {
  const from = proposal.from_date ?? "";
  const to = proposal.to_date ?? "";
  return [
    ...(from === to ? [] : [howOften({ frequency: "weekdays", weekdays: proposal.weekdays })]),
    `${proposal.start_time}–${proposal.end_time}`,
    periodLabel(from, to),
    sessionsLabel(proposal.sessions),
  ].join(", ");
}

function studyPlanRows(proposal: StudyPlanProposal): ProposalRow[] {
  const note = proposal.is_new ? t("новый предмет") : proposal.path === "extra_sessions" ? t("к тому, что уже есть") : "";
  const rows = [{ name: proposal.subject, note }];
  if (proposal.sessions) rows.push({ name: t("Занятия"), note: studyPlanWhen(proposal) });
  if (proposal.left_topics) rows.push({ name: t("Остальные темы"), note: t("ещё {n} можно поставить потом", { n: proposal.left_topics }) });
  if (proposal.approves_plan) rows.push({ name: t("Программа"), note: t("подтвержу") });
  return rows;
}

const BLOCK_ACTIONS: Record<BlockAction, { heading: string; done: string; summary: string }> = {
  cancel: { heading: msg("Отменю занятия:"), done: msg("Занятия отменены."), summary: msg("отменить занятия") },
  restore: { heading: msg("Верну занятия:"), done: msg("Занятия возвращены."), summary: msg("вернуть занятия") },
  pin: { heading: msg("Закреплю занятия:"), done: msg("Занятия закреплены."), summary: msg("закрепить занятия") },
  unpin: { heading: msg("Сниму закрепление:"), done: msg("Закрепление снято."), summary: msg("открепить занятия") },
};

function goalChangeNote({ fields, before }: Extract<AssistantProposal, { kind: "goal_change" }>): string {
  const parts: string[] = [];
  if (fields.title) parts.push(t("название «{title}»", { title: fields.title }));
  if (fields.dueDate === null) parts.push(t("срок убрать"));
  else if (fields.dueDate) {
    parts.push(
      before.dueDate
        ? t("срок {from} → {to}", { from: dayLabel(before.dueDate), to: dayLabel(fields.dueDate) })
        : t("срок {date}", { date: dayLabel(fields.dueDate) }),
    );
  }
  if (fields.isMain !== undefined) parts.push(fields.isMain ? t("сделаю главной") : t("больше не главная"));
  if (fields.status === "done") parts.push(t("закрою"));
  if (fields.status === "archived") parts.push(t("уберу в архив, вернуть можно"));
  return parts.join(", ");
}

function habitChangeNote(proposal: Extract<AssistantProposal, { kind: "habit_change" }>): string {
  if (proposal.delete) return t("отметки удалятся, вернуть нельзя");
  const parts: string[] = [];
  if (proposal.fields.name) parts.push(t("название «{title}»", { title: proposal.fields.name }));
  if (proposal.fields.goal !== undefined) {
    parts.push(proposal.fields.goal ? t("к цели «{goal}»", { goal: proposal.goal_title ?? "" }) : t("без цели"));
  }
  return parts.join(", ");
}

function topicChangeNote(proposal: Extract<AssistantProposal, { kind: "topic_change" }>): string {
  if (proposal.delete) return t("вернуть нельзя");
  if (proposal.reviewed) return t("отмечу, что повторил");
  const parts: string[] = [];
  if (proposal.fields.name) parts.push(t("название «{title}»", { title: proposal.fields.name }));
  if (proposal.new_subject) parts.push(t("в предмет «{subject}»", { subject: proposal.new_subject }));
  return parts.join(", ");
}

/** Удаление уносит всё, что к предмету привязано: об этом надо сказать до нажатия. */
function subjectChangeNote(proposal: Extract<AssistantProposal, { kind: "subject_change" }>): string {
  if (!proposal.delete) return t("название «{title}»", { title: proposal.new_name ?? "" });
  const parts = [
    proposal.blocks ? plural(proposal.blocks, "{n} занятие", "{n} занятия", "{n} занятий") : "",
    proposal.topics ? plural(proposal.topics, "{n} тему на повторение", "{n} темы на повторение", "{n} тем на повторение") : "",
    proposal.books ? plural(proposal.books, "{n} книгу", "{n} книги", "{n} книг") : "",
    proposal.chats ? plural(proposal.chats, "{n} разговор", "{n} разговора", "{n} разговоров") : "",
  ].filter(Boolean);
  if (!parts.length) return t("вернуть нельзя");
  const last = parts.pop() ?? "";
  const list = parts.length ? t("{a} и {b}", { a: parts.join(", "), b: last }) : last;
  return t("удалю {list}, вернуть нельзя", { list });
}

const GRADE_NAMES: Record<keyof LessonGrades, string> = {
  exercises: msg("оценка"),
  test: msg("оценка за тест"),
  retelling: msg("оценка за пересказ"),
};

const oneLine = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
const BEFORE_CHARS = 60;

function shortened(text: string): string {
  const line = oneLine(text);
  return line.length > BEFORE_CHARS ? `${line.slice(0, BEFORE_CHARS).trimEnd()}…` : line;
}

/** Правка заменяет поле целиком, поэтому прежнее видно на карточке. */
function textChange(label: string, removal: string, after: string | undefined, before: string | undefined): string | null {
  if (after === undefined) return null;
  const was = shortened(before ?? "");
  if (!after) return was ? `${t(removal)} «${was}»` : t(removal);
  return was ? `${t(label)}: ${was} → ${oneLine(after)}` : `${t(label)}: ${oneLine(after)}`;
}

function lessonChangeNote({ fields, before }: LessonChange): string {
  const parts = [textChange(msg("домашка"), msg("убрать домашку"), fields.homework, before.homework)];
  for (const [field, value] of Object.entries(fields.grades ?? {})) {
    const was = before.grades?.[field as keyof LessonGrades] ?? null;
    const name = t(GRADE_NAMES[field as keyof LessonGrades]);
    if (value === null) parts.push(was === null ? t("убрать оценку") : t("убрать оценку {grade}", { grade: was }));
    else parts.push(was === null ? `${name}: ${value}` : `${name}: ${was} → ${value}`);
  }
  parts.push(textChange(msg("заметка"), msg("убрать заметку"), fields.notes, before.notes));
  return parts.filter(Boolean).join(", ");
}

const lessonChangeName = (change: LessonChange) => `${change.subject}, ${dayLabel(change.date)}`;

type TimetableProposal = Extract<AssistantProposal, { kind: "school_timetable" }>;

const clock = (time: string) => time.replace(/^0/, "");
const weekdayName = (day: number) => t(DAY_OF_WEEK_LABELS[DAYS_ORDER[day]]);

function timetableDays({ lessons, clear_weekdays }: TimetableProposal): number[] {
  return Array.from(new Set([...lessons.map((lesson) => lesson.weekday), ...clear_weekdays])).sort((a, b) => a - b);
}

function timetableRows(proposal: TimetableProposal): ProposalRow[] {
  const days = timetableDays(proposal);
  const rows: ProposalRow[] = days.map((day) => {
    const added = proposal.lessons
      .filter((lesson) => lesson.weekday === day)
      .map((lesson) => `${lesson.subject} ${clock(lesson.start)}`)
      .join(", ");
    const gone = (proposal.removed ?? [])
      .filter((slot) => slot.weekday === day)
      .map((slot) => `${slot.name} ${clock(slot.start)}`)
      .join(", ");
    return { name: weekdayName(day), note: [added, gone && t("уберу: {list}", { list: gone })].filter(Boolean).join("; ") || t("уроков не будет") };
  });
  const named = days.map((day) => DAYS_ORDER[day]);
  if (proposal.before_slots.some((slot) => !named.includes(slot.dayOfWeek))) {
    rows.push({ name: t("Остальные дни"), note: t("останутся как есть") });
  }
  rows.push({ name: t("Недели с оценками и заданиями"), note: t("останутся как есть") });
  return rows;
}

/** Строка над списком изменений. */
export function proposalHeading(proposal: AssistantProposal): string {
  switch (proposal.kind) {
    case "new_habit":
      return t("Добавлю привычку:");
    case "habit_schedule":
      return t("Поменяю, как часто:");
    case "mark_habit":
      return proposal.done ? t("Отмечу за сегодня:") : t("Сниму отметку за сегодня:");
    case "new_goal":
      return t("Добавлю цель:");
    case "goal_progress":
      return t("Поменяю прогресс:");
    case "new_topics":
      return t("Запишу в повторение, первое завтра:");
    case "mark_homework":
      return proposal.done ? t("Отмечу задание сделанным:") : t("Сниму отметку с задания:");
    case "study_plan":
      return proposal.path === "extra_sessions" ? t("Добавлю занятия:") : t("Настрою предмет:");
    case "block_changes":
      return t(BLOCK_ACTIONS[proposal.action].heading);
    case "commitment_removal":
      return t("Уберу занятое время:");
    case "goal_change":
      return t("Поменяю цель:");
    case "habit_change":
      return proposal.delete ? t("Удалю привычку:") : t("Поменяю привычку:");
    case "topic_change":
      return proposal.delete ? t("Удалю тему:") : t("Поменяю тему:");
    case "subject_change":
      return proposal.delete ? t("Удалю предмет:") : t("Поменяю предмет:");
    case "diary_changes":
      return t("Запишу в дневник:");
    case "school_timetable":
      return t("Запишу школьное расписание:");
    default:
      return "";
  }
}

/** Что именно изменится. Расписание рисует свои карточки: там diff устроен сложнее. */
export function proposalRows(proposal: AssistantProposal): ProposalRow[] {
  switch (proposal.kind) {
    case "new_habit":
      return [{ name: proposal.name, note: newHabitNote(proposal) }];
    case "habit_schedule":
      return [{ name: proposal.name, note: `${howOften(proposal.before)} → ${howOften(proposal)}` }];
    case "mark_habit":
      return [{ name: proposal.name, note: "" }];
    case "new_goal":
      return [
        {
          name: proposal.title,
          note: proposal.deadline ? t("к {date}", { date: dayLabel(proposal.deadline) }) : proposal.scope === "study" ? t("учёба") : t("общая"),
        },
        ...proposal.habits.map((name) => ({ name, note: t("привычка") })),
      ];
    case "goal_progress":
      return [{ name: proposal.title, note: `${proposal.before}% → ${proposal.progress}%` }];
    case "new_topics":
      return proposal.topics.map((topic) => ({ name: topic.title, note: topic.subject }));
    case "mark_homework":
      return [{ name: proposal.subject, note: proposal.homework }];
    case "study_plan":
      return studyPlanRows(proposal);
    case "block_changes":
      return proposal.titles.map((title) => ({ name: title, note: "" }));
    case "commitment_removal":
      return proposal.items.map((item) => ({
        name: item.title,
        note: item.weekday_name ? `${t(item.weekday_name)}, ${item.start_time}` : t("разово"),
      }));
    case "goal_change":
      return [{ name: proposal.title, note: goalChangeNote(proposal) }];
    case "habit_change":
      return [{ name: proposal.name, note: habitChangeNote(proposal) }];
    case "topic_change":
      return [{ name: proposal.name, note: topicChangeNote(proposal) }];
    case "subject_change":
      return [{ name: proposal.name, note: subjectChangeNote(proposal) }];
    case "diary_changes":
      return proposal.changes.map((change) => ({ name: lessonChangeName(change), note: lessonChangeNote(change) }));
    case "school_timetable":
      return timetableRows(proposal);
    default:
      return [];
  }
}

/** Строки для общей карточки: заголовка своего вида там нет, и каждая говорит сама за себя. */
export function batchRows(proposal: AssistantProposal): ProposalRow[] {
  switch (proposal.kind) {
    case "new_habit":
      return [{ name: t("Привычка «{name}»", { name: proposal.name }), note: newHabitNote(proposal) }];
    case "new_goal":
      return proposalRows(proposal).map((row, index) =>
        index ? row : { name: t("Цель «{title}»", { title: proposal.title }), note: proposal.deadline ? t("срок {date}", { date: dayLabel(proposal.deadline) }) : row.note },
      );
    case "new_topics":
      return proposal.topics.map((topic) => ({ name: topic.title, note: t("в повторение, {subject}", { subject: topic.subject }) }));
    case "goal_change":
      return [{ name: t("Цель «{title}»", { title: proposal.title }), note: goalChangeNote(proposal) }];
    case "habit_change":
      return [{ name: t("Привычка «{name}»", { name: proposal.name }), note: habitChangeNote(proposal) }];
    case "topic_change":
      return [{ name: t("Тема «{name}»", { name: proposal.name }), note: topicChangeNote(proposal) }];
    case "subject_change":
      return [{ name: t("Предмет «{name}»", { name: proposal.name }), note: subjectChangeNote(proposal) }];
    default: {
      const heading = lowerFirst(proposalHeading(proposal).replace(/:$/, ""));
      return proposalRows(proposal).map((row) => (row.note ? row : { ...row, note: heading }));
    }
  }
}

/** Что сделано. Действие называется так же, как в предложении. */
export function proposalDoneText(proposal: AssistantProposal): string {
  switch (proposal.kind) {
    case "new_habit":
      return t("Привычка «{name}» добавлена.", { name: proposal.name });
    case "habit_schedule":
      return t("«{name}» теперь {often}.", { name: proposal.name, often: howOften(proposal) });
    case "mark_habit":
      return proposal.done
        ? t("«{name}» отмечено за сегодня.", { name: proposal.name })
        : t("Отметка с «{name}» снята.", { name: proposal.name });
    case "new_goal":
      return t("Цель «{title}» добавлена.", { title: proposal.title });
    case "goal_progress":
      return t("Прогресс теперь {progress}%.", { progress: proposal.progress });
    case "new_topics":
      return proposal.topics.length === 1 ? t("Тема записана в повторение.") : t("Темы записаны в повторение.");
    case "mark_homework":
      return proposal.done ? t("Задание отмечено сделанным.") : t("Отметка с задания снята.");
    case "revision":
      return t("План обновлён.");
    case "commitments":
      return t("Занятое время записано.");
    case "study_windows":
      return t("Время занятий обновлено.");
    case "study_plan":
      return proposal.sessions
        ? t("«{subject}»: {sessions} в календаре.", { subject: proposal.subject, sessions: sessionsLabel(proposal.sessions) })
        : t("Предмет «{subject}» добавлен.", { subject: proposal.subject });
    case "block_changes":
      return t(BLOCK_ACTIONS[proposal.action].done);
    case "commitment_removal":
      return t("Занятое время убрано.");
    case "goal_change":
      return t("Цель «{title}» обновлена.", { title: proposal.fields.title ?? proposal.title });
    case "habit_change":
      return proposal.delete
        ? t("Привычка «{name}» удалена.", { name: proposal.name })
        : t("Привычка «{name}» обновлена.", { name: proposal.fields.name ?? proposal.name });
    case "topic_change":
      return proposal.delete ? t("Тема «{name}» удалена.", { name: proposal.name }) : t("Тема обновлена.");
    case "subject_change":
      return proposal.delete
        ? t("Предмет «{name}» удалён.", { name: proposal.name })
        : t("Предмет теперь называется «{name}».", { name: proposal.new_name ?? "" });
    case "diary_changes":
      return t("Записано в дневник.");
    case "school_timetable":
      return t("Школьное расписание записано.");
  }
}

/** Вернуть можно всё, кроме ритма (прежние окна уже удалены) и удалённого насовсем. */
export function canUndoProposal(proposal: AssistantProposal): boolean {
  if (proposal.kind === "habit_change" || proposal.kind === "topic_change" || proposal.kind === "subject_change") {
    return !proposal.delete;
  }
  return proposal.kind !== "study_windows";
}

/** Одной фразой: для плашки слайма и для памяти разговора. */
export function proposalSummary(proposal: AssistantProposal): string {
  switch (proposal.kind) {
    case "new_habit":
      return t("новая привычка «{name}», {often}", { name: proposal.name, often: howOften(proposal) });
    case "habit_schedule":
      return t("«{name}» {often} вместо «{before}»", {
        name: proposal.name,
        often: howOften(proposal),
        before: howOften(proposal.before),
      });
    case "mark_habit":
      return proposal.done
        ? t("отметить «{name}» за сегодня", { name: proposal.name })
        : t("снять отметку с «{name}»", { name: proposal.name });
    case "new_goal":
      return t("новая цель «{title}»", { title: proposal.title });
    case "goal_progress":
      return t("прогресс цели «{title}»: {before}% → {progress}%", {
        title: proposal.title,
        before: proposal.before,
        progress: proposal.progress,
      });
    case "new_topics":
      return t("в повторение: {list}", { list: proposal.topics.map((topic) => topic.title).join(", ") });
    case "mark_homework":
      return proposal.done
        ? t("отметить задание по предмету «{subject}»", { subject: proposal.subject })
        : t("снять отметку с задания по предмету «{subject}»", { subject: proposal.subject });
    case "revision":
      return t("изменение расписания");
    case "commitments":
      return t("занятое время: {list}", { list: proposal.items.map((item) => item.title).join(", ") });
    case "study_windows":
      return t("новое время занятий");
    case "study_plan": {
      const name = proposal.is_new
        ? t("новый предмет «{subject}»", { subject: proposal.subject })
        : t("предмет «{subject}»", { subject: proposal.subject });
      return proposal.sessions ? `${name}, ${studyPlanWhen(proposal)}` : name;
    }
    case "block_changes":
      return t("{action}: {list}", { action: t(BLOCK_ACTIONS[proposal.action].summary), list: proposal.titles.join(", ") });
    case "commitment_removal":
      return t("убрать занятое время: {list}", { list: proposal.items.map((item) => item.title).join(", ") });
    case "goal_change":
      return t("поменять цель «{title}»: {note}", { title: proposal.title, note: goalChangeNote(proposal) });
    case "habit_change":
      return proposal.delete
        ? t("удалить привычку «{name}»", { name: proposal.name })
        : t("поменять привычку «{name}»: {note}", { name: proposal.name, note: habitChangeNote(proposal) });
    case "topic_change":
      return proposal.delete
        ? t("удалить тему «{name}»", { name: proposal.name })
        : t("поменять тему «{name}»: {note}", { name: proposal.name, note: topicChangeNote(proposal) });
    case "subject_change":
      return proposal.delete
        ? t("удалить предмет «{name}»", { name: proposal.name })
        : t("переименовать предмет «{name}» в «{new_name}»", { name: proposal.name, new_name: proposal.new_name ?? "" });
    case "diary_changes":
      return t("в дневник: {list}", {
        list: proposal.changes.map((change) => `${lessonChangeName(change)}, ${lessonChangeNote(change)}`).join("; "),
      });
    case "school_timetable":
      return t("школьное расписание: {list}", { list: timetableDays(proposal).map((day) => lowerFirst(weekdayName(day))).join(", ") });
  }
}

const DECISION: Record<ProposalState, string> = {
  applied: msg("ученик применил"),
  dismissed: msg("ученик отказался"),
  undone: msg("ученик применил, потом вернул как было"),
  stale: msg("устарело"),
};

/**
 * Реплика для памяти разговора. Иначе модель не знает, что предлагала и что решил ученик,
 * и на «да, давай» предложила бы то же самое второй раз.
 */
export function historyContent(turn: { content: string; proposals?: AssistantProposal[] }): string {
  const notes = (turn.proposals ?? []).map(
    (proposal) =>
      t("[Предложение: {summary}. {decision}.]", {
        summary: proposalSummary(proposal),
        decision: proposal.state ? t(DECISION[proposal.state]) : t("ждёт решения ученика"),
      }),
  );
  return [turn.content, ...notes].join("\n");
}
