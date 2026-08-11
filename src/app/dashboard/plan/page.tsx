import { FullAccessGate } from "@/components/full-access-gate";
import { StudyPlanPage } from "@/components/studyplan/plan-page";

// Расписание читается на клиенте: зона ученика и текущее время известны только
// в браузере, а рендерить календарь на сервере в чужой зоне значит показать
// первым кадром неверные часы.
export const dynamic = "force-dynamic";

export default function PlanPage() {
  return (
    <FullAccessGate>
      <StudyPlanPage />
    </FullAccessGate>
  );
}
