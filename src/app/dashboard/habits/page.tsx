import { HabitsTracker } from '@/components/habits/habits-tracker'

export const dynamic = 'force-dynamic'

export default function HabitsPage() {
  return (
    <div className="flex flex-1 flex-col p-6 max-w-5xl mx-auto w-full">
      <HabitsTracker />
    </div>
  )
}
