// Страница программы: корешок книги, модули и сроки.
//
// Состояние подсветки живёт здесь, а не в контексте: связаны ровно две
// половины экрана, и передать им пару `{hoveredTopicId, onHoverTopic}` дешевле
// и понятнее, чем заводить провайдер.

"use client";

import { BookMarked } from "lucide-react";
import { useMemo, useState } from "react";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import { buildRibbon } from "@/lib/curriculum-ribbon";
import { PlanActions } from "./plan-actions";
import { PlanForecastRail } from "./plan-forecast-rail";
import { PlanModules } from "./plan-modules";
import { PlanRibbon } from "./plan-ribbon";
import { PlanRibbonLegend } from "./plan-ribbon-legend";
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

  const moduleTitles = plan.modules.map((courseModule) => courseModule.title);
  const moduleIndexByTopic = useMemo(() => {
    const map = new Map<string, number>();
    plan.modules.forEach((courseModule, index) => {
      for (const topic of courseModule.topics) map.set(topic.id, index);
    });
    return map;
  }, [plan]);
  const hoveredModuleIndex = hoveredTopicId
    ? (moduleIndexByTopic.get(hoveredTopicId) ?? null)
    : null;

  const blockers = reviewFindings.filter((finding) => finding.severity === "blocker");
  const allTopicsCount = plan.modules.reduce(
    (sum, courseModule) => sum + courseModule.topics.length,
    0,
  );
  const everythingUnsourced =
    allTopicsCount > 0 && ribbon.unsourcedTopicIds.length === allTopicsCount;

  return (
    <CoffeePageShell
      eyebrow="Курс по книге"
      title={plan.title}
      description={plan.objective}
      icon={<BookMarked className="h-5 w-5" />}
      actions={
        book && (
          <div className="rounded-[18px] border border-[#ded7cd] bg-[#fbfaf7] px-4 py-2.5 shadow-[0_8px_28px_rgba(67,50,31,0.05)]">
            <p className={paperCaption}>Учебник</p>
            <p className="mt-0.5 max-w-[240px] truncate text-[13px] text-[#3a3530]">
              {book.title}
            </p>
          </div>
        )
      }
    >
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
            moduleTitles={moduleTitles}
            hoveredTopicId={hoveredTopicId}
            onHoverTopic={setHoveredTopicId}
          />
          <PlanRibbonLegend
            moduleTitles={moduleTitles}
            hoveredModuleIndex={hoveredModuleIndex}
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
