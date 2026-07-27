import { NutritionTracker } from '@/components/nutrition/nutrition-tracker'
import { AmbientBackground } from '@/components/ambient-bg'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

export default function NutritionPage() {
  return (
    <FullAccessGate>
      <div className="relative min-h-full">
        <AmbientBackground />
        {/* Телефонная ширина по центру — ощущение мобильного приложения и на десктопе */}
        <div className="relative z-10 mx-auto flex min-h-full w-full max-w-md flex-1 flex-col px-4 pt-5">
          <NutritionTracker />
        </div>
      </div>
    </FullAccessGate>
  )
}
