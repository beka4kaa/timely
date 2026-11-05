import { redirect } from "next/navigation";

// Достижения стали бейджами в профиле. Адрес остался, чтобы старые ссылки не вели в никуда.
export default function AchievementsPage() {
  redirect("/dashboard/profile");
}
