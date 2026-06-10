"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trophy,
  Star,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from "lucide-react";

/* ─── Types ────────────────────────────────────────────── */

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
  avatarUrl?: string;
}

/* ─── Mock Data ────────────────────────────────────────── */

const UPCOMING_CONTESTS = [
  {
    id: 1,
    name: "Weekly Contest 505",
    date: "Sun, Jun 7, 08:30 GMT+06:00",
    countdown: "04:02:14:03",
    gradient: "from-violet-600/40 via-purple-500/20 to-indigo-600/30",
    bannerImage: "/contest/bgc/left-side-banner.png",
  },
  {
    id: 2,
    name: "Weekly Contest 505",
    date: "Sun, Jun 7, 08:30 GMT+06:00",
    countdown: "04:02:14:19",
    gradient: "from-cyan-600/40 via-teal-500/20 to-blue-600/30",
    bannerImage: "/contest/bgc/right-side-banner.png",
  },
];

const PAST_CONTESTS: ContestEntry[] = [
  { id: 504, name: "Weekly Contest 504", date: "Sun, May 31, 08:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 503, name: "Weekly Contest 503", date: "Sun, May 24, 08:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 183, name: "Biweekly Contest 183", date: "Sat, May 23, 20:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 502, name: "Weekly Contest 502", date: "Sun, May 17, 08:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 501, name: "Weekly Contest 501", date: "Sun, May 10, 08:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 182, name: "Biweekly Contest 182", date: "Sat, May 9, 20:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 500, name: "Weekly Contest 500", date: "Sun, May 3, 08:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
  { id: 499, name: "Weekly Contest 499", date: "Sun, Apr 26, 08:30 GMT+06:00", score: "0", total: "4", type: "Virtual" },
];

const MY_CONTESTS: ContestEntry[] = [
  { id: 501, name: "Weekly Contest 501", date: "Sun, May 10, 08:30 GMT+06:00", score: "3", total: "4", type: "Live" },
  { id: 499, name: "Weekly Contest 499", date: "Sun, Apr 26, 08:30 GMT+06:00", score: "2", total: "4", type: "Live" },
];

const TOP_3: RankedUser[] = [
  { rank: 2, username: "Bekadka KG", country: "KG", rating: 6767, attended: 107, avatarUrl: "" },
  { rank: 1, username: "Bekadka KG", country: "KG", rating: 6767, attended: 107, avatarUrl: "" },
  { rank: 3, username: "Bekadka KG", country: "KG", rating: 6767, attended: 107, avatarUrl: "" },
];

const RANKED_USERS: RankedUser[] = Array.from({ length: 7 }, (_, i) => ({
  rank: i + 4,
  username: "小羊肖恩",
  country: "CN",
  rating: 3611,
  attended: 107,
  avatarUrl: "",
}));

/* ─── Helpers ──────────────────────────────────────────── */

function getMedalStyle(rank: number) {
  if (rank === 1) return { svg: "gold.svg", size: "w-28 h-36" };
  if (rank === 2) return { svg: "silver.svg", size: "w-24 h-32" };
  return { svg: "bronze.svg", size: "w-24 h-32" };
}

/* ─── Star Background ─────────────────────────────────── */

function StarField() {
  return (
    <div 
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: 'url("/contest/items/bgc.svg")',
        backgroundSize: 'cover',
        backgroundPosition: 'top center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

/* ─── Contest Card (Upcoming) ──────────────────────────── */

function UpcomingCard({ contest }: { contest: typeof UPCOMING_CONTESTS[0] }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br ${contest.gradient} flex-1 group cursor-pointer flex flex-col transition-[transform,border-color] duration-300 ease-out hover:border-white/[0.12] hover:scale-[1.015]`}
      style={{ aspectRatio: '303 / 194', willChange: 'transform', transform: 'translateZ(0)' }}
    >
      {/* 3D Banner Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src={contest.bannerImage}
          alt={contest.name}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 100vw, 50vw"
          priority
        />
      </div>

      {/* Countdown badge */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-black/30 backdrop-blur-md rounded-full px-3 py-1.5 text-[11px] font-mono text-white/90 shadow-sm border border-white/10">
        <Image src="/contest/items/sand_time.svg" alt="Timer" width={14} height={14} className="opacity-70" />
        {contest.countdown}
      </div>

      {/* Spacer to push content down */}
      <div className="flex-1 z-10"></div>

      {/* ── Glassmorphism bottom panel ── */}
      {/* Layer 1: lightest blur, covers most area (smooth fade start) */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[5] h-[65%] backdrop-blur-[2px] pointer-events-none"
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)' }}
      />
      {/* Layer 2: medium blur */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[6] h-[55%] backdrop-blur-[6px] pointer-events-none"
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)' }}
      />
      {/* Layer 3: strong blur at the very bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[7] h-[45%] backdrop-blur-[16px] pointer-events-none"
        style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)' }}
      />
      {/* Layer 4: color tint overlay */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[8] h-[65%] pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(120, 90, 180, 0.45) 0%, rgba(120, 90, 180, 0.15) 50%, transparent 100%)',
        }}
      />

      {/* Content on top */}
      <div className="relative z-10 mt-auto flex items-center justify-between pt-20 pb-5 px-5 font-inter">
        <div>
          <p className="text-[15px] font-bold text-white tracking-tight">{contest.name}</p>
          <p className="text-[11px] text-white/60 mt-0.5">{contest.date}</p>
        </div>
        <button className="flex items-center justify-center w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] transition-colors backdrop-blur-sm">
          <Image src="/contest/items/alarm.svg" alt="Alarm" width={16} height={16} className="opacity-80" />
        </button>
      </div>
    </div>
  );
}

/* ─── Podium ───────────────────────────────────────────── */

function PodiumUser({ user, rank }: { user: RankedUser; rank: number }) {
  // Rank-specific styling
  const config = {
    1: {
      svg: "gold.svg",
      avatarSize: "w-[100px] h-[100px]",
      ringColor: "ring-[#F0CC68]",
      ringWidth: "ring-[3px]",
      badgeSize: "w-[50px] h-[66px]",
      mt: "mt-0",
      mb: "mb-[-16px]",
      nameBg: "bg-[#F0CC68]/15 border border-[#F0CC68]/30",
      nameColor: "text-[#F0CC68]",
    },
    2: {
      svg: "silver.svg",
      avatarSize: "w-[80px] h-[80px]",
      ringColor: "ring-[#C0C0C0]",
      ringWidth: "ring-[3px]",
      badgeSize: "w-[40px] h-[53px]",
      mt: "mt-8",
      mb: "mb-[-12px]",
      nameBg: "bg-white/[0.06] border border-white/[0.08]",
      nameColor: "text-white/70",
    },
    3: {
      svg: "bronze.svg",
      avatarSize: "w-[80px] h-[80px]",
      ringColor: "ring-[#CD7F32]",
      ringWidth: "ring-[3px]",
      badgeSize: "w-[40px] h-[53px]",
      mt: "mt-14",
      mb: "mb-[-12px]",
      nameBg: "bg-white/[0.06] border border-white/[0.08]",
      nameColor: "text-white/70",
    },
  }[rank]!;

  return (
    <div className={`flex flex-col items-center ${config.mt}`}>
      {/* Crown / Winner badge */}
      <div className={`relative ${config.badgeSize} ${config.mb} z-10`}>
        <Image
          src={`/contest/items/${config.svg}`}
          alt={`Rank ${rank}`}
          fill
          className="object-contain drop-shadow-sm"
        />
      </div>

      {/* Avatar circle with colored ring */}
      <div className={`relative ${config.avatarSize} rounded-full ${config.ringWidth} ${config.ringColor} overflow-hidden bg-[#1a1a2e] flex items-center justify-center shadow-lg`}>
        {user.avatarUrl ? (
          <Avatar className="w-full h-full">
            <AvatarImage src={user.avatarUrl} />
            <AvatarFallback className="bg-gradient-to-b from-blue-500 to-blue-700 text-white font-bold text-xl">
              {user.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="w-full h-full rounded-full bg-gradient-to-b from-blue-500 to-blue-700 flex items-center justify-center">
            <span className="text-white font-bold text-xl">
              {user.username.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Name plate */}
      <div className={`mt-3 rounded-xl px-4 py-2 text-center ${config.nameBg} min-w-[90px]`}>
        <p className="text-xs font-semibold text-white truncate max-w-[100px]">
          {user.username}
        </p>
        <p className={`text-[11px] font-bold font-mono ${config.nameColor}`}>
          {user.rating}
        </p>
      </div>
    </div>
  );
}

function Podium() {
  // Display order: 2nd (left), 1st (center, highest), 3rd (right, lowest)
  return (
    <div className="flex items-start justify-center gap-6 mt-4 mb-10">
      <PodiumUser user={TOP_3[0]} rank={2} />
      <PodiumUser user={TOP_3[1]} rank={1} />
      <PodiumUser user={TOP_3[2]} rank={3} />
    </div>
  );
}

/* ─── Ranking Row ──────────────────────────────────────── */

function RankingRow({ user }: { user: RankedUser }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors group">
      {/* Rank */}
      <span className="flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.06] text-xs font-bold text-white/70 shrink-0">
        {user.rank}
      </span>

      {/* Avatar */}
      <Avatar className="w-8 h-8 shrink-0 border border-white/10">
        <AvatarFallback className="bg-white/[0.06] text-white/60 text-xs font-bold">
          {user.username.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Name */}
      <span className="text-sm font-medium text-white/80 flex-1 truncate">
        {user.username}
      </span>

      {/* Stats */}
      <div className="text-right shrink-0">
        <p className="text-xs font-bold text-white/90">
          Rating: <span className="text-amber-400">{user.rating}</span>
        </p>
        <p className="text-[10px] text-white/40">Attended: {user.attended}</p>
      </div>
    </div>
  );
}

/* ─── Contest List (Right side) ─────────────────────────── */

function ContestIcon() {
  return (
    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
      <Trophy className="w-5 h-5 text-white" />
    </div>
  );
}

function ContestList() {
  const [tab, setTab] = useState<"past" | "my">("past");
  const [page, setPage] = useState(1);
  const totalPages = 87;

  const contests = tab === "past" ? PAST_CONTESTS : MY_CONTESTS;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#1a1a1e] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setTab("past"); setPage(1); }}
            className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${
              tab === "past"
                ? "border-white text-white"
                : "border-transparent text-white/40 hover:text-white/60"
            }`}
          >
            Past Contests
          </button>
          <button
            onClick={() => { setTab("my"); setPage(1); }}
            className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${
              tab === "my"
                ? "border-white text-white"
                : "border-transparent text-white/40 hover:text-white/60"
            }`}
          >
            My Contests
          </button>
        </div>
        <button className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors">
          <Maximize2 className="w-3.5 h-3.5 text-white/40" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 divide-y divide-white/[0.04] px-2">
        {contests.map((c) => (
          <div
            key={`${c.id}-${c.type}`}
            className="flex items-center gap-3 px-3 py-3 hover:bg-white/[0.03] rounded-lg transition-colors cursor-pointer"
          >
            <ContestIcon />

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{c.name}</p>
              <p className="text-[11px] text-white/40 mt-0.5">{c.date}</p>
            </div>

            <span className="text-xs text-white/50 font-mono shrink-0">
              {c.score} / {c.total}
            </span>

            <span className={`text-xs font-bold shrink-0 ${
              c.type === "Virtual" ? "text-cyan-400" : "text-emerald-400"
            }`}>
              {c.type}
            </span>
          </div>
        ))}

        {contests.length === 0 && (
          <div className="py-12 text-center text-white/30 text-sm">
            No contests found.
          </div>
        )}
      </div>

      {/* Pagination */}
      {tab === "past" && (
        <div className="flex items-center justify-center gap-1.5 py-3 border-t border-white/[0.04]">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {[1, 2, 3, 4].map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                page === p
                  ? "bg-blue-500 text-white"
                  : "text-white/40 hover:text-white/60 hover:bg-white/10"
              }`}
            >
              {p}
            </button>
          ))}

          <span className="text-white/20 text-xs px-1">…</span>

          <button
            onClick={() => setPage(totalPages)}
            className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
              page === totalPages
                ? "bg-blue-500 text-white"
                : "text-white/40 hover:text-white/60 hover:bg-white/10"
            }`}
          >
            {totalPages}
          </button>

          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            className="w-7 h-7 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────── */

export default function ContestsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white relative">
      <StarField />

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
        {/* ── Hero ── */}
        <section className="flex flex-col items-center text-center pt-32 pb-24">
          <Image
            src="/contest/items/throphy.png"
            alt="Trophy"
            width={160}
            height={160}
            className="mb-10 drop-shadow-[0_0_30px_rgba(255,180,0,0.3)]"
            priority
          />
          <h1 className="text-[40px] font-normal font-onest">
            Timely Contest
          </h1>
          <p className="mt-2 text-[#949494] text-base max-w-md font-plus-jakarta">
            Contests every week. Compete and see your ranking!
          </p>
        </section>

        {/* ── Upcoming Contests ── */}
        <section className="flex flex-col sm:flex-row gap-5 justify-center max-w-6xl mx-auto mb-16">
          {UPCOMING_CONTESTS.map((c) => (
            <UpcomingCard key={c.id} contest={c} />
          ))}
        </section>

        {/* ── CTA ── */}
        <div className="flex items-center justify-center gap-2 mb-28 text-[#949494] text-[15px] font-plus-jakarta">
          <Image
            src="/contest/items/handshake.svg"
            alt="Handshake"
            width={20}
            height={12}
            className="opacity-70"
          />
          <span>Be a contributor and earn ELO.</span>
        </div>

        {/* ── Two-column layout ── */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-16">
          {/* Left: Podium + Rankings */}
          <div>
            <Podium />

            <div className="space-y-1">
              {RANKED_USERS.map((user) => (
                <RankingRow key={user.rank} user={user} />
              ))}
            </div>

            <button className="mt-4 w-full text-center text-sm text-white/30 hover:text-white/50 transition-colors py-2">
              Show More
            </button>
          </div>

          {/* Right: Contest list */}
          <ContestList />
        </section>
      </div>
    </div>
  );
}
