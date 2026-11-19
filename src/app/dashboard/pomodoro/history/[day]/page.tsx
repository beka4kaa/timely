import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FocusDayPage } from "@/components/pomodoro/focus-history";
import { serverT } from "@/lib/i18n/server";
import { isDayKey } from "@/lib/focus-history";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("День занятий") };
}

export default async function Page({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  if (!isDayKey(day)) notFound();
  return <FocusDayPage dayKey={day} />;
}
