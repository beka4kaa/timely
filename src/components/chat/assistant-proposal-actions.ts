"use client";

// Запись предложения помощника. Те же API и те же проверки, что у страниц: новых путей записи
// модель не получает. Сюда приходят только после нажатия «Применить».

import { markHomeworkDone } from "@/components/diary/use-diary-week";
import { TONES, isOpenGoal } from "@/components/goals/goal-logic";
import { createGoal, listGoals, moveGoalProgress, updateGoal } from "@/components/goals/goals-api";
import { localDay, nextHabitColor } from "@/components/habits/habit-days";
import { schedulePatch, scheduleOf } from "@/components/habits/habit-schedule";
import { createHabit, deleteHabit, listHabits, markHabit, updateHabit } from "@/components/habits/lib";
import { invalidatePlan } from "@/components/now/now-resources";
import { confirmGoal, deleteGoal } from "@/lib/curriculum-api";
import { dataChanged } from "@/lib/data-changed";
import { closedByRejecting } from "@/lib/now-feed";
import {
  applyQuickPlan,
  applyStudyWindows,
  cancelBlocks,
  confirmRevision,
  createCommitment,
  deleteCommitment,
  listTemplates,
  pinBlocks,
  rejectRevision,
  StudyplanApiError,
  undoQuickPlan,
  undoRevision,
} from "@/lib/studyplan-api";
import { findSubject, firstReviewFields, type WeakSubject, type WeakTopic } from "@/lib/weak-topics";
import {
  createSubject,
  createTopic,
  deleteSubject,
  deleteTopic,
  fetchSubjects,
  patchTopic,
  renameSubject,
  reviewTopic,
  subjectsChanged,
  topicsChanged,
} from "@/lib/weak-topics-api";

import type { AssistantProposal, BlockAction, ProposalUndo } from "./assistant-proposal";

/** Сервер объяснил отказ словами: показываем их, а не общую фразу. */
export function proposalFailureText(error: unknown, fallback: string): string {
  return error instanceof StudyplanApiError && error.status === 400 && error.code ? error.message : fallback;
}

const OPPOSITE: Record<BlockAction, BlockAction> = { cancel: "restore", restore: "cancel", pin: "unpin", unpin: "pin" };

async function changeBlocks(ids: string[], action: BlockAction): Promise<string[]> {
  const { changed } =
    action === "pin" || action === "unpin"
      ? await pinBlocks(ids, action === "pin")
      : await cancelBlocks(ids, { restore: action === "restore" });
  return changed;
}

/** Предмет живёт в двух местах: книги и календарь, дневник и темы. */
async function renameEverywhere(goalIds: string[], subjectIds: string[], name: string): Promise<void> {
  await Promise.all([
    ...goalIds.map((id) => confirmGoal(id, { normalized_subject: name })),
    ...subjectIds.map((id) => renameSubject(id, name)),
  ]);
  subjectsChanged();
  topicsChanged();
  dataChanged("subjects");
  invalidatePlan();
}

/** Записывает. Возвращает то, что нужно для «Вернуть как было». */
export async function applyProposal(proposal: AssistantProposal): Promise<ProposalUndo> {
  const today = localDay();
  switch (proposal.kind) {
    case "new_habit": {
      const taken = (await listHabits(today)).map((row) => row.color);
      const created = await createHabit(
        { name: proposal.name, color: nextHabitColor(taken), goal: proposal.goal_id, ...schedulePatch(scheduleOf(proposal)) },
        today,
      );
      dataChanged("habits");
      return { habitIds: [created.id] };
    }
    case "habit_schedule":
      await updateHabit(proposal.habit_id, schedulePatch(scheduleOf(proposal)), today);
      dataChanged("habits");
      return {};
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
    case "study_plan": {
      const applied = await applyQuickPlan({
        subject: proposal.subject,
        goal_id: proposal.goal_id,
        weekdays: proposal.weekdays,
        start_time: proposal.start_time,
        minutes: proposal.minutes,
        from_date: proposal.from_date,
        to_date: proposal.to_date,
        timezone: proposal.timezone,
        expected_sessions: proposal.sessions,
        expected_path: proposal.path,
        key: proposal.id,
      });
      invalidatePlan();
      dataChanged("subjects");
      return { quickPlan: applied.undo };
    }
    case "block_changes": {
      const changed = await changeBlocks(proposal.block_ids, proposal.action);
      if (!changed.length) throw new StudyplanApiError("Занятия уже поменялись.", 409, "stale_revision");
      invalidatePlan();
      return { blockIds: changed };
    }
    case "commitment_removal":
      await Promise.all(proposal.items.map((item) => deleteCommitment(item.id)));
      invalidatePlan();
      return {};
    case "goal_change":
      await updateGoal(proposal.goal_id, proposal.fields);
      dataChanged("goals");
      return {};
    case "habit_change":
      if (proposal.delete) await deleteHabit(proposal.habit_id);
      else await updateHabit(proposal.habit_id, proposal.fields, today);
      dataChanged("habits");
      return {};
    case "topic_change":
      if (proposal.delete) await deleteTopic(proposal.topic_id);
      else if (proposal.reviewed) await reviewTopic(proposal.topic_id, "GOOD");
      else await patchTopic(proposal.topic_id, proposal.fields as Partial<WeakTopic>);
      topicsChanged();
      return {};
    case "subject_change":
      if (!proposal.delete) {
        await renameEverywhere(proposal.goal_ids, proposal.subject_ids, proposal.new_name ?? proposal.name);
        return {};
      }
      await Promise.all([
        ...proposal.goal_ids.map((id) => deleteGoal(id)),
        ...proposal.subject_ids.map((id) => deleteSubject(id)),
      ]);
      subjectsChanged();
      topicsChanged();
      dataChanged("subjects");
      invalidatePlan();
      return {};
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
    case "habit_schedule":
      await updateHabit(proposal.habit_id, proposal.before, today);
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
    case "study_plan":
      await undoQuickPlan(undo.quickPlan ?? {});
      invalidatePlan();
      dataChanged("subjects");
      return;
    case "block_changes":
      await changeBlocks(undo.blockIds ?? proposal.block_ids, OPPOSITE[proposal.action]);
      invalidatePlan();
      return;
    case "commitment_removal":
      for (const item of proposal.items) {
        await createCommitment(
          {
            title: item.title,
            kind: item.kind,
            weekday: item.weekday ?? undefined,
            start_time: item.start_time ?? undefined,
            duration_minutes: item.duration_minutes,
            valid_from: item.valid_from ?? null,
            valid_until: item.valid_until ?? null,
            start_at: item.start_at ?? undefined,
            end_at: item.end_at ?? undefined,
          },
          "chat",
        );
      }
      invalidatePlan();
      return;
    case "goal_change":
      await updateGoal(proposal.goal_id, proposal.before);
      // Главная цель одна: сервер снял её с прежней, и отмена должна вернуть.
      if (proposal.fields.isMain && proposal.previous_main_id) {
        await updateGoal(proposal.previous_main_id, { isMain: true });
      }
      dataChanged("goals");
      return;
    case "habit_change":
      await updateHabit(proposal.habit_id, proposal.before, today);
      dataChanged("habits");
      return;
    case "topic_change":
      await patchTopic(proposal.topic_id, proposal.before as Partial<WeakTopic>);
      topicsChanged();
      return;
    case "subject_change":
      await renameEverywhere(proposal.goal_ids, proposal.subject_ids, proposal.name);
      return;
  }
}
