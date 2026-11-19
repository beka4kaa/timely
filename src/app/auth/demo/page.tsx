import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { DemoEntry } from "@/components/demo/demo-entry"
import { IS_DEMO } from "@/lib/demo-mode"
import { serverT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverT()
  return { title: t("Демо"), robots: { index: false, follow: false } }
}

// Только в сборке демо. В продакшене этого входа нет: там 404.
export default function DemoEntryPage() {
  if (!IS_DEMO) notFound()
  return <DemoEntry />
}
