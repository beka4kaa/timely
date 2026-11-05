"use client";

// Главная «Сейчас» (CLAUDE.md §16): один следующий шаг на фоне всего дня.
//
// Слева лента дня шагами, на месте идущего дела стеклянная карточка. Справа
// стопка карточек о том, что впереди. Неделя в заголовке страницы и ведёт на план.

import { useRouter } from "next/navigation";

import { usePageSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import { daySummary, longDateLabel } from "@/lib/now-feed";
import { formatMinutes } from "@/lib/studyplan-calendar";

import { DayFeed } from "./day-feed";
import { NowCard, QuietCard, type QuietKind } from "./now-card";
import { ContestTile, HomeworkTile, TestTile, WeakTile } from "./side-cards";
import { useNowData } from "./use-now-data";
import { WeekStrip } from "./week-strip";

export function NowPage() {
  const data = useNowData();
  const router = useRouter();
  const { prompt } = useAskRail();

  const hero = data.day?.hero ?? null;
  const heroGoal = hero ? data.goalOfPlan(hero.block.course_plan) : null;
  // Мини-окно открывается на предмете текущего шага: «Нужна помощь» не должна
  // спрашивать, о какой книге речь. Идущий там разговор этим не перебивается:
  // окно сменит предмет, только когда оно пусто.
  usePageSubject(heroGoal);

  if (!data.now || !data.today) {
    return (
      <div className="content view" aria-busy="true">
        <header className="head">
          <h1 className="sr-only">Сейчас</h1>
          <span className="now-skel is-title" aria-hidden="true" />
          <span className="now-skel is-week" aria-hidden="true" />
        </header>
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
        dateKey={today}
        goalId={heroGoal}
        plan={data.heroPlan}
        documents={data.documents.data ?? []}
        focusLogged={data.focusLogged}
      />
    ) : (
      <QuietCard
        kind={quiet ?? "loading"}
        nowLabel={formatMinutes(day?.nowMinutes ?? now.getHours() * 60 + now.getMinutes())}
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

  const summary = day?.blocks.length && !data.planFailed && !denied ? daySummary(day) : null;
  // Менять нечего, пока плана нет, а там, где его только предстоит собрать,
  // главная кнопка и так ведёт туда же.
  const canEditPlan =
    quiet !== "denied" &&
    quiet !== "error" &&
    quiet !== "loading" &&
    quiet !== "no-plans" &&
    quiet !== "no-schedule";

  const editPlan = () => {
    router.push("/dashboard/plan");
    prompt({ target: "schedule" });
  };

  // У аккаунта без доступа к плану темы закрыты, и рядом может не быть ничего.
  const hasSide = !denied || data.tests.length > 0 || Boolean(data.homework);

  return (
    <div className="content view">
      <header className="head">
        <h1 className="title">{longDateLabel(today)}</h1>
        <WeekStrip days={data.week} />
      </header>

      <div className={hasSide ? "home" : "home no-side"}>
        <div>
          <DayFeed
            day={day}
            today={today}
            timeZone={timeZone}
            hero={heroNode}
            // Без плана предложения его поменять повисают в воздухе: что именно они
            // двигают, не видно.
            revisions={denied || data.planFailed ? [] : data.revisions}
            missed={denied || data.planFailed ? [] : data.missed}
          />

          {data.diaryError ? (
            <div className="late-line" role="status">
              <p>Дневник сейчас не отвечает. Уроки и задания появятся, когда он ответит.</p>
              <span className="late-acts">
                <button type="button" className="btn btn-text" onClick={data.reloadDiary}>
                  Повторить
                </button>
              </span>
            </div>
          ) : null}

          {canEditPlan ? (
            <div className="late-line day-foot">
              {summary ? (
                <p>
                  {summary.lead} {summary.total}
                </p>
              ) : null}
              <span className="late-acts">
                <button type="button" className="btn btn-text" onClick={editPlan}>
                  Изменить план
                </button>
              </span>
            </div>
          ) : null}
        </div>

        {hasSide ? (
          <aside className="side" aria-label="Что впереди">
            <TestTile tests={data.tests} topics={data.topics.data ?? []} today={today} />
            {!denied ? <ContestTile contest={data.contest} today={today} /> : null}
            <HomeworkTile homework={data.homework} today={today} />
            {!denied ? <WeakTile topics={data.topics} today={today} timeZone={timeZone} /> : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
