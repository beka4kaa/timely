import { AchievementsComponent } from "@/components/dashboard/achievements-component";
import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function AchievementsPage() {
  return (
    <CoffeePageShell>
      <AchievementsComponent />
    </CoffeePageShell>
  );
}
