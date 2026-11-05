import { HabitsPage } from '@/components/habits/habits-page'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <FullAccessGate>
      <HabitsPage />
    </FullAccessGate>
  )
}
