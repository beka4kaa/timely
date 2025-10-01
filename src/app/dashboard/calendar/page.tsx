import { CalendarComponent } from '@/components/dashboard/calendar-component'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function CalendarPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Календарь</h1>
        <p className="text-muted-foreground">
          Планируйте и отслеживайте свои задачи и события
        </p>
      </div>
      
      <CalendarComponent />
    </div>
  )
}
