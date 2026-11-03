import type { Metadata } from "next";

import { NowPage } from "@/components/now/now-page";

// Главная приложения — «Сейчас». Раньше здесь был редирект в дневник: сетку
// уроков, которая не отвечала на вопрос «что мне делать сейчас».
export const metadata: Metadata = {
  title: "Сейчас",
};

export default function DashboardPage() {
  return <NowPage />;
}
