// Что помощник предлагает поменять в делах ученика, и как это назвать словами.
//
// Модель сама ничего не пишет: сервер присылает предложение, ученик видит карточку и нажимает
// «Применить» (CLAUDE.md §3.3). Решение хранится вместе с ответом, поэтому переживает перезагрузку.
// Здесь только типы и подписи, чистые функции. Запись в `assistant-proposal-actions.ts`.

import type { ScheduleRevision } from "@/lib/studyplan-api";
import type { ParsedCommitment, ParsedStudyWindow } from "@/lib/studyplan-chat";
import type { DayOfWeek } from "@/types/diary";

import { scheduleLabel, scheduleOf, type SchedulePatch } from "../habits/habit-schedule";

export type ProposalState = "applied" | "dismissed" | "undone" | "stale";

/** Что созданное нужно убрать, чтобы вернуть как было. */
export interface ProposalUndo {
  habitIds?: number[];
  goalId?: string;
  topicIds?: string[];
  subjectIds?: string[];
  commitmentIds?: string[];
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
    default:
      return [];
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
  }
}

/** Вернуть можно всё, кроме ритма: прежние окна уже удалены. */
export function canUndoProposal(proposal: AssistantProposal): boolean {
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
