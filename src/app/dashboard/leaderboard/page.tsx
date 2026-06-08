"use client";

import React, { useState, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Trophy,
  Sigma,
  Atom,
  Code2,
  BookOpen,
  Flame,
  Search,
  List,
  LayoutGrid,
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────── */

type DisciplineKey = "overall" | "math" | "physics" | "programming";
type ViewMode = "list" | "tiers";

interface DisciplineTier {
  discipline: DisciplineKey;
  tier: string;
}

interface LeaderboardEntry {
  id: string;
  username: string;
  avatarUrl?: string;
  title: string;
  points: number;
  region: string;
  tiers: DisciplineTier[];
}

/* ─── Discipline metadata ──────────────────────────────── */

const DISCIPLINES: {
  key: DisciplineKey;
  label: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  { key: "overall", label: "Overall", icon: <Trophy className="w-5 h-5" />, color: "text-amber-500" },
  { key: "math", label: "Math", icon: <Sigma className="w-5 h-5" />, color: "text-blue-500" },
  { key: "physics", label: "Physics", icon: <Atom className="w-5 h-5" />, color: "text-emerald-500" },
  { key: "programming", label: "Coding", icon: <Code2 className="w-5 h-5" />, color: "text-violet-500" },
];

/* ─── Tier helpers ─────────────────────────────────────── */

const TIER_ORDER = ["HT1", "HT2", "HT3", "HT4", "HT5", "LT1", "LT2", "LT3", "LT4", "LT5"];
const TIER_LABELS: Record<string, string> = {
  HT1: "Tier 1", HT2: "Tier 2", HT3: "Tier 3", HT4: "Tier 4", HT5: "Tier 5",
  LT1: "Tier 6", LT2: "Tier 7", LT3: "Tier 8", LT4: "Tier 9", LT5: "Tier 10",
};

function tierBgClass(tier: string): string {
  if (tier === "HT1") return "bg-gradient-to-r from-amber-500 to-red-500 text-white";
  if (tier === "HT2") return "bg-gradient-to-r from-orange-500 to-rose-500 text-white";
  if (tier === "HT3") return "bg-gradient-to-r from-orange-400 to-amber-500 text-white";
  if (tier === "HT4") return "bg-gradient-to-r from-yellow-400 to-orange-400 text-white";
  if (tier === "HT5") return "bg-gradient-to-r from-lime-400 to-green-500 text-white";
  if (tier === "LT1") return "bg-sky-500/80 text-white";
  if (tier === "LT2") return "bg-blue-500/70 text-white";
  if (tier === "LT3") return "bg-indigo-500/60 text-white";
  if (tier === "LT4") return "bg-slate-500/60 text-white";
  if (tier === "LT5") return "bg-slate-600/50 text-white";
  return "bg-muted text-muted-foreground";
}

function tierColumnHeaderBg(tier: string): string {
  if (tier === "HT1") return "bg-gradient-to-r from-amber-500 to-red-500 text-white";
  if (tier === "HT2") return "bg-gradient-to-br from-orange-500/20 to-rose-500/10 text-orange-400 border-orange-500/30";
  if (tier === "HT3") return "bg-gradient-to-r from-orange-400 to-amber-500 text-white";
  if (tier === "HT4") return "text-yellow-400 border-yellow-500/20";
  if (tier === "HT5") return "text-lime-400 border-lime-500/20";
  if (tier === "LT1") return "text-sky-400 border-sky-500/20";
  if (tier === "LT2") return "text-blue-400 border-blue-500/20";
  if (tier === "LT3") return "text-indigo-400 border-indigo-500/20";
  if (tier === "LT4") return "text-slate-400 border-slate-500/20";
  if (tier === "LT5") return "text-slate-500 border-slate-600/20";
  return "";
}

function rankBg(rank: number): string {
  if (rank === 1) return "bg-amber-500 text-black";
  if (rank === 2) return "bg-slate-400 text-black";
  if (rank === 3) return "bg-amber-700 text-white";
  return "bg-muted text-muted-foreground";
}

const disciplineIcon = (key: DisciplineKey, size = "w-4 h-4"): React.ReactNode => {
  const cls = `${size} opacity-60`;
  switch (key) {
    case "overall": return <Trophy className={cls} />;
    case "math": return <Sigma className={cls} />;
    case "physics": return <Atom className={cls} />;
    case "programming": return <Code2 className={cls} />;
  }
};

/* ─── Mock data ────────────────────────────────────────── */

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  {
    id: "1", username: "ItzRealBekzhan", title: "Grandmaster", points: 330, region: "CIS",
    tiers: [
      { discipline: "overall", tier: "HT3" },
      { discipline: "math", tier: "HT1" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "2", username: "coldified", title: "Grandmaster", points: 326, region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT1" },
      { discipline: "math", tier: "LT1" },
      { discipline: "physics", tier: "LT3" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "3", username: "MathWizard", title: "Grandmaster", points: 290, region: "NA",
    tiers: [
      { discipline: "overall", tier: "HT3" },
      { discipline: "math", tier: "HT1" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "LT3" },
    ],
  },
  {
    id: "4", username: "janekv", title: "Master", points: 260, region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT3" },
      { discipline: "math", tier: "HT4" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "HT2" },
    ],
  },
  {
    id: "5", username: "BlvckPhysics", title: "Expert", points: 226, region: "EU",
    tiers: [
      { discipline: "overall", tier: "HT2" },
      { discipline: "math", tier: "HT3" },
      { discipline: "physics", tier: "HT1" },
      { discipline: "programming", tier: "LT2" },
    ],
  },
  {
    id: "6", username: "CodeKylaz", title: "Expert", points: 226, region: "NA",
    tiers: [
      { discipline: "overall", tier: "HT3" },
      { discipline: "math", tier: "LT3" },
      { discipline: "physics", tier: "LT3" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "7", username: "ninorc15", title: "Expert", points: 211, region: "EU",
    tiers: [
      { discipline: "overall", tier: "HT1" },
      { discipline: "math", tier: "LT3" },
      { discipline: "physics", tier: "LT1" },
      { discipline: "programming", tier: "LT2" },
    ],
  },
  {
    id: "8", username: "quantum_leap", title: "Specialist", points: 186, region: "CIS",
    tiers: [
      { discipline: "overall", tier: "LT3" },
      { discipline: "math", tier: "LT4" },
      { discipline: "physics", tier: "HT2" },
      { discipline: "programming", tier: "HT3" },
    ],
  },
  {
    id: "9", username: "yMiau", title: "Specialist", points: 170, region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT3" },
      { discipline: "math", tier: "LT3" },
      { discipline: "physics", tier: "LT2" },
      { discipline: "programming", tier: "LT1" },
    ],
  },
  {
    id: "10", username: "AlgoKing", title: "Master", points: 270, region: "NA",
    tiers: [
      { discipline: "overall", tier: "HT2" },
      { discipline: "math", tier: "HT2" },
      { discipline: "physics", tier: "LT4" },
      { discipline: "programming", tier: "HT1" },
    ],
  },
  {
    id: "11", username: "euler_fn", title: "Specialist", points: 165, region: "EU",
    tiers: [
      { discipline: "overall", tier: "LT4" },
      { discipline: "math", tier: "HT3" },
      { discipline: "physics", tier: "LT5" },
      { discipline: "programming", tier: "LT4" },
    ],
  },
  {
    id: "12", username: "DarkMatter", title: "Expert", points: 205, region: "CIS",
    tiers: [
      { discipline: "overall", tier: "HT4" },
      { discipline: "math", tier: "LT2" },
      { discipline: "physics", tier: "HT3" },
      { discipline: "programming", tier: "LT5" },
    ],
  },
  {
    id: "13", username: "TensorBoy", title: "Specialist", points: 155, region: "NA",
    tiers: [
      { discipline: "overall", tier: "LT5" },
      { discipline: "math", tier: "LT5" },
      { discipline: "physics", tier: "HT5" },
      { discipline: "programming", tier: "HT4" },
    ],
  },
  {
    id: "14", username: "Pitonchik", title: "Master", points: 250, region: "CIS",
    tiers: [
      { discipline: "overall", tier: "HT5" },
      { discipline: "math", tier: "HT5" },
      { discipline: "physics", tier: "HT4" },
      { discipline: "programming", tier: "HT2" },
    ],
  },
];

/* ─── TierBadge ────────────────────────────────────────── */

function TierBadge({ tier, small = false }: { tier: string; small?: boolean }) {
  const isHigh = tier.startsWith("HT");
  const px = small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";

  return (
    <span className={`inline-flex items-center gap-0.5 rounded font-bold tracking-wide ${px} ${tierBgClass(tier)}`}>
      {isHigh && <Flame className={small ? "w-2.5 h-2.5" : "w-3 h-3"} />}
      {tier}
    </span>
  );
}

/* ─── RegionBadge ──────────────────────────────────────── */

function RegionBadge({ region }: { region: string }) {
  const bg =
    region === "NA"
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : region === "EU"
        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
        : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";

  return (
    <span className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-bold ${bg}`}>
      {region}
    </span>
  );
}

/* ─── Tiers Column View ────────────────────────────────── */

function TiersColumnView({
  entries,
  discipline,
}: {
  entries: LeaderboardEntry[];
  discipline: DisciplineKey;
}) {
  // Group entries by their tier in this discipline
  const grouped = useMemo(() => {
    const map: Record<string, LeaderboardEntry[]> = {};
    for (const tier of TIER_ORDER) {
      map[tier] = [];
    }
    for (const entry of entries) {
      const dt = entry.tiers.find((t) => t.discipline === discipline);
      if (dt && map[dt.tier]) {
        map[dt.tier].push(entry);
      }
    }
    return map;
  }, [entries, discipline]);

  // Only show tiers that have at least one player
  const activeTiers = TIER_ORDER.filter((t) => grouped[t].length > 0);

  return (
    <div className="mt-6 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(activeTiers.length, 5)}, 1fr)` }}>
      {activeTiers.map((tier) => (
        <div key={tier} className="rounded-xl border border-border/50 overflow-hidden bg-card/30">
          {/* Column header */}
          <div className={`flex items-center justify-center gap-2 py-3 px-2 font-extrabold text-sm border-b border-border/30 ${tierColumnHeaderBg(tier)}`}>
            {tier.startsWith("HT") && <Trophy className="w-4 h-4" />}
            {TIER_LABELS[tier] || tier}
          </div>

          {/* Player list */}
          <div className="divide-y divide-border/20">
            {grouped[tier].map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <Avatar className="h-7 w-7 shrink-0 border border-border/50">
                  <AvatarImage src={entry.avatarUrl} alt={entry.username} />
                  <AvatarFallback className="bg-muted text-[10px] font-bold">
                    {entry.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-semibold truncate">{entry.username}</span>
                <Flame className="w-3 h-3 text-muted-foreground/40 ml-auto shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── List View ────────────────────────────────────────── */

function ListView({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <>
      {/* Table header */}
      <div className="mt-6 grid grid-cols-[60px_1fr_80px_1fr] items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50">
        <span className="text-center">#</span>
        <span>Player</span>
        <span className="text-center">Region</span>
        <span className="text-center">Tiers</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border/30">
        {entries.map((entry, i) => {
          const rank = i + 1;
          return (
            <div
              key={entry.id}
              className="group grid grid-cols-[60px_1fr_80px_1fr] items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/30"
            >
              {/* Rank */}
              <div className="flex justify-center">
                <span className={`flex items-center justify-center w-9 h-9 rounded-lg text-sm font-extrabold ${rankBg(rank)}`}>
                  {rank}.
                </span>
              </div>

              {/* Player */}
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-11 w-11 border-2 border-border/50 shrink-0">
                  <AvatarImage src={entry.avatarUrl} alt={entry.username} />
                  <AvatarFallback className="bg-muted text-xs font-bold">
                    {entry.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{entry.username}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    {entry.title}
                    <span className="text-muted-foreground/60">({entry.points} points)</span>
                  </p>
                </div>
              </div>

              {/* Region */}
              <div className="flex justify-center">
                <RegionBadge region={entry.region} />
              </div>

              {/* Tiers row */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {DISCIPLINES.map((d) => {
                  const found = entry.tiers.find((t) => t.discipline === d.key);
                  if (!found) {
                    return (
                      <span key={d.key} className="flex flex-col items-center gap-0.5">
                        <span className="opacity-40">{disciplineIcon(d.key, "w-4 h-4")}</span>
                        <span className="text-[10px] text-muted-foreground/40">—</span>
                      </span>
                    );
                  }
                  return (
                    <span key={d.key} className="flex flex-col items-center gap-0.5">
                      <span className="opacity-60">{disciplineIcon(d.key, "w-4 h-4")}</span>
                      <TierBadge tier={found.tier} small />
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {entries.length === 0 && (
          <div className="py-16 text-center text-muted-foreground">
            No players found.
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Page ─────────────────────────────────────────────── */

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<DisciplineKey>("overall");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      MOCK_LEADERBOARD.filter((e) =>
        e.username.toLowerCase().includes(search.toLowerCase())
      ),
    [search]
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <div className="border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-extrabold tracking-tight">Rankings</h1>
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search player…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        {/* ── Discipline Tabs + View Toggle ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              setActiveTab(v as DisciplineKey);
              // Reset to list when switching to "overall"
              if (v === "overall") setViewMode("list");
            }}
            className="w-full sm:w-auto"
          >
            <TabsList className="h-auto p-1.5 bg-muted/50 rounded-xl flex flex-wrap gap-1">
              {DISCIPLINES.map((d) => (
                <TabsTrigger
                  key={d.key}
                  value={d.key}
                  className="flex flex-col items-center gap-1 px-5 py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
                >
                  <span className={d.color}>{d.icon}</span>
                  <span className="text-xs font-medium">{d.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* View mode toggle — only show for specific disciplines */}
          {activeTab !== "overall" && (
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === "list"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="w-3.5 h-3.5" />
                List
              </button>
              <button
                onClick={() => setViewMode("tiers")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === "tiers"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Tiers
              </button>
            </div>
          )}
        </div>

        {/* ── Content ── */}
        {viewMode === "tiers" && activeTab !== "overall" ? (
          <TiersColumnView entries={filtered} discipline={activeTab} />
        ) : (
          <ListView entries={filtered} />
        )}
      </div>
    </div>
  );
}
