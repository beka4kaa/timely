import { SelfWorkComponent } from '@/components/dashboard/self-work-component'
import { BookOpen, Heart } from 'lucide-react'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function SelfWorkPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Heart className="h-8 w-8" />
          Работа с собой
        </h1>
        <p className="text-muted-foreground mt-2">
          Честная работа с неуверенностями, рефлексия и личностный рост
        </p>
      </div>
      
      <SelfWorkComponent />
    </div>
  )
}