import { GoalsLayout } from '@/components/goals-map/GoalsLayout'
import { AmbientBackground } from '@/components/ambient-bg'

export const dynamic = 'force-dynamic'

export default function GoalsPage() {
  return (
    <div className="relative h-full flex flex-col">
      <AmbientBackground />
      <div className="relative z-10 flex flex-1 flex-col h-full">
        <GoalsLayout />
      </div>
    </div>
  )
}
