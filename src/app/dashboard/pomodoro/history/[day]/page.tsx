import { notFound } from "next/navigation";

import { FocusDayPage } from "@/components/pomodoro/focus-history";
import { isDayKey } from "@/lib/focus-history";

export const metadata = {
  title: "День занятий",
};

export default async function Page({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  if (!isDayKey(day)) notFound();
  return <FocusDayPage dayKey={day} />;
}
