"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
  Medal,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CoffeePageShell,
  coffeeButtonClass,
  coffeePanelClass,
} from "@/components/dashboard/coffee-page-shell";

interface ContestEntry {
  id: number;
  name: string;
  date: string;
  score: string;
  total: string;
  type: "Virtual" | "Live";
}

interface RankedUser {
  rank: number;
  username: string;
  country: string;
  rating: number;
  attended: number;
}

const UPCOMING_CONTESTS = [
  {
    id: 505,
    series: "Weekly",
    name: "Weekly Contest 505",
    date: "7 июня · 08:30 GMT+6",
    countdown: "04 дн  ·  02:14:03",
    tone: "from-[#f4e6cf] via-[#fbf5eb] to-[#e8d1ae]",
  },
  {
    id: 184,
    series: "Biweekly",
    name: "Biweekly Contest 184",
    date: "13 июня · 20:30 GMT+6",
    countdown: "10 дн  ·  14:14:19",
    tone: "from-[#e9e0d1] via-[#fbf8f2] to-[#d7c2a2]",
  },
];

const PAST_CONTESTS: ContestEntry[] = [
  { id: 504, name: "Weekly Contest 504", date: "31 мая · 08:30", score: "0", total: "4", type: "Virtual" },
  { id: 503, name: "Weekly Contest 503", date: "24 мая · 08:30", score: "0", total: "4", type: "Virtual" },
  { id: 183, name: "Biweekly Contest 183", date: "23 мая · 20:30", score: "0", total: "4", type: "Virtual" },
  { id: 502, name: "Weekly Contest 502", date: "17 мая · 08:30", score: "0", total: "4", type: "Virtual" },
  { id: 501, name: "Weekly Contest 501", date: "10 мая · 08:30", score: "0", total: "4", type: "Virtual" },
  { id: 182, name: "Biweekly Contest 182", date: "9 мая · 20:30", score: "0", total: "4", type: "Virtual" },
];

const MY_CONTESTS: ContestEntry[] = [
  { id: 501, name: "Weekly Contest 501", date: "10 мая · 08:30", score: "3", total: "4", type: "Live" },
  { id: 499, name: "Weekly Contest 499", date: "26 апреля · 08:30", score: "2", total: "4", type: "Live" },
];

const RANKED_USERS: RankedUser[] = [
  { rank: 1, username: "Bekadka KG", country: "KG", rating: 6767, attended: 107 },
  { rank: 2, username: "coldified", country: "EU", rating: 6420, attended: 96 },
  { rank: 3, username: "MathWizard", country: "NA", rating: 6184, attended: 89 },
  { rank: 4, username: "janekv", country: "EU", rating: 5942, attended: 82 },
  { rank: 5, username: "quantum_leap", country: "CIS", rating: 5710, attended: 78 },
  { rank: 6, username: "CodeKylaz", country: "NA", rating: 5588, attended: 74 },
];

function UpcomingCard({
  contest,
}: {
  contest: (typeof UPCOMING_CONTESTS)[number];
}) {
  return (
    <article
      className={`group relative min-h-[230px] overflow-hidden rounded-[22px] border border-[#d9cfbf] bg-gradient-to-br ${contest.tone} p-5 shadow-[0_16px_45px_rgba(77,57,31,0.08)]`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-35"
        style={{
          backgroundImage:
            "linear-gradient(rgba(107,80,47,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(107,80,47,0.1) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div className="relative flex h-full min-h-[190px] flex-col">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full border border-[#cdb793] bg-white/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8d6231]">
            {contest.series}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-[#d5c7b3] bg-[#fffaf1]/80 px-2.5 py-1 text-[10px] font-medium tabular-nums text-[#6f6253]">
            <Clock3 className="h-3 w-3" />
            {contest.countdown}
          </span>
        </div>

        <div className="my-auto flex items-end justify-between py-5">
          <div>
            <p className="font-serif text-[54px] leading-none tracking-[-0.06em] text-[#8a6033]/25">
              {contest.id}
            </p>
            <h2 className="mt-2 font-serif text-[22px] font-medium tracking-[-0.025em] text-[#332d27]">
              {contest.name}
            </h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#766c61]">
              <CalendarDays className="h-3.5 w-3.5" />
              {contest.date}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Открыть ${contest.name}`}
            className="grid h-10 w-10 place-items-center rounded-full border border-[#cbb58f] bg-[#fffaf1] text-[#81572c] transition-transform hover:-translate-y-0.5 hover:bg-white"
          >
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function RankingPanel() {
  return (
    <section className={`${coffeePanelClass} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-[#e2dcd3] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#9a6a35]">
            Текущий сезон
          </p>
          <h2 className="mt-1 font-serif text-[20px] font-medium text-[#332e29]">
            Лучшие участники
          </h2>
        </div>
        <Users className="h-5 w-5 text-[#a3978a]" />
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-[#e5dfd7] bg-[#f6f1e9] p-4">
        {RANKED_USERS.slice(0, 3).map((user) => (
          <div
            key={user.rank}
            className={`rounded-[16px] border p-3 text-center ${
              user.rank === 1
                ? "border-[#d9b873] bg-[#fff8e7]"
                : "border-[#dfd8cd] bg-[#fffdfa]"
            }`}
          >
            <div className="mx-auto mb-2 grid h-8 w-8 place-items-center rounded-full bg-white text-[#9a6830] shadow-sm">
              {user.rank === 1 ? (
                <Crown className="h-4 w-4" />
              ) : (
                <Medal className="h-4 w-4" />
              )}
            </div>
            <p className="truncate text-[11px] font-semibold text-[#403a34]">
              {user.username}
            </p>
            <p className="mt-1 text-[10px] tabular-nums text-[#9a6a35]">
              {user.rating}
            </p>
          </div>
        ))}
      </div>

      <div className="divide-y divide-[#e7e1d9] px-2 py-1">
        {RANKED_USERS.slice(3).map((user) => (
          <div
            key={user.rank}
            className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-[#f4efe7]"
          >
            <span className="w-6 text-center text-[11px] font-semibold tabular-nums text-[#a0968b]">
              {user.rank}
            </span>
            <Avatar className="h-8 w-8 border border-[#ddd5c9]">
              <AvatarFallback className="bg-[#efe8dd] text-[10px] font-semibold text-[#765d43]">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[#403a34]">
                {user.username}
              </p>
              <p className="text-[10px] text-[#968d83]">
                {user.country} · {user.attended} участий
              </p>
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-[#875d31]">
              {user.rating}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContestList() {
  const [tab, setTab] = useState<"past" | "my">("past");
  const [page, setPage] = useState(1);
  const contests = tab === "past" ? PAST_CONTESTS : MY_CONTESTS;

  return (
    <section className={`${coffeePanelClass} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2dcd3] px-5 py-4">
        <div className="flex rounded-full border border-[#ded7cc] bg-[#f2eee7] p-1">
          {[
            ["past", "Прошедшие"],
            ["my", "Мои"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value as "past" | "my");
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                tab === value
                  ? "bg-[#fffdfa] text-[#704a22] shadow-sm"
                  : "text-[#8b837a] hover:text-[#514a43]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[#999086]">
          {contests.length} контестов
        </span>
      </div>

      <div className="divide-y divide-[#e7e1d9] px-2">
        {contests.map((contest) => (
          <button
            key={`${contest.id}-${contest.type}`}
            type="button"
            className="grid w-full grid-cols-[38px_1fr_auto_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#f4efe7]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-[11px] border border-[#ddc59f] bg-[#fff7e8] text-[#95612c]">
              <Trophy className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-[#3c3732]">
                {contest.name}
              </span>
              <span className="mt-0.5 block text-[10px] text-[#988f85]">
                {contest.date}
              </span>
            </span>
            <span className="text-[11px] tabular-nums text-[#746b61]">
              {contest.score}/{contest.total}
            </span>
            <span
              className={`rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] ${
                contest.type === "Live"
                  ? "bg-[#e5f1e8] text-[#507358]"
                  : "bg-[#e9e3d9] text-[#786a59]"
              }`}
            >
              {contest.type}
            </span>
          </button>
        ))}
      </div>

      {tab === "past" && (
        <div className="flex items-center justify-center gap-1 border-t border-[#e4ded5] px-4 py-3">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className={`${coffeeButtonClass} h-8 w-8`}
            aria-label="Предыдущая страница"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPage(value)}
              className={`h-8 w-8 rounded-full text-[11px] font-medium ${
                page === value
                  ? "bg-[#8a5b2b] text-white"
                  : "text-[#81786f] hover:bg-[#efe9df]"
              }`}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(87, value + 1))}
            className={`${coffeeButtonClass} h-8 w-8`}
            aria-label="Следующая страница"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </section>
  );
}

export default function ContestsPage() {
  return (
    <CoffeePageShell
      eyebrow="Соревнования Timely"
      title="Contests"
      description="Еженедельные задачи, спокойный соревновательный ритм и единый рейтинг по всем дисциплинам."
      icon={<Swords className="h-5 w-5" />}
      actions={
        <span className="inline-flex items-center gap-2 rounded-full border border-[#d9d1c6] bg-[#fffdfa] px-3 py-2 text-[11px] text-[#726a61]">
          <CalendarDays className="h-3.5 w-3.5 text-[#9a6833]" />
          Сезон 2026 · 12 недель
        </span>
      }
    >
      <section className="grid gap-4 md:grid-cols-2">
        {UPCOMING_CONTESTS.map((contest) => (
          <UpcomingCard key={contest.id} contest={contest} />
        ))}
      </section>

      <div className="my-7 flex items-center justify-center gap-2 text-[11px] text-[#8b8278]">
        <span className="h-px w-10 bg-[#d8d1c7]" />
        Участвуйте, разбирайте решения и зарабатывайте ELO
        <span className="h-px w-10 bg-[#d8d1c7]" />
      </div>

      <section className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <RankingPanel />
        <ContestList />
      </section>
    </CoffeePageShell>
  );
}
