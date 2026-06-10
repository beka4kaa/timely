import { HabitsTracker } from '@/components/habits/habits-tracker'
import { Flame } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function HabitsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mb-2">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Flame className="h-8 w-8 text-orange-500" />
          Привычки
        </h1>
        <p className="text-muted-foreground mt-1">
          Маленькие действия каждый день — большие результаты со временем
        </p>
      </div>
      <HabitsTracker />
    </div>
  )
}
