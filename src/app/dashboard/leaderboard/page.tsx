"use client";

import { useMemo, useState } from "react";
import {
  Atom,
  Code2,
  Crown,
  Globe2,
  LayoutGrid,
  List,
  Search,
  Sigma,
  Trophy,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CoffeePageShell,
  coffeePanelClass,
} from "@/components/dashboard/coffee-page-shell";
import { PrivateLeaderboards } from "@/components/leaderboard/PrivateLeaderboards";

type DisciplineKey = "overall" | "math" | "physics" | "programming";
type ViewMode = "list" | "tiers";

interface DisciplineTier {
  discipline: DisciplineKey;
  tier: string;
}

interface LeaderboardEntry {
  id: string;
  username: string;
  title: string;
  points: number;
  region: string;
  tiers: DisciplineTier[];
}

const DISCIPLINES: {
  key: DisciplineKey;
  label: string;
  icon: typeof Trophy;
}[] = [
  { key: "overall", label: "Overall", icon: Trophy },
  { key: "math", label: "Math", icon: Sigma },
  { key: "physics", label: "Physics", icon: Atom },
  { key: "programming", label: "Coding", icon: Code2 },
];

const LEADERBOARD: LeaderboardEntry[] = [
  {
    id: "1",
    username: "ItzRealBekzhan",
    title: "Grandmaster",
    points: 330,
    region: "CIS",
    tiers: [
      { discipline: "overall", tier: "HT3" },
      { discipline: "math", tier: "HT1" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "2",
    username: "coldified",
    title: "Grandmaster",
    points: 326,
    region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT1" },
      { discipline: "math", tier: "LT1" },
      { discipline: "physics", tier: "LT3" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "3",
    username: "MathWizard",
    title: "Grandmaster",
    points: 290,
    region: "NA",
    tiers: [
      { discipline: "overall", tier: "HT3" },
      { discipline: "math", tier: "HT1" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "LT3" },
    ],
  },
  {
    id: "4",
    username: "janekv",
    title: "Master",
    points: 260,
    region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT3" },
      { discipline: "math", tier: "HT4" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "HT2" },
    ],
  },
  {
    id: "5",
    username: "BlvckPhysics",
    title: "Expert",
    points: 226,
    region: "EU",
    tiers: [
      { discipline: "overall", tier: "HT2" },
      { discipline: "math", tier: "HT3" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "LT2" },
    ],
  },
  {
    id: "6",
    username: "CodeKylaz",
    title: "Expert",
    points: 226,
    region: "NA",
    tiers: [
      { discipline: "overall", tier: "HT3" },
      { discipline: "math", tier: "LT3" },
      { discipline: "physics", tier: "LT3" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "7",
    username: "ninorc15",
    title: "Expert",
    points: 211,
    region: "EU",
    tiers: [
      { discipline: "overall", tier: "HT1" },
      { discipline: "math", tier: "LT3" },
      { discipline: "physics", tier: "LT1" },
      { discipline: "programming", tier: "LT2" },
    ],
  },
  {
    id: "8",
    username: "quantum_leap",
    title: "Specialist",
    points: 186,
    region: "CIS",
    tiers: [
      { discipline: "overall", tier: "LT3" },
      { discipline: "math", tier: "LT4" },
      { discipline: "physics", tier: "HT2" },
      { discipline: "programming", tier: "HT3" },
    ],
  },
  {
    id: "9",
    username: "yMiau",
    title: "Specialist",
    points: 170,
    region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT3" },
      { discipline: "math", tier: "LT3" },
      { discipline: "physics", tier: "LT2" },
      { discipline: "programming", tier: "LT1" },
    ],
  },
  {
    id: "10",
    username: "AlgoKing",
    title: "Master",
    points: 270,
    region: "NA",
    tiers: [
      { discipline: "overall", tier: "HT2" },
      { discipline: "math", tier: "HT2" },
      { discipline: "physics", tier: "LT4" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
];

function tierClass(tier: string) {
  if (tier === "HT1") return "border-[#d6ad67] bg-[#fff2d9] text-[#8b581e]";
  if (tier.startsWith("HT")) return "border-[#dfc7a4] bg-[#f7ead8] text-[#8a6136]";
  if (tier === "LT1") return "border-[#b8cdd0] bg-[#e9f1f0] text-[#507074]";
  return "border-[#d5d0c8] bg-[#efede8] text-[#716a63]";
}

function regionClass(region: string) {
  if (region === "CIS") return "bg-[#e8f1ea] text-[#53705a]";
  if (region === "EU") return "bg-[#e9eef3] text-[#566a7c]";
  return "bg-[#f3e8e4] text-[#865d52]";
}

function rankClass(rank: number) {
  if (rank === 1) return "border-[#d5ad68] bg-[#fff0d0] text-[#81521d]";
  if (rank === 2) return "border-[#cbc8c1] bg-[#efede9] text-[#625e57]";
  if (rank === 3) return "border-[#d0aa88] bg-[#f3dfcf] text-[#815b42]";
  return "border-[#ddd7ce] bg-[#f6f2ec] text-[#827970]";
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex min-w-[34px] items-center justify-center rounded-full border px-2 py-1 text-[9px] font-bold tracking-[0.06em] ${tierClass(tier)}`}
    >
      {tier}
    </span>
  );
}

function LeaderboardList({
  entries,
}: {
  entries: LeaderboardEntry[];
}) {
  return (
    <div className={`${coffeePanelClass} overflow-hidden`}>
      <div className="hidden grid-cols-[58px_1fr_90px_1fr] items-center gap-3 border-b border-[#e2dcd3] bg-[#f5f1ea] px-5 py-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9b9186] sm:grid">
        <span className="text-center">#</span>
        <span>Участник</span>
        <span className="text-center">Регион</span>
        <span className="text-center">Уровни</span>
      </div>

      <div className="divide-y divide-[#e8e2da]">
        {entries.map((entry, index) => {
          const rank = index + 1;
          return (
            <div
              key={entry.id}
              className="grid grid-cols-[46px_1fr_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[#f6f1e9] sm:grid-cols-[58px_1fr_90px_1fr] sm:px-5"
            >
              <div className="flex justify-center">
                <span
                  className={`grid h-9 w-9 place-items-center rounded-[11px] border text-[11px] font-bold tabular-nums ${rankClass(rank)}`}
                >
                  {rank === 1 ? <Crown className="h-3.5 w-3.5" /> : rank}
                </span>
              </div>

              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-10 w-10 shrink-0 border border-[#ded7cd]">
                  <AvatarFallback className="bg-[#eee8de] text-[10px] font-semibold text-[#745f49]">
                    {entry.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-[#3a3530]">
                    {entry.username}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#91887e]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#68a079]" />
                    {entry.title} · {entry.points} pts
                  </p>
                </div>
              </div>

              <div className="hidden justify-center sm:flex">
                <span
                  className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${regionClass(entry.region)}`}
                >
                  {entry.region}
                </span>
              </div>

              <div className="flex flex-wrap justify-end gap-1.5 sm:justify-center">
                {entry.tiers.map((tier) => (
                  <TierBadge
                    key={`${entry.id}-${tier.discipline}`}
                    tier={tier.tier}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TierColumns({
  entries,
  discipline,
}: {
  entries: LeaderboardEntry[];
  discipline: DisciplineKey;
}) {
  const groups = useMemo(() => {
    const result = new Map<string, LeaderboardEntry[]>();
    entries.forEach((entry) => {
      const tier =
        entry.tiers.find((item) => item.discipline === discipline)?.tier ??
        "—";
      result.set(tier, [...(result.get(tier) ?? []), entry]);
    });
    return Array.from(result.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [discipline, entries]);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map(([tier, players]) => (
        <section key={tier} className={`${coffeePanelClass} overflow-hidden`}>
          <header className="flex items-center justify-between border-b border-[#e2dcd3] bg-[#f5f1ea] px-4 py-3">
            <TierBadge tier={tier} />
            <span className="text-[10px] text-[#9a9187]">
              {players.length} участников
            </span>
          </header>
          <div className="divide-y divide-[#e8e2da] p-1.5">
            {players.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-[#f4efe7]"
              >
                <Avatar className="h-8 w-8 border border-[#ddd6cc]">
                  <AvatarFallback className="bg-[#eee8de] text-[9px] font-semibold text-[#745f49]">
                    {entry.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#423c36]">
                  {entry.username}
                </span>
                <span className="text-[10px] tabular-nums text-[#8a6137]">
                  {entry.points}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const [scope, setScope] = useState<"global" | "private">("global");
  const [discipline, setDiscipline] = useState<DisciplineKey>("overall");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      LEADERBOARD.filter((entry) =>
        entry.username.toLowerCase().includes(search.toLowerCase()),
      ),
    [search],
  );

  return (
    <CoffeePageShell
      eyebrow="Рейтинг Timely"
      title="Leaderboard"
      description="Общий прогресс по математике, физике и программированию — без визуального шума."
      icon={<Trophy className="h-5 w-5" />}
    >
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-fit rounded-full border border-[#ddd6cb] bg-[#eee9e1] p-1">
          <button
            type="button"
            onClick={() => setScope("global")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium ${
              scope === "global"
                ? "bg-[#fffdfa] text-[#704a22] shadow-sm"
                : "text-[#8b8279]"
            }`}
          >
            <Globe2 className="h-3.5 w-3.5" />
            Глобальный
          </button>
          <button
            type="button"
            onClick={() => setScope("private")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium ${
              scope === "private"
                ? "bg-[#fffdfa] text-[#704a22] shadow-sm"
                : "text-[#8b8279]"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Приватные
          </button>
        </div>

        {scope === "global" && (
          <label className="flex h-10 w-full items-center gap-2 rounded-full border border-[#dcd5ca] bg-[#fffdfa] px-3.5 text-[#8b8278] shadow-sm lg:w-[260px]">
            <Search className="h-3.5 w-3.5" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Найти участника…"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-[#3e3934] outline-none placeholder:text-[#aaa198]"
            />
          </label>
        )}
      </div>

      {scope === "private" ? (
        <section className={`${coffeePanelClass} p-5`}>
          <PrivateLeaderboards />
        </section>
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 rounded-[18px] border border-[#ded7cd] bg-[#fbfaf7] p-2.5 shadow-[0_8px_28px_rgba(67,50,31,0.05)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {DISCIPLINES.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setDiscipline(item.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-[10px] font-medium transition-colors ${
                      discipline === item.key
                        ? "bg-[#f2e5d2] text-[#7b5023]"
                        : "text-[#8c847a] hover:bg-[#f1ede6]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex rounded-full border border-[#e0d9cf] bg-[#f1ede6] p-1">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                aria-label="Список"
                className={`grid h-7 w-8 place-items-center rounded-full ${
                  viewMode === "list"
                    ? "bg-white text-[#76502a] shadow-sm"
                    : "text-[#999086]"
                }`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("tiers")}
                aria-label="По уровням"
                className={`grid h-7 w-8 place-items-center rounded-full ${
                  viewMode === "tiers"
                    ? "bg-white text-[#76502a] shadow-sm"
                    : "text-[#999086]"
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {viewMode === "list" ? (
            <LeaderboardList entries={filtered} />
          ) : (
            <TierColumns entries={filtered} discipline={discipline} />
          )}
        </>
      )}
    </CoffeePageShell>
  );
}
