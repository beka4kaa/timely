import { GoalsComponent } from '@/components/dashboard/goals-component'
import { Target } from 'lucide-react'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function GoalsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Target className="h-8 w-8" />
          Цели и планирование
        </h1>
        <p className="text-muted-foreground mt-2">
          Ставьте SMART цели и отслеживайте прогресс их достижения
        </p>
      </div>
      
      <GoalsComponent />
    </div>
  )
}