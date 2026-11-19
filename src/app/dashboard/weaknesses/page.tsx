import type { Metadata } from "next";

import { FullAccessGate } from "@/components/full-access-gate";
import { WeakPage } from "@/components/mind/weak-page";
import { serverT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT();
  return { title: t("Слабые темы") };
}

export default function Page() {
  return (
    <FullAccessGate>
      <WeakPage />
    </FullAccessGate>
  );
}
