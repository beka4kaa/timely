import { GoalsLayout } from '@/components/goals-map/GoalsLayout'
import { AmbientBackground } from '@/components/ambient-bg'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

export default function GoalsPage() {
  return (
    <FullAccessGate>
      <div className="relative min-h-full flex flex-col">
        <AmbientBackground />
        <div className="relative z-10 flex flex-col">
          <GoalsLayout />
        </div>
      </div>
    </FullAccessGate>
  )
}
