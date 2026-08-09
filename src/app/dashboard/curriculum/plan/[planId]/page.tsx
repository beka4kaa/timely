import { CurriculumPlanPage } from '@/components/curriculum/plan-page'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

// Отдельный роут, а не шаг мастера: программа — это то, к чему возвращаются
// каждый день, и на неё нужна ссылка. `params` в Next 15 — промис.
export default async function CurriculumPlanRoute({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const { planId } = await params

  return (
    <FullAccessGate>
      <CurriculumPlanPage planId={planId} />
    </FullAccessGate>
  )
}
