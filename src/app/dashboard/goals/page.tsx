import { GoalsLayout } from '@/components/goals-map/GoalsLayout'
import { AmbientBackground } from '@/components/ambient-bg'

export const dynamic = 'force-dynamic'

export default function GoalsPage() {
  return (
    <div className="relative min-h-full flex flex-col">
      <AmbientBackground />
      <div className="relative z-10 flex flex-col">
        <GoalsLayout />
      </div>
    </div>
  )
}
