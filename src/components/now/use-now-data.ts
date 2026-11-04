"use client";

// Всё, что нужно главной: запросы — параллельно, лента — из того, что успело
// прийти.
//
// Каждый источник грузится и падает сам по себе. Если не ответил дневник,
// карточка шага всё равно показывается; если не ответил план — школа и
// домашнее задание остаются на месте, а на месте шага честно написано, что
// план не загрузился (CLAUDE.md §13.5: сбой одного источника не уничтожает
// экран и не выдаёт себя за «свободный день»).

import { useEffect, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";

import { useFullAccessDenied } from "@/components/full-access-gate";
import type {
  CoursePlan,
  CoursePlanSummary,
  CurriculumDocument,
  LearningGoal,
  StudyMaterial,
  SubjectChatSummary,
} from "@/lib/curriculum-api";
import { subjectTitle } from "@/lib/curriculum-catalog";
import {
  buildDay,
  homeworkOf,
  isOpenBlock,
  missedBlocks,
  nextSchoolDay,
  pendingRevisions,
  upcomingTests,
  weekStrip,
  type BusyEntry,
  type DayModel,
  type HomeworkItem,
  type UpcomingTest,
  type WeekDay,
} from "@/lib/now-feed";
import { dayKey } from "@/lib/pomodoro";
import { fetchSessions } from "@/lib/pomodoro-api";
import { useResource, type ResourceState } from "@/lib/resource-cache";
import type {
  CalendarLearningBlock,
  FixedCommitment,
  ScheduleRevision,
  StudySchedule,
} from "@/lib/studyplan-api";
import {
  shiftDateKey,
  weekDays,
  weekdayOf,
  zonedDateKey,
  zonedMinutes,
} from "@/lib/studyplan-calendar";
import { expandCommitments } from "@/lib/studyplan-calendar-entries";
import { browserTimeZone, useNow } from "@/lib/use-now";
import { usePomodoroStore } from "@/stores/pomodoro-store";
import type { DiaryLesson, DiaryWeek } from "@/types/diary";
import type { Topic } from "@/types/mind";

import {
  CHATS_KEY,
  COMMITMENTS_KEY,
  DOCUMENTS_KEY,
  GOALS_KEY,
  MATERIALS_KEY,
  PLANS_KEY,
  SCHEDULES_KEY,
  TTL,
  WEAK_TOPICS_KEY,
  blocksKey,
  diaryKey,
  fetchBlocks,
  fetchChats,
  fetchCommitments,
  fetchDiaryWeek,
  fetchDocuments,
  fetchGoals,
  fetchMaterials,
  fetchPlan,
  fetchPlans,
  fetchRevisions,
  fetchSchedules,
  fetchWeakTopics,
  planKey,
  revisionsKey,
  selectVisibleSchedules,
} from "./now-resources";

export interface NowData {
  now: Date | null;
  timeZone: string;
  today: string | null;
  /**
   * Закрытые для этого аккаунта разделы — план, темы, курсы — не грузятся и
   * не показываются (то же правило, что у `FullAccessGate`).
   */
  denied: boolean;
  /** Лента дня. `null`, пока план ещё грузится в первый раз. */
  day: DayModel | null;
  /** План не пришёл ни разу: лента построена без него. */
  planFailed: boolean;
  /** Дневник не пришёл ни разу. Упавшее фоновое обновление — не ошибка: данные на месте. */
  diaryError: string | null;
  reloadDiary: () => void;
  week: WeekDay[];
  /** Задания к следующему учебному дню, если они записаны. */
  homework: { dateKey: string; items: HomeworkItem[] } | null;
  tests: UpcomingTest[];
  missed: CalendarLearningBlock[];
  /** Первое занятие после сегодняшнего дня — для «на сегодня всё». */
  nextBlock: CalendarLearningBlock | null;
  revisions: ScheduleRevision[];
  topics: ResourceState<Topic[]>;
  goals: ResourceState<LearningGoal[]>;
  plans: ResourceState<CoursePlanSummary[]>;
  materials: ResourceState<StudyMaterial[]>;
  documents: ResourceState<CurriculumDocument[]>;
  chats: SubjectChatSummary[];
  schedules: StudySchedule[] | undefined;
  /** Программа текущего шага — ради ссылки на страницы учебника. */
  heroPlan: CoursePlan | undefined;
  /**
   * Время фокуса за сегодня, уже записанное на сервере, секунды. Идущую и
   * ещё не отправленную сессию досчитывает сама панель таймера — она и так
   * перерисовывается каждую секунду, а вся страница не должна.
   */
  focusLogged: number | null;
  /** Предмет (цель) программы — чтобы тьютор спрашивал по нужной книге. */
  goalOfPlan: (planId: string) => string | null;
  subjectOfGoal: (goalId: string | null) => string;
  reloadPlan: () => void;
}

function lessonsOf(week: DiaryWeek | undefined, date: string | null): DiaryLesson[] {
  return (date && week?.days?.find((day) => day.date === date)?.lessons) || [];
}

function busyFromCommitments(
  commitments: FixedCommitment[],
  today: string,
  timeZone: string,
  hasSchool: boolean,
): BusyEntry[] {
  return expandCommitments(commitments, [today], timeZone)
    // Школа уже есть из дневника — вторая «Школа» рядом с уроками лишняя.
    .filter((entry) => !(hasSchool && entry.commitment_kind === "school"))
    .map((entry) => {
      const start = zonedMinutes(entry.start_at, timeZone);
      return {
        id: entry.id,
        title: entry.title,
        kind: entry.commitment_kind,
        start,
        end: Math.min(start + entry.duration_minutes, 24 * 60),
      };
    });
}

export function useNowData(): NowData {
  const now = useNow(30_000);
  const timeZone = useMemo(browserTimeZone, []);
  const today = now ? zonedDateKey(now, timeZone) : null;
  const days = useMemo(() => (today ? weekDays(today) : []), [today]);
  const monday = days[0] ?? null;
  // С пятницы смотрим и следующую неделю дневника: в пятницу «Д/З на…» — это
  // понедельник, а СОР во вторник уже пора готовить.
  const nextMonday =
    today && monday && weekdayOf(today) >= 4 ? shiftDateKey(monday, 7) : null;

  const denied = useFullAccessDenied();
  const allowed = (key: string | null) => (denied ? null : key);

  const { data: session } = useSession();
  const email = session?.user?.email ?? null;

  const blocks = useResource(
    allowed(today ? blocksKey(timeZone, today) : null),
    () => fetchBlocks(timeZone, today ?? ""),
    { ttl: TTL.day },
  );
  const diary = useResource<DiaryWeek>(
    monday ? diaryKey(monday) : null,
    () => fetchDiaryWeek(monday ?? ""),
    { ttl: TTL.day },
  );
  const nextDiary = useResource<DiaryWeek>(
    nextMonday ? diaryKey(nextMonday) : null,
    () => fetchDiaryWeek(nextMonday ?? ""),
    { ttl: TTL.day },
  );
  const schedules = useResource(allowed(SCHEDULES_KEY), fetchSchedules, { ttl: TTL.day });
  const commitments = useResource(allowed(COMMITMENTS_KEY), fetchCommitments, {
    ttl: TTL.library,
  });
  const visibleIds = useMemo(
    () => selectVisibleSchedules(schedules.data ?? []).map((item) => item.id).sort(),
    [schedules.data],
  );
  const revisions = useResource(
    allowed(visibleIds.length ? revisionsKey(visibleIds) : null),
    () => fetchRevisions(visibleIds),
    { ttl: TTL.day },
  );
  const topics = useResource(allowed(WEAK_TOPICS_KEY), fetchWeakTopics, { ttl: TTL.day });
  const goals = useResource(allowed(GOALS_KEY), fetchGoals, { ttl: TTL.library });
  const plans = useResource(allowed(PLANS_KEY), fetchPlans, { ttl: TTL.library });
  const materials = useResource(allowed(MATERIALS_KEY), fetchMaterials, { ttl: TTL.library });
  const documents = useResource(allowed(DOCUMENTS_KEY), fetchDocuments, { ttl: TTL.library });
  const chats = useResource(CHATS_KEY, fetchChats, { ttl: TTL.day });
  const sessions = useResource(
    email && today ? `now:focus:${email}:${today}` : null,
    () => fetchSessions(2),
    { ttl: TTL.day },
  );

  // Отправленная сессия помодоро — повод перечитать записанное за день: иначе
  // «сегодня в фокусе» проседало бы на целую сессию до следующего захода.
  const syncedAt = usePomodoroStore((state) => state.syncedAt);
  const reloadSessions = sessions.reload;
  const firstSync = useRef(syncedAt);
  useEffect(() => {
    if (syncedAt === firstSync.current) return;
    reloadSessions();
  }, [syncedAt, reloadSessions]);

  const planLoaded = blocks.data !== undefined;
  const planFailed = !denied && !planLoaded && Boolean(blocks.error);

  const day = useMemo(() => {
    if (!now || !today) return null;
    // Пока план грузится в первый раз, решать, что сейчас, рано. Упавший план
    // не мешает: лента строится из дневника, а шаг заменяет карточка ошибки.
    if (!planLoaded && !planFailed && !denied) return null;
    const lessons = lessonsOf(diary.data, today);
    return buildDay({
      now,
      timeZone,
      lessons,
      blocks: blocks.data ?? [],
      busy: busyFromCommitments(commitments.data ?? [], today, timeZone, lessons.length > 0),
    });
  }, [now, today, timeZone, planLoaded, planFailed, denied, blocks.data, diary.data, commitments.data]);

  const diaryDays = useMemo(
    () => [...(diary.data?.days ?? []), ...(nextDiary.data?.days ?? [])],
    [diary.data, nextDiary.data],
  );

  const week = useMemo(() => {
    if (!today || !days.length || !planLoaded) return [];
    return weekStrip(days, blocks.data ?? [], diary.data?.days ?? [], today, timeZone);
  }, [today, days, planLoaded, blocks.data, diary.data, timeZone]);

  const homework = useMemo(() => {
    if (!today) return null;
    const school = nextSchoolDay(diaryDays, today);
    if (!school) return null;
    const items = homeworkOf(school.lessons);
    return items.length ? { dateKey: school.date, items } : null;
  }, [today, diaryDays]);

  const tests = useMemo(() => {
    if (!today || !day) return [];
    return upcomingTests(diaryDays, today, day.nowMinutes);
  }, [today, day, diaryDays]);

  const missed = useMemo(
    () => (today ? missedBlocks(blocks.data ?? [], today, timeZone) : []),
    [today, blocks.data, timeZone],
  );

  const nextBlock = useMemo(() => {
    if (!today) return null;
    return (
      (blocks.data ?? [])
        .filter((block) => isOpenBlock(block) && zonedDateKey(block.start_at, timeZone) > today)
        .sort((left, right) => Date.parse(left.start_at) - Date.parse(right.start_at))[0] ?? null
    );
  }, [today, blocks.data, timeZone]);

  // Предложение имеет смысл, только пока расписание не поменялось с тех пор,
  // как его составили: иначе «Принять» упадёт с «расписание изменилось». И
  // одно на расписание — самое свежее: старые помощник уже переиграл.
  //
  // Сервер уже отдаёт только открытые, но проверки остаются: расписания и
  // предложения кэшируются порознь, и версия может разойтись между запросами, а
  // Vercel и Railway выкатываются не одновременно — старый бэкенд параметр
  // проигнорирует и вернёт всю историю.
  const liveRevisions = useMemo(() => {
    const versions = new Map((schedules.data ?? []).map((item) => [item.id, item.version]));
    const seen = new Set<string>();
    return pendingRevisions(revisions.data ?? []).filter((revision) => {
      if (revision.base_version !== versions.get(revision.schedule)) return false;
      if (seen.has(revision.schedule)) return false;
      seen.add(revision.schedule);
      return true;
    });
  }, [schedules.data, revisions.data]);

  const heroPlanId = day?.hero?.block.course_plan ?? null;
  const heroPlan = useResource(
    allowed(heroPlanId ? planKey(heroPlanId) : null),
    () => fetchPlan(heroPlanId ?? ""),
    { ttl: TTL.library },
  );

  const focusLogged = useMemo(() => {
    if (!now || !sessions.data) return null;
    const todayKey = dayKey(now);
    return sessions.data
      .filter((row) => row.kind === "focus" && dayKey(new Date(row.started_at)) === todayKey)
      .reduce((total, row) => total + row.seconds, 0);
  }, [now, sessions.data]);

  const goalByPlan = useMemo(
    () => new Map((plans.data ?? []).map((plan) => [plan.id, plan.goal])),
    [plans.data],
  );
  const titleByGoal = useMemo(
    () => new Map((goals.data ?? []).map((goal) => [goal.id, subjectTitle(goal)])),
    [goals.data],
  );

  return {
    now,
    timeZone,
    today,
    denied,
    day,
    planFailed,
    diaryError: diary.data === undefined ? diary.error : null,
    reloadDiary: diary.reload,
    week,
    homework,
    tests,
    missed,
    nextBlock,
    revisions: liveRevisions,
    topics,
    goals,
    plans,
    materials,
    documents,
    chats: chats.data ?? [],
    schedules: schedules.data,
    heroPlan: heroPlan.data,
    focusLogged,
    goalOfPlan: (planId) => goalByPlan.get(planId) ?? null,
    subjectOfGoal: (goalId) => (goalId ? titleByGoal.get(goalId) ?? "" : ""),
    reloadPlan: () => {
      blocks.reload();
      schedules.reload();
      revisions.reload();
    },
  };
}
