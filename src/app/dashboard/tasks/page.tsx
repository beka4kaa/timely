import { TasksComponent } from '@/components/dashboard/tasks-component'
import { CheckSquare } from 'lucide-react'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function TasksPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <CheckSquare className="h-8 w-8" />
          Ежедневные задачи
        </h1>
        <p className="text-muted-foreground mt-2">
          Управляйте своими задачами и повышайте продуктивность
        </p>
      </div>
      
      <TasksComponent />
    </div>
  )
}