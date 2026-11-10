import type { Metadata, Viewport } from "next";
import { LandingPage, landingMetadata } from "@/components/landing/landing-page";

// Русская версия лендинга. Английская — src/app/en/page.tsx, сама страница и тексты —
// в components/landing (landing-page.tsx и copy.ts).

export const metadata: Metadata = landingMetadata("ru");

// Своя тёмная тема есть — без этого Chrome с «авто-тёмным режимом»
// инвертирует светлую версию.
export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function HomePage() {
  return <LandingPage locale="ru" />;
}
