import { SelfWorkComponent } from '@/components/dashboard/self-work-component'
import { FullAccessGate } from '@/components/full-access-gate'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function SelfWorkPage() {
  return (
    <FullAccessGate>
      <CoffeePageShell>
        <SelfWorkComponent />
      </CoffeePageShell>
    </FullAccessGate>
  )
}
