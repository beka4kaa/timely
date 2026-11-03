"use client";

// Главная «Сейчас» (CLAUDE.md §16): один следующий шаг на фоне всего дня.
//
// Слева — лента дня: школа, занятия плана, занятое время и домашнее задание
// на одной оси времени. Справа — тьютор, который знает текущий шаг, и то,
// что пора подтянуть. Неделя — в шапке, если там есть место, иначе над лентой.

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";

import { usePageSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { daySummary, splitBlockTitle } from "@/lib/now-feed";

import { DayFeed } from "./day-feed";
import { NowCard, QuietCard, type QuietKind } from "./now-card";
import styles from "./now.module.css";
import { CoursesCard, TutorCard, WeakTopicsCard } from "./side-cards";
import { useNowData } from "./use-now-data";
import { WeekStrip } from "./week-strip";

export function NowPage() {
  const data = useNowData();
  const router = useRouter();
  const { prompt } = useAskRail();
  const { headerSlot } = useDashboardShell();

  const hero = data.day?.hero ?? null;
  const heroGoal = hero ? data.goalOfPlan(hero.block.course_plan) : null;
  // Панель тьютора открывается на предмете текущего шага: «Нужна помощь» не
  // должна спрашивать, о какой книге речь. Идущий в панели разговор этим не
  // перебивается — панель сменит предмет, только когда она пуста.
  usePageSubject(heroGoal);

  const latestChat = [...data.chats].sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
  )[0];
  const tutorGoal = heroGoal ?? latestChat?.goal ?? null;

  if (!data.now || !data.today) {
    return (
      <div className={styles.root}>
        <h1 className={styles.srOnly}>Сейчас</h1>
        <div className={styles.wrap} aria-busy="true" />
      </div>
    );
  }

  const { now, today, timeZone, day, denied } = data;

  let quiet: QuietKind | null = null;
  if (denied) quiet = "denied";
  else if (data.planFailed) quiet = "error";
  else if (!day) quiet = "loading";
  else if (!day.hero) {
    if (day.blocks.length) quiet = "done";
    else if (data.plans.data && data.plans.data.length === 0) quiet = "no-plans";
    else if (data.schedules && data.schedules.length === 0) quiet = "no-schedule";
    else quiet = "free-day";
  }

  const heroNode =
    hero && quiet === null ? (
      <NowCard
        hero={hero}
        goalId={heroGoal}
        plan={data.heroPlan}
        documents={data.documents.data ?? []}
        focusLogged={data.focusLogged}
      />
    ) : (
      <QuietCard
        kind={quiet ?? "loading"}
        onRetry={data.reloadPlan}
        done={day?.blocks.length}
        next={data.nextBlock}
        busyDay={Boolean(
          day && (day.school || day.past.length || day.current.length || day.future.length),
        )}
        hasTopics={Boolean(data.topics.data?.length)}
        timeZone={timeZone}
        today={today}
      />
    );

  const summary = day && !data.planFailed && !denied ? daySummary(day) : null;

  const editPlan = () => {
    router.push("/dashboard/plan");
    prompt({ target: "schedule" });
  };

  return (
    <div className={styles.root}>
      <h1 className={styles.srOnly}>Сейчас</h1>
      {headerSlot && data.week.length
        ? createPortal(<WeekStrip days={data.week} compact />, headerSlot)
        : null}

      <div className={styles.wrap}>
        <div className={styles.grid}>
          <section className={styles.feedCol} aria-label="День">
            <div className={styles.weekInline}>
              <WeekStrip days={data.week} />
            </div>

            <div className={styles.dayHead}>
              {summary ? (
                <p className={styles.daySum}>
                  {summary.lead} <b>{summary.total}</b>
                  {summary.tail}
                </p>
              ) : data.planFailed ? (
                <p className={styles.daySum}>Плана пока не видно — ниже то, что есть в дневнике.</p>
              ) : denied ? (
                <p className={styles.daySum}>Сегодня — по дневнику.</p>
              ) : (
                <span className={styles.skel} style={{ width: 320, maxWidth: "70%", height: 18 }} />
              )}
              {!denied ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnLight} ${styles.btnSm}`}
                  onClick={editPlan}
                >
                  <Pencil aria-hidden="true" />
                  <span className={styles.btnLabel}>Изменить план</span>
                </button>
              ) : null}
            </div>

            {data.diaryError ? (
              <p className={styles.error} role="status">
                Дневник сейчас не отвечает — уроки и домашнее задание появятся, когда он
                ответит.
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnLight} ${styles.btnSm}`}
                  onClick={data.reloadDiary}
                >
                  Повторить
                </button>
              </p>
            ) : null}

            <DayFeed
              day={day}
              now={now}
              today={today}
              timeZone={timeZone}
              hero={heroNode}
              // Без плана предложения его поменять повисают в воздухе: что
              // именно они двигают, не видно.
              revisions={denied || data.planFailed ? [] : data.revisions}
              homework={data.homework}
              missed={denied || data.planFailed ? [] : data.missed}
              tests={data.tests}
            />
          </section>

          <aside className={styles.side} aria-label="Тьютор, темы и курсы">
            <TutorCard
              goalId={denied ? null : tutorGoal}
              subject={data.subjectOfGoal(tutorGoal)}
              topic={hero ? splitBlockTitle(hero.block.title).topic : null}
              chats={data.chats}
              subjects={{
                count: data.goals.data?.length ?? 0,
                loaded: !denied && data.goals.data !== undefined,
              }}
              now={now}
              timeZone={timeZone}
            />
            {!denied ? (
              <>
                <WeakTopicsCard
                  topics={data.topics}
                  tests={data.tests}
                  today={today}
                  timeZone={timeZone}
                />
                <CoursesCard
                  plans={data.plans}
                  materials={data.materials}
                  documents={data.documents}
                  subjectOfGoal={data.subjectOfGoal}
                  today={today}
                />
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
