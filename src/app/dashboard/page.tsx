import type { Metadata } from "next";

import { NowPage } from "@/components/now/now-page";
import { serverT } from "@/lib/i18n/server";

// Главная приложения — «Сейчас». Раньше здесь был редирект в дневник: сетку
// уроков, которая не отвечала на вопрос «что мне делать сейчас».
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("Сейчас") };
}

export default function DashboardPage() {
  return <NowPage />;
}
