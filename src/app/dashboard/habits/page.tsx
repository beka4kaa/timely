import { HabitsTracker } from '@/components/habits/habits-tracker'
import { AmbientBackground } from '@/components/ambient-bg'

export const dynamic = 'force-dynamic'

export default function HabitsPage() {
  return (
    <div className="relative min-h-full">
      <AmbientBackground />
      <div className="relative z-10 flex flex-1 flex-col p-6 max-w-5xl mx-auto w-full">
        <HabitsTracker />
      </div>
    </div>
  )
}
