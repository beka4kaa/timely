"use client";

// Запись предложения помощника. Те же API и те же проверки, что у страниц: новых путей записи
// модель не получает. Сюда приходят только после нажатия «Применить».

import { markHomeworkDone } from "@/components/diary/use-diary-week";
import { TONES, isOpenGoal } from "@/components/goals/goal-logic";
import { createGoal, listGoals, moveGoalProgress, updateGoal } from "@/components/goals/goals-api";
import { localDay, nextHabitColor } from "@/components/habits/habit-days";
import { createHabit, deleteHabit, listHabits, markHabit } from "@/components/habits/lib";
import { invalidatePlan } from "@/components/now/now-resources";
import { dataChanged } from "@/lib/data-changed";
import { closedByRejecting } from "@/lib/now-feed";
import {
  applyStudyWindows,
  confirmRevision,
  createCommitment,
  deleteCommitment,
  listTemplates,
  rejectRevision,
  StudyplanApiError,
  undoRevision,
} from "@/lib/studyplan-api";
import { findSubject, firstReviewFields, type WeakSubject, type WeakTopic } from "@/lib/weak-topics";
import {
  createSubject,
  createTopic,
  deleteSubject,
  deleteTopic,
  fetchSubjects,
  subjectsChanged,
  topicsChanged,
} from "@/lib/weak-topics-api";

import type { AssistantProposal, ProposalUndo } from "./assistant-proposal";

/** Предложение опоздало: расписание уже поменялось или на него уже ответили. */
export function isStaleProposalError(error: unknown): boolean {
  return error instanceof StudyplanApiError && (error.isStale || error.isClosed);
}

/** Записывает. Возвращает то, что нужно для «Вернуть как было». */
export async function applyProposal(proposal: AssistantProposal): Promise<ProposalUndo> {
  const today = localDay();
  switch (proposal.kind) {
    case "new_habit": {
      const taken = (await listHabits(today)).map((row) => row.color);
      const created = await createHabit(
        { name: proposal.name, color: nextHabitColor(taken), goal: proposal.goal_id },
        today,
      );
      dataChanged("habits");
      return { habitIds: [created.id] };
    }
    case "mark_habit":
      await markHabit(proposal.habit_id, proposal.done, today);
      dataChanged("habits");
      return {};
    case "new_goal": {
      const open = (await listGoals()).filter(isOpenGoal).length;
      const goal = await createGoal({
        title: proposal.title,
        scope: proposal.scope,
        tone: TONES[open % TONES.length],
        dueDate: proposal.deadline,
      });
      const habitIds: number[] = [];
      if (proposal.habits.length) {
        const taken = (await listHabits(today)).map((row) => row.color);
        for (const name of proposal.habits) {
          const color = nextHabitColor(taken);
          const created = await createHabit({ name, color, goal: goal.id }, today);
          taken.push(color);
          habitIds.push(created.id);
        }
        dataChanged("habits");
      }
      dataChanged("goals");
      return { goalId: goal.id, habitIds };
    }
    case "goal_progress":
      await moveGoalProgress(proposal.goal_id, proposal.progress);
      dataChanged("goals");
      return {};
    case "new_topics": {
      // Предметы свежие и совпадают по смыслу: один предмет не должен появиться дважды.
      const known = await fetchSubjects();
      const subjects: WeakSubject[] = [];
      const topics: WeakTopic[] = [];
      const now = new Date();
      for (const row of proposal.topics) {
        let subject = findSubject(known, row.subject);
        if (!subject) {
          subject = await createSubject(row.subject);
          known.push(subject);
          subjects.push(subject);
        }
        topics.push(await createTopic({ name: row.title, subjectId: subject.id, ...firstReviewFields(now) }));
      }
      if (subjects.length) subjectsChanged((list) => [...list, ...subjects]);
      topicsChanged((list) => [...list, ...topics]);
      return { topicIds: topics.map((row) => row.id), subjectIds: subjects.map((row) => row.id) };
    }
    case "mark_homework":
      await markHomeworkDone(proposal.week_start, proposal, proposal.done);
      return {};
    case "revision":
      await confirmRevision(proposal.revision.id);
      // Принятое двигает всё расписание вперёд, и его прежние предложения уже не применить.
      invalidatePlan((item) => item.schedule === proposal.revision.schedule);
      return {};
    case "commitments": {
      const commitmentIds: string[] = [];
      for (const item of proposal.items) {
        const created = await createCommitment(
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
        commitmentIds.push(created.id);
      }
      invalidatePlan();
      return { commitmentIds };
    }
    case "study_windows": {
      // Прежние окна нужны только для замены: их идентификаторы знает шаблон.
      const previousSlotIds = proposal.replace
        ? ((await listTemplates()).find((item) => item.id === proposal.template_id)?.slots.map((slot) => slot.id) ?? [])
        : [];
      await applyStudyWindows(
        proposal.template_id,
        proposal.windows.map((window) => ({
          weekday: window.weekday,
          start_time: window.start_time,
          duration_minutes: window.duration_minutes,
        })),
        { replace: proposal.replace, previousSlotIds },
      );
      invalidatePlan();
      return {};
    }
  }
}

/** «Не надо». На сервере живёт только предложение по расписанию, остальные просто забываются. */
export async function dismissProposal(proposal: AssistantProposal): Promise<void> {
  if (proposal.kind !== "revision") return;
  await rejectRevision(proposal.revision.id);
  invalidatePlan(closedByRejecting(proposal.revision));
}

/** «Вернуть как было». */
export async function undoProposal(proposal: AssistantProposal): Promise<void> {
  const today = localDay();
  const undo = proposal.undo ?? {};
  switch (proposal.kind) {
    case "new_habit":
      await Promise.all((undo.habitIds ?? []).map((id) => deleteHabit(id)));
      dataChanged("habits");
      return;
    case "mark_habit":
      await markHabit(proposal.habit_id, !proposal.done, today);
      dataChanged("habits");
      return;
    case "new_goal":
      await Promise.all((undo.habitIds ?? []).map((id) => deleteHabit(id)));
      // Удаление цели здесь это архив: так же поступает её страница.
      if (undo.goalId) await updateGoal(undo.goalId, { status: "archived" });
      dataChanged("habits");
      dataChanged("goals");
      return;
    case "goal_progress":
      await moveGoalProgress(proposal.goal_id, proposal.before);
      dataChanged("goals");
      return;
    case "new_topics": {
      const topicIds = undo.topicIds ?? [];
      const subjectIds = undo.subjectIds ?? [];
      await Promise.all(topicIds.map((id) => deleteTopic(id)));
      await Promise.all(subjectIds.map((id) => deleteSubject(id)));
      topicsChanged((list) => list.filter((row) => !topicIds.includes(row.id)));
      if (subjectIds.length) subjectsChanged((list) => list.filter((row) => !subjectIds.includes(row.id)));
      return;
    }
    case "mark_homework":
      await markHomeworkDone(proposal.week_start, proposal, !proposal.done);
      return;
    case "revision":
      await undoRevision(proposal.revision.id);
      invalidatePlan((item) => item.schedule === proposal.revision.schedule);
      return;
    case "commitments":
      await Promise.all((undo.commitmentIds ?? []).map((id) => deleteCommitment(id)));
      invalidatePlan();
      return;
    case "study_windows":
      return;
  }
}
