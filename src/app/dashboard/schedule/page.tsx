import { ScheduleComponent } from '@/components/dashboard/schedule-component'
import { Clock } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <CoffeePageShell
      eyebrow="Планирование"
      title="Расписание"
      description="Учебные блоки, события и задачи на неделю."
      icon={<Clock className="h-5 w-5" />}
    >
      <ScheduleComponent />
    </CoffeePageShell>
  )
}
