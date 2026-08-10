
import { CurriculumSection } from '@/components/curriculum/curriculum-section'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'
import { FullAccessGate } from '@/components/full-access-gate'

export const dynamic = 'force-dynamic'

// Раздел тратит токены на разбор цели, генерацию программы и рецензию, поэтому
// закрыт тем же гейтом, что цели и предметы.
//
// `AmbientBackground` здесь больше нет: у шелла своя точечная сетка, и две
// подложки давали двойное виньетирование.
export default function CurriculumPage() {
  return (
    <FullAccessGate>
      <CoffeePageShell>
        {/* Ширину задаёт сам раздел: каталогу нужен лист шире, чем форме
            мастера, где строка длиннее ~70 символов перестаёт читаться. */}
        <CurriculumSection />
      </CoffeePageShell>
    </FullAccessGate>
  )
}
