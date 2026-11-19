import type { Metadata } from "next";
import { PomodoroPage } from "@/components/pomodoro/pomodoro-page";
import { serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("Помодоро") };
}

export default function Page() {
  return <PomodoroPage />;
}
