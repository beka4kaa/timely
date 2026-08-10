import { CalendarComponent } from '@/components/dashboard/calendar-component'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function CalendarPage() {
  return (
    <CoffeePageShell>
      <CalendarComponent />
    </CoffeePageShell>
  )
}
