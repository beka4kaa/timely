import { BookMarked } from 'lucide-react'

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
      <CoffeePageShell
        eyebrow="Учебная программа"
        title="Курс по книге"
        description="Загрузите учебник — построим программу по его разделам, со ссылками на конкретные страницы."
        icon={<BookMarked className="h-5 w-5" />}
      >
        {/* Ширину задаёт сам раздел: каталогу нужен лист шире, чем форме
            мастера, где строка длиннее ~70 символов перестаёт читаться. */}
        <CurriculumSection />
      </CoffeePageShell>
    </FullAccessGate>
  )
}
