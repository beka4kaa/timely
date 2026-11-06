// Что помощник предлагает поменять в делах ученика, и как это назвать словами.
//
// Модель сама ничего не пишет: сервер присылает предложение, ученик видит карточку и нажимает
// «Применить» (CLAUDE.md §3.3). Решение хранится вместе с ответом, поэтому переживает перезагрузку.
// Здесь только типы и подписи, чистые функции. Запись в `assistant-proposal-actions.ts`.

import type { ScheduleRevision } from "@/lib/studyplan-api";
import type { ParsedCommitment, ParsedStudyWindow } from "@/lib/studyplan-chat";
import type { DayOfWeek } from "@/types/diary";

import { plural } from "../habits/habit-days";
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
  );

export interface ProposalRow {
  name: string;
  note: string;
}

const dayLabel = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
};

const howOften = (raw: Partial<SchedulePatch>) => scheduleLabel(scheduleOf(raw)).toLowerCase();

function newHabitNote(proposal: Extract<AssistantProposal, { kind: "new_habit" }>): string {
  const goal = proposal.goal_title ? `к цели «${proposal.goal_title}»` : "";
  if (!goal) return howOften(proposal);
  return scheduleOf(proposal).frequency === "daily" ? goal : `${howOften(proposal)}, ${goal}`;
}

type StudyPlanProposal = Extract<AssistantProposal, { kind: "study_plan" }>;

const sessionsLabel = (count: number) => `${count} ${plural(count, "занятие", "занятия", "занятий")}`;

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
  const note = proposal.is_new ? "новый предмет" : proposal.path === "extra_sessions" ? "к тому, что уже есть" : "";
  const rows = [{ name: proposal.subject, note }];
  if (proposal.sessions) rows.push({ name: "Занятия", note: studyPlanWhen(proposal) });
  if (proposal.left_topics) rows.push({ name: "Остальные темы", note: `ещё ${proposal.left_topics} можно поставить потом` });
  if (proposal.approves_plan) rows.push({ name: "Программа", note: "подтвержу" });
  return rows;
}

const BLOCK_ACTIONS: Record<BlockAction, { heading: string; done: string; summary: string }> = {
  cancel: { heading: "Отменю занятия:", done: "Занятия отменены.", summary: "отменить занятия" },
  restore: { heading: "Верну занятия:", done: "Занятия возвращены.", summary: "вернуть занятия" },
  pin: { heading: "Закреплю занятия:", done: "Занятия закреплены.", summary: "закрепить занятия" },
  unpin: { heading: "Сниму закрепление:", done: "Закрепление снято.", summary: "открепить занятия" },
};

function goalChangeNote({ fields, before }: Extract<AssistantProposal, { kind: "goal_change" }>): string {
  const parts: string[] = [];
  if (fields.title) parts.push(`название «${fields.title}»`);
  if (fields.dueDate === null) parts.push("срок убрать");
  else if (fields.dueDate) parts.push(before.dueDate ? `срок ${dayLabel(before.dueDate)} → ${dayLabel(fields.dueDate)}` : `срок ${dayLabel(fields.dueDate)}`);
  if (fields.isMain !== undefined) parts.push(fields.isMain ? "сделаю главной" : "больше не главная");
  if (fields.status === "done") parts.push("закрою");
  if (fields.status === "archived") parts.push("уберу в архив, вернуть можно");
  return parts.join(", ");
}

function habitChangeNote(proposal: Extract<AssistantProposal, { kind: "habit_change" }>): string {
  if (proposal.delete) return "отметки удалятся, вернуть нельзя";
  const parts: string[] = [];
  if (proposal.fields.name) parts.push(`название «${proposal.fields.name}»`);
  if (proposal.fields.goal !== undefined) parts.push(proposal.fields.goal ? `к цели «${proposal.goal_title}»` : "без цели");
  return parts.join(", ");
}

function topicChangeNote(proposal: Extract<AssistantProposal, { kind: "topic_change" }>): string {
  if (proposal.delete) return "вернуть нельзя";
  if (proposal.reviewed) return "отмечу, что повторил";
  const parts: string[] = [];
  if (proposal.fields.name) parts.push(`название «${proposal.fields.name}»`);
  if (proposal.new_subject) parts.push(`в предмет «${proposal.new_subject}»`);
  return parts.join(", ");
}

/** Удаление уносит всё, что к предмету привязано: об этом надо сказать до нажатия. */
function subjectChangeNote(proposal: Extract<AssistantProposal, { kind: "subject_change" }>): string {
  if (!proposal.delete) return `название «${proposal.new_name}»`;
  const parts = [
    proposal.blocks ? `${proposal.blocks} ${plural(proposal.blocks, "занятие", "занятия", "занятий")}` : "",
    proposal.topics ? `${proposal.topics} ${plural(proposal.topics, "тему", "темы", "тем")} на повторение` : "",
    proposal.books ? `${proposal.books} ${plural(proposal.books, "книгу", "книги", "книг")}` : "",
    proposal.chats ? `${proposal.chats} ${plural(proposal.chats, "разговор", "разговора", "разговоров")}` : "",
  ].filter(Boolean);
  if (!parts.length) return "вернуть нельзя";
  const last = parts.pop();
  return `удалю ${parts.length ? `${parts.join(", ")} и ${last}` : last}, вернуть нельзя`;
}

/** Строка над списком изменений. */
export function proposalHeading(proposal: AssistantProposal): string {
  switch (proposal.kind) {
    case "new_habit":
      return "Добавлю привычку:";
    case "habit_schedule":
      return "Поменяю, как часто:";
    case "mark_habit":
      return proposal.done ? "Отмечу за сегодня:" : "Сниму отметку за сегодня:";
    case "new_goal":
      return "Добавлю цель:";
    case "goal_progress":
      return "Поменяю прогресс:";
    case "new_topics":
      return "Запишу в повторение, первое завтра:";
    case "mark_homework":
      return proposal.done ? "Отмечу задание сделанным:" : "Сниму отметку с задания:";
    case "study_plan":
      return proposal.path === "extra_sessions" ? "Добавлю занятия:" : "Настрою предмет:";
    case "block_changes":
      return BLOCK_ACTIONS[proposal.action].heading;
    case "commitment_removal":
      return "Уберу занятое время:";
    case "goal_change":
      return "Поменяю цель:";
    case "habit_change":
      return proposal.delete ? "Удалю привычку:" : "Поменяю привычку:";
    case "topic_change":
      return proposal.delete ? "Удалю тему:" : "Поменяю тему:";
    case "subject_change":
      return proposal.delete ? "Удалю предмет:" : "Поменяю предмет:";
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
          note: proposal.deadline ? `к ${dayLabel(proposal.deadline)}` : proposal.scope === "study" ? "учёба" : "общая",
        },
        ...proposal.habits.map((name) => ({ name, note: "привычка" })),
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
        note: item.weekday_name ? `${item.weekday_name}, ${item.start_time}` : "разово",
      }));
    case "goal_change":
      return [{ name: proposal.title, note: goalChangeNote(proposal) }];
    case "habit_change":
      return [{ name: proposal.name, note: habitChangeNote(proposal) }];
    case "topic_change":
      return [{ name: proposal.name, note: topicChangeNote(proposal) }];
    case "subject_change":
      return [{ name: proposal.name, note: subjectChangeNote(proposal) }];
    default:
      return [];
  }
}

/** Строки для общей карточки: заголовка своего вида там нет, и каждая говорит сама за себя. */
export function batchRows(proposal: AssistantProposal): ProposalRow[] {
  switch (proposal.kind) {
    case "new_habit":
      return [{ name: `Привычка «${proposal.name}»`, note: newHabitNote(proposal) }];
    case "new_goal":
      return proposalRows(proposal).map((row, index) =>
        index ? row : { name: `Цель «${proposal.title}»`, note: proposal.deadline ? `срок ${dayLabel(proposal.deadline)}` : row.note },
      );
    case "new_topics":
      return proposal.topics.map((topic) => ({ name: topic.title, note: `в повторение, ${topic.subject}` }));
    case "goal_change":
      return [{ name: `Цель «${proposal.title}»`, note: goalChangeNote(proposal) }];
    case "habit_change":
      return [{ name: `Привычка «${proposal.name}»`, note: habitChangeNote(proposal) }];
    case "topic_change":
      return [{ name: `Тема «${proposal.name}»`, note: topicChangeNote(proposal) }];
    case "subject_change":
      return [{ name: `Предмет «${proposal.name}»`, note: subjectChangeNote(proposal) }];
    default: {
      const heading = proposalHeading(proposal).replace(/:$/, "").toLowerCase();
      return proposalRows(proposal).map((row) => (row.note ? row : { ...row, note: heading }));
    }
  }
}

/** Что сделано. Действие называется так же, как в предложении. */
export function proposalDoneText(proposal: AssistantProposal): string {
  switch (proposal.kind) {
    case "new_habit":
      return `Привычка «${proposal.name}» добавлена.`;
    case "habit_schedule":
      return `«${proposal.name}» теперь ${howOften(proposal)}.`;
    case "mark_habit":
      return proposal.done ? `«${proposal.name}» отмечено за сегодня.` : `Отметка с «${proposal.name}» снята.`;
    case "new_goal":
      return `Цель «${proposal.title}» добавлена.`;
    case "goal_progress":
      return `Прогресс теперь ${proposal.progress}%.`;
    case "new_topics":
      return proposal.topics.length === 1 ? "Тема записана в повторение." : "Темы записаны в повторение.";
    case "mark_homework":
      return proposal.done ? "Задание отмечено сделанным." : "Отметка с задания снята.";
    case "revision":
      return "План обновлён.";
    case "commitments":
      return "Занятое время записано.";
    case "study_windows":
      return "Время занятий обновлено.";
    case "study_plan":
      return proposal.sessions
        ? `«${proposal.subject}»: ${sessionsLabel(proposal.sessions)} в календаре.`
        : `Предмет «${proposal.subject}» добавлен.`;
    case "block_changes":
      return BLOCK_ACTIONS[proposal.action].done;
    case "commitment_removal":
      return "Занятое время убрано.";
    case "goal_change":
      return `Цель «${proposal.fields.title ?? proposal.title}» обновлена.`;
    case "habit_change":
      return proposal.delete
        ? `Привычка «${proposal.name}» удалена.`
        : `Привычка «${proposal.fields.name ?? proposal.name}» обновлена.`;
    case "topic_change":
      return proposal.delete ? `Тема «${proposal.name}» удалена.` : "Тема обновлена.";
    case "subject_change":
      return proposal.delete
        ? `Предмет «${proposal.name}» удалён.`
        : `Предмет теперь называется «${proposal.new_name}».`;
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
      return `новая привычка «${proposal.name}», ${howOften(proposal)}`;
    case "habit_schedule":
      return `«${proposal.name}» ${howOften(proposal)} вместо «${howOften(proposal.before)}»`;
    case "mark_habit":
      return proposal.done ? `отметить «${proposal.name}» за сегодня` : `снять отметку с «${proposal.name}»`;
    case "new_goal":
      return `новая цель «${proposal.title}»`;
    case "goal_progress":
      return `прогресс цели «${proposal.title}»: ${proposal.before}% → ${proposal.progress}%`;
    case "new_topics":
      return `в повторение: ${proposal.topics.map((topic) => topic.title).join(", ")}`;
    case "mark_homework":
      return `${proposal.done ? "отметить задание" : "снять отметку с задания"} по предмету «${proposal.subject}»`;
    case "revision":
      return "изменение расписания";
    case "commitments":
      return `занятое время: ${proposal.items.map((item) => item.title).join(", ")}`;
    case "study_windows":
      return "новое время занятий";
    case "study_plan": {
      const name = `${proposal.is_new ? "новый предмет" : "предмет"} «${proposal.subject}»`;
      return proposal.sessions ? `${name}, ${studyPlanWhen(proposal)}` : name;
    }
    case "block_changes":
      return `${BLOCK_ACTIONS[proposal.action].summary}: ${proposal.titles.join(", ")}`;
    case "commitment_removal":
      return `убрать занятое время: ${proposal.items.map((item) => item.title).join(", ")}`;
    case "goal_change":
      return `поменять цель «${proposal.title}»: ${goalChangeNote(proposal)}`;
    case "habit_change":
      return proposal.delete
        ? `удалить привычку «${proposal.name}»`
        : `поменять привычку «${proposal.name}»: ${habitChangeNote(proposal)}`;
    case "topic_change":
      return proposal.delete
        ? `удалить тему «${proposal.name}»`
        : `поменять тему «${proposal.name}»: ${topicChangeNote(proposal)}`;
    case "subject_change":
      return proposal.delete
        ? `удалить предмет «${proposal.name}»`
        : `переименовать предмет «${proposal.name}» в «${proposal.new_name}»`;
  }
}

const DECISION: Record<ProposalState, string> = {
  applied: "ученик применил",
  dismissed: "ученик отказался",
  undone: "ученик применил, потом вернул как было",
  stale: "устарело",
};

/**
 * Реплика для памяти разговора. Иначе модель не знает, что предлагала и что решил ученик,
 * и на «да, давай» предложила бы то же самое второй раз.
 */
export function historyContent(turn: { content: string; proposals?: AssistantProposal[] }): string {
  const notes = (turn.proposals ?? []).map(
    (proposal) =>
      `[Предложение: ${proposalSummary(proposal)}. ${proposal.state ? DECISION[proposal.state] : "ждёт решения ученика"}.]`,
  );
  return [turn.content, ...notes].join("\n");
}
