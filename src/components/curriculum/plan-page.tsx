// Страница программы: корешок книги, модули и сроки.
//
// Состояние подсветки живёт здесь, а не в контексте: связаны ровно две
// половины экрана, и передать им пару `{hoveredTopicId, onHoverTopic}` дешевле
// и понятнее, чем заводить провайдер.

"use client";

import { usePageSubject } from "@/contexts/active-subject";
import { useMemo, useState } from "react";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import { buildRibbon } from "@/lib/curriculum-ribbon";
import { cleanDocumentTitle } from "@/lib/curriculum-title";
import { PlanActions } from "./plan-actions";
import { PlanForecastRail } from "./plan-forecast-rail";
import { PlanModules } from "./plan-modules";
import { PlanRibbon } from "./plan-ribbon";
import { PlanPageError, PlanPageSkeleton } from "./plan-states";
import { paperCaption, paperCard } from "./paper";
import {
  useApprovePlan,
  useGenerationContext,
  usePlanPageData,
} from "./use-plan-page-data";

export function CurriculumPlanPage({ planId }: { planId: string }) {
  const { data, reload, setPlan } = usePlanPageData(planId);

  if (data.state === "loading") return <PlanPageSkeleton />;
  if (data.state === "error") {
    return <PlanPageError kind={data.kind} message={data.message} onRetry={reload} />;
  }

  return <PlanPageBody planId={planId} data={data} onPlanChange={setPlan} />;
}

function PlanPageBody({
  planId,
  data,
  onPlanChange,
}: {
  planId: string;
  data: Extract<ReturnType<typeof usePlanPageData>["data"], { state: "ready" }>;
  onPlanChange: (plan: import("@/lib/curriculum-api").CoursePlan) => void;
}) {
  const { plan, document: book, goal, sections, degraded } = data;
  const [hoveredTopicId, setHoveredTopicId] = useState<string | null>(null);
  // Панель вопросов справа спрашивает по той книге, которая открыта.
  usePageSubject(goal?.id ?? plan.goal);

  // `fromGeneration` здесь больше не нужен: перестройка стала действием
  // сервера и доступна с любой страницы программы, а не только сразу после
  // мастера.
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

  const blockers = reviewFindings.filter((finding) => finding.severity === "blocker");
  const allTopicsCount = plan.modules.reduce(
    (sum, courseModule) => sum + courseModule.topics.length,
    0,
  );
  const everythingUnsourced =
    allTopicsCount > 0 && ribbon.unsourcedTopicIds.length === allTopicsCount;

  return (
    <CoffeePageShell>
      {/* Название программы — это СОДЕРЖАНИЕ страницы, а не её подпись, и
          поэтому оно живёт здесь, а не в оболочке. Верхняя панель приложения
          печатает статичное «Программа», одинаковое для всех курсов; какой
          именно курс открыт, отвечает только эта строка. */}
      <header className="mb-7 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-[#ded8ce] pb-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[26px] leading-tight tracking-[-0.02em] text-[#302b26] sm:text-[30px]">
            {plan.title}
          </h1>
          {plan.objective ? (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-[#7f776e]">
              {plan.objective}
            </p>
          ) : null}
        </div>

        {book && (
          <div className="shrink-0 text-right">
            <p className={paperCaption}>Учебник</p>
            <p
              className="mt-0.5 max-w-[240px] truncate text-[13px] text-[#3a3530]"
              title={book.title}
            >
              {cleanDocumentTitle(book.title)}
            </p>
          </div>
        )}
      </header>

      {plan.status === "rejected" && (
        <div className="mb-5 rounded-[14px] border border-[#e0cba8] bg-[#fdf6e8] px-4 py-3 text-[12px] leading-5 text-[#8b6a2f]">
          Эту программу забраковал рецензент, поэтому начать по ней занятия
          нельзя. Постройте её заново — исходный учебник и цель сохранены.
        </div>
      )}

      {blockers.length > 0 && (
        <div className="mb-5 rounded-[14px] border border-[#e0cba8] bg-[#fdf6e8] px-4 py-3">
          <p className="text-[12px] font-medium text-[#8b6a2f]">
            Рецензент оставил замечания
          </p>
          <ul className="mt-1.5 space-y-1 text-[12px] leading-5 text-[#8b7a5e]">
            {blockers.map((finding, index) => (
              <li key={`${finding.kind}-${index}`}>{finding.message}</li>
            ))}
          </ul>
        </div>
      )}

      {degraded && (
        <div className="mb-5 rounded-[14px] border border-[#ded7cd] bg-[#fbf8f2] px-4 py-3 text-[12px] leading-5 text-[#7f776e]">
          Учебник не загрузился, поэтому карта страниц недоступна. Сама
          программа показана полностью.
        </div>
      )}

      {ribbon.unitCount > 0 && (
        <>
          <PlanRibbon
            model={ribbon}
            hoveredTopicId={hoveredTopicId}
            onHoverTopic={setHoveredTopicId}
          />
        </>
      )}

      {everythingUnsourced && (
        <div className={`${paperCard} mb-1 mt-5 px-4 py-3 text-[12px] leading-5 text-[#7f776e]`}>
          Ни одна тема не сослалась на страницы учебника — программа построена
          по смыслу, а не по разделам книги.
        </div>
      )}

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Прогноз идёт раньше модулей в разметке: на телефоне ответ на вопрос
            «успею ли я» важнее списка тем. На десктопе он уходит в правую
            колонку той же строки. */}
        <div className="lg:col-start-2 lg:row-start-1">
          <PlanForecastRail plan={plan} goal={goal} />
        </div>
        <div className="lg:col-start-1 lg:row-start-1">
          {plan.modules.length > 0 ? (
            <PlanModules
              plan={plan}
              hoveredTopicId={hoveredTopicId}
              onHoverTopic={setHoveredTopicId}
            />
          ) : (
            <div className={`${paperCard} p-6 text-[13px] text-[#7f776e]`}>
              В программе пока нет ни одного модуля. Постройте её заново.
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 border-t border-[#ded8ce] pt-6">
        <PlanActions
          plan={plan}
          approving={busy}
          approveError={error}
          onApprove={() => void approve()}
          onPlanChange={onPlanChange}
        />
      </div>
    </CoffeePageShell>
  );
}
