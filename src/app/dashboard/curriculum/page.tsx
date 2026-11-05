
import { CurriculumSection } from '@/components/curriculum/curriculum-section'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

// Раздел тратит токены на разбор цели, генерацию программы и рецензию, поэтому
// закрыт тем же гейтом, что цели и предметы.
export default function CurriculumPage() {
  return (
    <FullAccessGate>
      <CurriculumSection />
    </FullAccessGate>
  )
}
