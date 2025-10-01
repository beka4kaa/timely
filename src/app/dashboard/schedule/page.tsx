import { ScheduleComponent } from '@/components/dashboard/schedule-component'
import { Clock } from 'lucide-react'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <div className="space-y-2">
      <ScheduleComponent />
    </div>
  )
}