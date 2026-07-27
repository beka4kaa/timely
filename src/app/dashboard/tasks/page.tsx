import { TasksComponent } from '@/components/dashboard/tasks-component'
import { CheckSquare } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function TasksPage() {
  return (
    <CoffeePageShell
      eyebrow="Фокус дня"
      title="Ежедневные задачи"
      description="Управляйте своими задачами и сохраняйте ясный приоритет."
      icon={<CheckSquare className="h-5 w-5" />}
    >
      <TasksComponent />
    </CoffeePageShell>
  )
}
