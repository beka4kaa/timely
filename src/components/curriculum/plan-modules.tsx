// Список модулей программы.

"use client";

import type { CoursePlan } from "@/lib/curriculum-api";
import { PlanModuleStrip } from "./plan-module-strip";

/** external_id → название темы: prerequisites приезжают идентификаторами. */
export function titleByExternalId(plan: CoursePlan): Map<string, string> {
  const titles = new Map<string, string>();
  for (const courseModule of plan.modules) {
    for (const topic of courseModule.topics) titles.set(topic.external_id, topic.title);
  }
  return titles;
}

export function PlanModules({
  plan,
  hoveredTopicId,
  onHoverTopic,
}: {
  plan: CoursePlan;
  hoveredTopicId: string | null;
  onHoverTopic: (topicId: string | null) => void;
}) {
  const titles = titleByExternalId(plan);

  return (
    <div className="space-y-4">
      {plan.modules.map((courseModule, index) => {
        // Заголовок части печатается там же, где в книге: перед первой её
        // главой. Модули идут в порядке книги, поэтому достаточно сравнить с
        // предыдущим — отдельная группировка ничего бы не добавила.
        const partStarts =
          Boolean(courseModule.part_title) &&
          courseModule.part_title !== plan.modules[index - 1]?.part_title;

        return (
          <div key={courseModule.id} className={partStarts && index > 0 ? "pt-4" : ""}>
            {partStarts && (
              <h3 className="mb-3 font-serif text-[13px] uppercase tracking-[0.14em] text-[#a1978b]">
                {courseModule.part_title}
              </h3>
            )}
            <PlanModuleStrip
              courseModule={courseModule}
              index={index}
              moduleCount={plan.modules.length}
              titles={titles}
              hoveredTopicId={hoveredTopicId}
              onHoverTopic={onHoverTopic}
            />
          </div>
        );
      })}
    </div>
  );
}
