// «Что изучаю»: предметы ученика и настоящий прогресс по ним.
//
// Отдельного эндпоинта нет: предмет, программа, расписание и занятия приходят из своих
// списков, как в каталоге библиотеки. Процент считается там же, где и в каталоге
// (`curriculum-course-progress`), поэтому в двух местах он один и тот же.

import {
  type CoursePlanSummary,
  type LearningGoal,
  type StudyMaterial,
  listGoals,
  listMaterials,
  listPlans,
} from "@/lib/curriculum-api";
import { subjectTitle } from "@/lib/curriculum-catalog";
import { percentOf, pickProgressSchedule, programMinutesOf, summarizeProgress } from "@/lib/curriculum-course-progress";
import { type LearningBlock, listBlocks, listSchedules } from "@/lib/studyplan-api";

export interface Lesson {
  id: string;
  subject: string;
  /** Что сейчас: следующая тема, иначе направление, иначе подсказка. */
  line: string;
  due: string | null;
  /** `null`: считать ещё не по чему. Ноль и «неизвестно» это разные вещи. */
  percent: number | null;
  href: string;
  /** Следующее занятие, если оно есть в расписании. */
  next: { title: string; startAt: string } | null;
}

const PLAN_ORDER: Partial<Record<CoursePlanSummary["status"], number>> = {
  active: 0,
  awaiting_approval: 1,
  reviewing: 2,
  draft: 3,
};

const FINISHED_BLOCKS = new Set([
  "completed",
  "partially_completed",
  "cancelled",
  "rescheduled",
  "skipped",
  "missed",
]);

/** Программа, по которой идёт предмет: действующая, иначе самая свежая из живых. */
function currentPlan(goalId: string, plans: readonly CoursePlanSummary[]): CoursePlanSummary | null {
  let best: CoursePlanSummary | null = null;
  for (const plan of plans) {
    if (plan.goal !== goalId) continue;
    const rank = PLAN_ORDER[plan.status];
    if (rank === undefined) continue;
    const bestRank = best ? PLAN_ORDER[best.status] ?? 9 : 9;
    if (!best || rank < bestRank || (rank === bestRank && plan.created_at > best.created_at)) best = plan;
  }
  return best;
}

function materialPercent(goalId: string, materials: readonly StudyMaterial[]): number | null {
  const rows = materials.filter((row) => row.goal === goalId && row.total_units > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.total_units, 0);
  const done = rows.reduce((sum, row) => sum + Math.min(row.completed_units, row.total_units), 0);
  return percentOf(done, total);
}

function nextBlock(blocks: readonly LearningBlock[], now: number): LearningBlock | null {
  let best: LearningBlock | null = null;
  for (const block of blocks) {
    if (FINISHED_BLOCKS.has(block.status)) continue;
    if (new Date(block.end_at).getTime() < now) continue;
    if (!best || block.start_at < best.start_at) best = block;
  }
  return best;
}

export async function loadLessons(): Promise<Lesson[]> {
  const [goals, plans, materials, schedules] = await Promise.all([
    listGoals(),
    listPlans(),
    listMaterials().catch(() => [] as StudyMaterial[]),
    // Без расписаний предметы всё равно показываем, только без процентов.
    listSchedules().catch(() => []),
  ]);
  const now = Date.now();

  const open = goals.filter((goal: LearningGoal) => goal.status !== "archived");
  return Promise.all(
    open.map(async (goal): Promise<Lesson> => {
      const plan = currentPlan(goal.id, plans);
      const schedule = plan
        ? pickProgressSchedule(schedules.filter((row) => row.course_plan === plan.id))
        : null;
      // Один упавший курс не должен гасить проценты у остальных.
      const blocks = schedule ? await listBlocks(schedule.id).catch(() => null) : null;
      const percent = blocks
        ? summarizeProgress(blocks, schedule ? programMinutesOf(schedule, plan) : 0).percent
        : materialPercent(goal.id, materials);
      const next = blocks ? nextBlock(blocks, now) : null;
      const direction = goal.normalized_direction?.trim();
      return {
        id: goal.id,
        subject: subjectTitle(goal),
        line: next?.title || direction || plan?.title || "Программы пока нет",
        due: goal.desired_finish_date || plan?.forecast_finish_date || null,
        percent,
        href: plan ? `/dashboard/curriculum/plan/${plan.id}` : "/dashboard/curriculum",
        next: next ? { title: next.title, startAt: next.start_at } : null,
      };
    }),
  );
}
