import { ScheduleComponent } from '@/components/dashboard/schedule-component'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <CoffeePageShell>
      <ScheduleComponent />
    </CoffeePageShell>
  )
}
