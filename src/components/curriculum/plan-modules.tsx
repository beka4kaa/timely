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
      {plan.modules.map((courseModule, index) => (
        <PlanModuleStrip
          key={courseModule.id}
          courseModule={courseModule}
          index={index}
          moduleCount={plan.modules.length}
          titles={titles}
          hoveredTopicId={hoveredTopicId}
          onHoverTopic={onHoverTopic}
        />
      ))}
    </div>
  );
}
