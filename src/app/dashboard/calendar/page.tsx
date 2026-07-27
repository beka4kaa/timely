import { CalendarComponent } from '@/components/dashboard/calendar-component'
import { CalendarDays } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function CalendarPage() {
  return (
    <CoffeePageShell
      eyebrow="Учебный ритм"
      title="Календарь"
      description="Планируйте и отслеживайте задачи, занятия и важные события."
      icon={<CalendarDays className="h-5 w-5" />}
    >
      <CalendarComponent />
    </CoffeePageShell>
  )
}
