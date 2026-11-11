// Страница курса: путь по главам, список уроков, срок и источник.
//
// Вопрос ученика здесь один: жить ли по этой программе три месяца, и все его части (когда
// закончу, успею ли к сроку, что дальше) лежат во времени. Поэтому сверху ритм и финиш
// словами, под ними путь, а покрытие книги осталось строкой у источника: это метрика
// качества генератора, а не то, чем живёт ученик.
//
// Состояние подсветки живёт здесь, а не в контексте: связаны ровно две половины экрана, и
// передать им пару `{hoveredTopicId, onHoverTopic}` дешевле, чем заводить провайдер.

"use client";


import Link from "next/link";
import { useMemo, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { usePageSubject } from "@/contexts/active-subject";
import { useAskRail } from "@/contexts/ask-rail";
import type { CoursePlan } from "@/lib/curriculum-api";
import { coverAuthor, coverClass, coverTitle } from "@/lib/curriculum-cover";
import { SECTION_LABEL } from "@/lib/curriculum-books";
import { isCourseDone, locateInCourse } from "@/lib/curriculum-course-progress";
import {
  courseLede,
  dayMonth,
  forecastWarningMessage,
  formatPlanDate,
  paceAdvice,
  parseForecast,
} from "@/lib/curriculum-forecast";
import { buildCoursePath } from "@/lib/curriculum-path";
import { buildRibbon, coverageCaption, gapsCaption } from "@/lib/curriculum-ribbon";

import { kindLabel } from "./add-source.logic";
import { PlanActions } from "./plan-actions";
import { PlanModules } from "./plan-modules";
import { PlanPaceForm } from "./plan-pace";
import { PlanPath } from "./plan-path";
import { PlanPageError, PlanPageSkeleton } from "./plan-states";
import { PlanStructureEditor } from "./plan-structure-editor";
import {
  type PlanPageReady,
  useApprovePlan,
  useGenerationContext,
  usePlanPageData,
} from "./use-plan-page-data";

export function CurriculumPlanPage({ planId }: { planId: string }) {
  const { data, reload, setPlan, setDeadline } = usePlanPageData(planId);

  if (data.state === "loading") return <PlanPageSkeleton />;
  if (data.state === "error") {
    return <PlanPageError kind={data.kind} message={data.message} onRetry={reload} />;
  }

  return <PlanPageBody planId={planId} data={data} onPlanChange={setPlan} onDeadlineChange={setDeadline} />;
}

function PlanPageBody({
  planId,
  data,
  onPlanChange,
  onDeadlineChange,
}: {
  planId: string;
  data: PlanPageReady;
  onPlanChange: (plan: CoursePlan) => void;
  onDeadlineChange: (date: string | null) => void;
}) {
  const { plan, document: book, material, goal, sections, degraded, progress, progressFailed, siblings } =
    data;
  const [hoveredTopicId, setHoveredTopicId] = useState<string | null>(null);
  const [pacing, setPacing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Мини-окно спрашивает по той книге, которая открыта.
  const goalId = goal?.id ?? plan.goal;
  usePageSubject(goalId);
  const { prompt } = useAskRail();
  const ask = (text: string) => prompt({ target: "book", goalId, text });

  // `fromGeneration` здесь не нужен: перестройка это действие сервера и доступна с любой
  // страницы программы, а не только сразу после мастера.
  const { reviewFindings } = useGenerationContext(planId);
  const { approve, busy, error } = useApprovePlan(planId, onPlanChange);

  const ribbon = useMemo(
    () =>
      buildRibbon({
        pageCount: book?.page_count ?? 0,
        topics: plan.modules.flatMap((courseModule, moduleIndex) =>
          courseModule.topics.map((topic) => ({
            id: topic.id,
            moduleIndex,
            sources: topic.sources ?? [],
          })),
        ),
        sections,
      }),
    [plan, book, sections],
  );

  const moduleMinutes = useMemo(
    () =>
      plan.modules.map((courseModule) => ({
        id: courseModule.id,
        title: courseModule.title,
        numberLabel: courseModule.number_label,
        // Своё поле модуля, при нуле сумма тем: так же считает строка главы в списке.
        minutes:
          courseModule.estimated_minutes ||
          courseModule.topics.reduce((sum, topic) => sum + (topic.estimated_minutes || 0), 0),
      })),
    [plan],
  );

  const states = useMemo(
    () =>
      locateInCourse(
        plan.modules.map((courseModule, index) => ({
          id: courseModule.id,
          minutes: moduleMinutes[index].minutes,
          topics: courseModule.topics,
        })),
        progress?.progress ?? null,
      ),
    [plan, moduleMinutes, progress],
  );

  // Путь строится из длительностей глав и дат бэкенда. Своего календаря здесь нет намеренно:
  // два несогласных прогноза на одном экране хуже одного.
  const forecast = useMemo(() => parseForecast(plan.forecast), [plan.forecast]);
  const path = useMemo(
    () =>
      buildCoursePath({
        modules: moduleMinutes,
        milestones: plan.milestones.map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          moduleId: milestone.module,
        })),
        today: new Date(),
        startedAt: progress?.schedule.start_date ?? null,
        expectedFinish: forecast?.estimatedFinishDate ?? plan.forecast_finish_date,
        optimisticFinish: forecast?.optimisticFinishDate ?? null,
        realisticFinish: forecast?.realisticFinishDate ?? null,
        deadline: goal?.desired_finish_date ?? null,
      }),
    [plan, moduleMinutes, forecast, goal, progress],
  );

  /** Какая глава подсвечена на пути: наводят-то на строку темы. */
  const hoveredModuleId = useMemo(() => {
    if (!hoveredTopicId) return null;
    for (const courseModule of plan.modules) {
      if (courseModule.topics.some((topic) => topic.id === hoveredTopicId)) return courseModule.id;
    }
    return null;
  }, [plan, hoveredTopicId]);

  const coverage = useMemo(() => {
    if (ribbon.unitCount === 0) return "";
    const gaps = gapsCaption(ribbon);
    return [`${coverageCaption(ribbon)}.`, gaps ? `${gaps}.` : ""].filter(Boolean).join(" ");
  }, [ribbon]);

  const blockers = reviewFindings.filter((finding) => finding.severity === "blocker");
  const allTopicsCount = plan.modules.reduce((sum, item) => sum + item.topics.length, 0);
  // У программы по источнику без файла страниц нет и быть не может. Без этой проверки
  // страница жаловалась бы на поломку там, где всё работает как задумано.
  const everythingUnsourced =
    Boolean(plan.document) && allTopicsCount > 0 && ribbon.unsourcedTopicIds.length === allTopicsCount;
  const sourceDeleted = !plan.document && !plan.material;

  // Все темы пройдены: прогноз больше ничего не значит.
  const courseDone = isCourseDone(allTopicsCount, states, progress?.progress ?? null);
  const lede = courseDone
    ? "Курс пройден."
    : courseLede(forecast, {
        sessionsPerWeek: plan.recommended_sessions_per_week,
        minutesPerSession: plan.recommended_session_minutes,
        finishDate: plan.forecast_finish_date,
      });

  const deadlineIso = goal?.desired_finish_date ?? null;
  const feasible = forecast?.desiredDeadlineFeasible ?? null;
  const advice = forecast ? paceAdvice(forecast, deadlineIso) : null;
  const sourceTitle = book ? coverTitle(book.title) : (material?.title ?? "");
  const canEdit = plan.status !== "active" && plan.status !== "archived";
  const siblingIndex = siblings.findIndex((item) => item.id === plan.id);

  return (
    <div className="content view cur-page">
      <Link className="back" href="/dashboard/curriculum">
        {SECTION_LABEL}
      </Link>

      <header className="head">
        <h1 className="title">{plan.title}</h1>
        <div className="head-tools">
          {siblings.length > 1 && siblingIndex >= 0 ? (
            <nav className="pager" aria-label="Другие курсы предмета">
              <Link
                className="icon-btn"
                aria-label="Предыдущий курс"
                href={`/dashboard/curriculum/plan/${siblings[(siblingIndex - 1 + siblings.length) % siblings.length].id}`}
              >
                <Icon name="chev-l" />
              </Link>
              <span>
                {siblingIndex + 1} из {siblings.length}
              </span>
              <Link
                className="icon-btn"
                aria-label="Следующий курс"
                href={`/dashboard/curriculum/plan/${siblings[(siblingIndex + 1) % siblings.length].id}`}
              >
                <Icon name="chev-r" />
              </Link>
            </nav>
          ) : null}
          <PlanActions
            plan={plan}
            approving={busy}
            onApprove={() => void approve()}
            onEditPace={() => setPacing((value) => !value)}
            onEditStructure={() => setEditing(true)}
            onError={setActionError}
          />
        </div>
      </header>

      {lede ? (
        <p className="lede">{lede}</p>
      ) : (
        <p className="lede">Ритм занятий не задан, без него календарь не построить.</p>
      )}

      {plan.objective && plan.objective !== plan.title ? (
        <p className="course-goal">{plan.objective}</p>
      ) : null}

      {error ? (
        <p className="cur-alert is-bad" role="alert">
          {error}
        </p>
      ) : null}
      {actionError ? (
        <p className="cur-alert is-bad" role="alert">
          {actionError}
        </p>
      ) : null}

      {plan.status === "archived" ? (
        <p className="cur-alert">Это прежняя версия программы, её заменила более новая.</p>
      ) : null}
      {plan.status === "rejected" ? (
        <p className="cur-alert is-bad">
          Эту программу забраковала проверка, поэтому начать по ней занятия нельзя. Построй её заново:
          учебник и цель сохранены.
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <div className="cur-alert is-bad">
          <div>
            Проверка оставила замечания
            <ul className="cur-alert-list">
              {blockers.map((finding, index) => (
                <li key={`${finding.kind}-${index}`}>{finding.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {degraded ? (
        <p className="cur-alert">Учебник не загрузился, поэтому страницы книги недоступны. Сама программа показана полностью.</p>
      ) : null}
      {sourceDeleted ? (
        <p className="cur-alert">Источник этой программы удалён, поэтому ссылок на страницы нет.</p>
      ) : null}

      {pacing ? (
        <PlanPaceForm
          plan={plan}
          goal={goal}
          onPlanChange={onPlanChange}
          onDeadlineChange={onDeadlineChange}
          onClose={() => setPacing(false)}
        />
      ) : null}

      {path ? <PlanPath path={path} states={states} hoveredModuleId={hoveredModuleId} /> : null}

      <CourseNotes
        deadline={deadlineIso}
        feasible={feasible}
        advice={advice}
        milestones={path?.milestones ?? []}
        warnings={forecast?.warnings ?? []}
        noSchedule={plan.status === "active" && !progress && !progressFailed}
      />

      {book || material ? (
        <div
          className="src-book course-src"
          data-attach={`${book ? "Книга" : kindLabel(material?.kind ?? "custom")} «${sourceTitle}»`}
        >
          <span className={`book mini ${coverClass(goal?.normalized_subject || sourceTitle)}`} aria-hidden="true" />
          <span>
            {material?.url ? (
              <a className="link" href={material.url} target="_blank" rel="noreferrer noopener">
                {sourceTitle}
              </a>
            ) : (
              sourceTitle
            )}
            <small>
              {book
                ? [coverAuthor(book.authors), book.page_count > 0 ? `${book.page_count} стр.` : ""]
                    .filter(Boolean)
                    .join(", ")
                : material
                  ? `${kindLabel(material.kind)}, пройдено ${material.completed_units} из ${material.total_units} ${material.units_word}`
                  : ""}
            </small>
            {coverage ? <small>{coverage}</small> : null}
          </span>
        </div>
      ) : null}

      {everythingUnsourced ? (
        <p className="cur-alert">
          Ни одна тема не сослалась на страницы учебника: программа построена по смыслу, а не по разделам
          книги.
        </p>
      ) : null}

      {editing && canEdit ? (
        <PlanStructureEditor plan={plan} onPlanChange={onPlanChange} onClose={() => setEditing(false)} />
      ) : plan.modules.length > 0 ? (
        <PlanModules
          plan={plan}
          states={states}
          sourceTitle={sourceTitle}
          onHoverTopic={setHoveredTopicId}
          onAsk={ask}
        />
      ) : (
        <p className="cur-alert">В программе пока нет ни одной главы. Построй её заново.</p>
      )}

      {plan.created_at ? (
        <p className="course-foot">Программа построена {formatPlanDate(plan.created_at)}</p>
      ) : null}
    </div>
  );
}

/** «5» → «глава 5», а напечатанное в книге «Глава 5» остаётся как есть. */
function chapterWord(label: string): string {
  return /^\d/.test(label) ? `глава ${label}` : label;
}

function CourseNotes({
  deadline,
  feasible,
  advice,
  milestones,
  warnings,
  noSchedule,
}: {
  deadline: string | null;
  feasible: boolean | null;
  advice: string | null;
  milestones: { id: string; title: string; moduleLabel: string }[];
  warnings: string[];
  noSchedule: boolean;
}) {
  // Срок обсуждается, только если его задавали: `null` здесь это «не спрашивали», а не
  // «не успеешь».
  const lines = [
    feasible === true && deadline ? (
      <li key="deadline">Успеваешь к сроку: {dayMonth(deadline)}.</li>
    ) : null,
    feasible === false && deadline ? (
      <li key="deadline" className="is-bad">
        К {dayMonth(deadline)} при таком темпе не выходит.{advice ? ` ${advice}` : ""}
      </li>
    ) : null,
    ...milestones.map((milestone) => (
      <li key={milestone.id}>
        Веха: {milestone.title}
        {milestone.moduleLabel ? `, ${chapterWord(milestone.moduleLabel)}` : ""}.
      </li>
    )),
    ...warnings.map((code) => <li key={code}>{forecastWarningMessage(code)}</li>),
    noSchedule ? (
      <li key="no-schedule">
        Расписания пока нет, поэтому прогресс не растёт.{" "}
        <Link className="link" href="/dashboard/plan">
          Разложить по дням
        </Link>
      </li>
    ) : null,
  ].filter(Boolean);

  return lines.length > 0 ? <ul className="course-notes">{lines}</ul> : null;
}
