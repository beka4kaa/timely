import { GoalsPage } from '@/components/goals/goals-page'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <FullAccessGate>
      <GoalsPage />
    </FullAccessGate>
  )
}
