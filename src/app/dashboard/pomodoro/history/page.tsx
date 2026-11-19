import type { Metadata } from "next";
import { FocusHistoryPage } from "@/components/pomodoro/focus-history";
import { serverT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("История занятий") };
}

export default function Page() {
  return <FocusHistoryPage />;
}
