import { Trophy } from "lucide-react";
import { AchievementsComponent } from "@/components/dashboard/achievements-component";
import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function AchievementsPage() {
  return (
    <CoffeePageShell
      eyebrow="Личная коллекция"
      title="Achievements"
      description="Сохраняйте важные победы, замечайте собственный рост и возвращайтесь к нему, когда нужна мотивация."
      icon={<Trophy className="h-5 w-5" />}
    >
      <AchievementsComponent />
    </CoffeePageShell>
  );
}
