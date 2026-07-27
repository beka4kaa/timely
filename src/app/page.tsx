import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CalendarDays,
  PenTool,
  Sparkles,
} from "lucide-react";

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
  "https://app.timelyplan.me";

const features = [
  {
    icon: BookOpenText,
    title: "Учёба в одном месте",
    description:
      "Дневник, расписание и учебные материалы собраны в понятной рабочей среде.",
  },
  {
    icon: PenTool,
    title: "Научная AI-доска",
    description:
      "Разбирайте темы, стройте графики и создавайте наглядные схемы вместе с AI-тьютором.",
  },
  {
    icon: CalendarDays,
    title: "Планы без перегруза",
    description:
      "Timely помогает превратить большую цель в спокойный и выполнимый план.",
  },
];

export const metadata: Metadata = {
  title: "TimelyPlan — пространство для учёбы",
  description:
    "Школьный дневник, планировщик и AI-доска в едином пространстве TimelyPlan.",
};

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f4ee] text-[#302b26]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-55 [background-image:radial-gradient(#d7cfc3_1px,transparent_1px)] [background-size:28px_28px]"
      />

      <header className="relative z-10 border-b border-[#ded7cd] bg-[#fbf9f5]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-3 text-[#714b25]"
            aria-label="TimelyPlan"
          >
            <Image
              src="/logo.svg"
              alt=""
              width={34}
              height={34}
              priority
              className="rounded-[9px]"
            />
            <span className="font-serif text-2xl font-semibold">Timely</span>
          </Link>

          <nav className="flex items-center gap-2" aria-label="Основная навигация">
            <Link
              href={`${appUrl}/auth/signin`}
              className="hidden rounded-full px-4 py-2 text-sm font-medium text-[#655e56] transition-colors hover:bg-[#eee8df] sm:inline-flex"
            >
              Войти
            </Link>
            <Link
              href={appUrl}
              className="inline-flex items-center gap-2 rounded-full bg-[#302b26] px-4 py-2 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
            >
              Открыть Timely
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative z-[1] mx-auto grid min-h-[calc(100vh-64px)] max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:py-28">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#d9c8b2] bg-[#fffaf2] px-3 py-1.5 text-sm text-[#875b2d]">
            <Sparkles className="h-4 w-4" />
            Учебное пространство нового поколения
          </div>

          <h1 className="font-serif text-5xl font-medium leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            Учиться спокойнее.
            <br />
            <span className="text-[#9a642d]">Понимать глубже.</span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-[#756d64] sm:text-xl">
            Timely объединяет школьный дневник, планирование и научную
            AI-доску — чтобы у каждой учебной задачи был понятный следующий шаг.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href={appUrl}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#302b26] px-6 text-base font-medium text-white shadow-[0_14px_35px_rgba(48,43,38,0.18)] transition-transform hover:-translate-y-0.5"
            >
              Начать работу
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={`${appUrl}/auth/register`}
              className="inline-flex h-12 items-center justify-center rounded-full border border-[#d8d0c5] bg-[#fbf9f5] px-6 text-base font-medium text-[#514a43] transition-colors hover:bg-white"
            >
              Создать аккаунт
            </Link>
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute -inset-16 rounded-full bg-[#d5b17f]/20 blur-3xl"
          />
          <div className="relative overflow-hidden rounded-[34px] border border-[#d9d1c7] bg-[#fcfaf7]/95 p-4 shadow-[0_30px_80px_rgba(72,55,38,0.15)] sm:p-6">
            <div className="mb-5 flex items-center justify-between border-b border-[#e5ded5] pb-4">
              <div>
                <p className="font-serif text-xl font-semibold">
                  Второй закон Ньютона
                </p>
                <p className="mt-1 text-sm text-[#9a9288]">
                  Научная доска · 4 шага
                </p>
              </div>
              <span className="rounded-full bg-[#f0dfc7] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#8b5a27]">
                В процессе
              </span>
            </div>

            <div className="rounded-[24px] border border-[#e4ddd4] bg-white p-5 sm:p-7">
              <svg
                viewBox="0 0 560 280"
                role="img"
                aria-label="Схема бруска на наклонной плоскости"
                className="h-auto w-full"
              >
                <defs>
                  <marker
                    id="landing-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#875b2d" />
                  </marker>
                </defs>
                <path
                  d="M80 224 L470 224 L470 78 Z"
                  fill="#f1ece5"
                  stroke="#8b8379"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
                <g transform="translate(298 135) rotate(-20)">
                  <rect
                    x="-70"
                    y="-50"
                    width="140"
                    height="100"
                    rx="7"
                    fill="#dcc29e"
                    stroke="#51483f"
                    strokeWidth="4"
                  />
                </g>
                <line
                  x1="298"
                  y1="135"
                  x2="298"
                  y2="217"
                  stroke="#875b2d"
                  strokeWidth="5"
                  markerEnd="url(#landing-arrow)"
                />
                <line
                  x1="298"
                  y1="135"
                  x2="265"
                  y2="43"
                  stroke="#875b2d"
                  strokeWidth="5"
                  markerEnd="url(#landing-arrow)"
                />
                <line
                  x1="298"
                  y1="135"
                  x2="382"
                  y2="104"
                  stroke="#875b2d"
                  strokeWidth="5"
                  markerEnd="url(#landing-arrow)"
                />
                <text x="310" y="205" fill="#51483f" fontSize="20">
                  mg
                </text>
                <text x="235" y="35" fill="#51483f" fontSize="20">
                  N
                </text>
                <text x="392" y="102" fill="#51483f" fontSize="20">
                  f
                </text>
                <path
                  d="M122 224 A42 42 0 0 1 161 210"
                  fill="none"
                  stroke="#8b8379"
                  strokeWidth="3"
                />
                <text x="137" y="211" fill="#51483f" fontSize="18">
                  30°
                </text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-[1] border-t border-[#ded7cd] bg-[#fbf9f5]">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-16 sm:px-8 md:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              className="rounded-[24px] border border-[#e0d9cf] bg-[#fffdfa] p-6"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#efe1cf] text-[#875b2d]">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="font-serif text-xl font-semibold">{title}</h2>
              <p className="mt-2 leading-7 text-[#7e766e]">{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
