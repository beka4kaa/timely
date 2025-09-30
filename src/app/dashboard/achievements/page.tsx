import { AchievementsComponent } from '@/components/dashboard/achievements-component'
import { Trophy } from 'lucide-react'

export default function AchievementsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="h-8 w-8" />
          Мои достижения
        </h1>
        <p className="text-muted-foreground mt-2">
          Коллекция ваших побед и успехов для мотивации и вдохновения
        </p>
      </div>
      
      <AchievementsComponent />
    </div>
  )
}