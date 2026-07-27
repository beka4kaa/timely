import { SelfWorkComponent } from '@/components/dashboard/self-work-component'
import { FullAccessGate } from '@/components/full-access-gate'
import { Heart } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function SelfWorkPage() {
  return (
    <FullAccessGate>
      <CoffeePageShell
        eyebrow="Личное пространство"
        title="Работа с собой"
        description="Честная работа с неуверенностями, рефлексия и личностный рост."
        icon={<Heart className="h-5 w-5" />}
      >
        <SelfWorkComponent />
      </CoffeePageShell>
    </FullAccessGate>
  )
}
