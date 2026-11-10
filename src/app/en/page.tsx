import type { Metadata, Viewport } from "next";
import { LandingPage, landingMetadata } from "@/components/landing/landing-page";

// Английская версия лендинга. Живёт только на сайте-визитке: на app-хосте /en уводит
// сюда (src/lib/host-routing.ts), а первый заход на «/» из браузера, где нет языков,
// на которых читают по-русски, приводит сюда же (src/lib/landing-locale.ts).

export const metadata: Metadata = landingMetadata("en");

export const viewport: Viewport = {
  colorScheme: "light dark",
};

export default function EnglishHomePage() {
  return <LandingPage locale="en" />;
}
