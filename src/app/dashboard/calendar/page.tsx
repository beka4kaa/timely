import { EnhancedCalendar } from '@/components/dashboard/enhanced-calendar'
import { Calendar } from 'lucide-react'

export default function CalendarPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Calendar className="h-8 w-8" />
          Календарь и планирование
        </h1>
        <p className="text-muted-foreground">
          Управляйте своим расписанием и планируйте события с расширенными функциями
        </p>
      </div>
      
      <EnhancedCalendar />
    </div>
  )
}