import { TasksComponent } from '@/components/dashboard/tasks-component'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function TasksPage() {
  return (
    <CoffeePageShell>
      <TasksComponent />
    </CoffeePageShell>
  )
}
