"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Users, ChevronLeft, Search, X, Check, Crown, Trophy } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  listPrivateBoards, createPrivateBoard, addBoardMember, searchUsers,
  type PrivateBoard, type UserSearchResult, type LeaderboardUser,
} from "@/lib/contest-api"

/** Display label for an account: local part of an email, else the username. */
function accountLabel(username: string) {
  return username.includes("@") ? username.split("@")[0] : username
}
function initials(s: string) {
  const base = accountLabel(s)
  return base.slice(0, 2).toUpperCase()
}

/* ─────────────── Create-board dialog ─────────────── */
function CreateBoardDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (b: PrivateBoard) => void
}) {
  const [name, setName] = useState("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Map<number, UserSearchResult>>(new Map())
  const [saving, setSaving] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) { setName(""); setQuery(""); setResults([]); setSelected(new Map()) }
  }, [open])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!query.trim()) { setResults([]); return }
    setSearching(true)
    debounce.current = setTimeout(() => {
      searchUsers(query.trim())
        .then(setResults)
        .catch((e) => toast.error(`Поиск не удался: ${e.message}`))
        .finally(() => setSearching(false))
    }, 280)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query])

  const toggle = (u: UserSearchResult) =>
    setSelected((m) => { const n = new Map(m); n.has(u.id) ? n.delete(u.id) : n.set(u.id, u); return n })

  const create = async () => {
    if (!name.trim()) { toast.error("Введите название лидерборда"); return }
    setSaving(true)
    try {
      let board = await createPrivateBoard(name.trim())
      for (const u of Array.from(selected.values())) {
        board = await addBoardMember(board.id, { userId: u.id })
      }
      toast.success(`Лидерборд «${board.name}» создан`)
      onCreated(board)
      onOpenChange(false)
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Новый приватный лидерборд</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <Input placeholder="Название (например, «Группа МатАн»)" value={name} onChange={(e) => setName(e.target.value)} />

          {/* selected chips */}
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selected.values()).map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                  {accountLabel(u.username)}
                  <button onClick={() => toggle(u)} className="text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}

          {/* player search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Найти игрока по имени или ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="max-h-52 overflow-y-auto rounded-lg border border-border divide-y divide-border min-h-[3rem]">
            {searching ? (
              <div className="flex items-center justify-center py-5 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">{query.trim() ? "Никого не найдено" : "Начните вводить имя или ID"}</p>
            ) : results.map((u) => {
              const on = selected.has(u.id)
              return (
                <button key={u.id} type="button" onClick={() => toggle(u)} className={cn("w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50", on && "bg-muted/60")}>
                  <Avatar className="h-8 w-8 shrink-0 border border-border"><AvatarFallback className="bg-muted text-[10px] font-bold">{initials(u.username)}</AvatarFallback></Avatar>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{accountLabel(u.username)}</span>
                    <span className="block text-xs text-muted-foreground truncate">ID {u.id} · {u.overall_elo} pts</span>
                  </span>
                  <span className={cn("w-5 h-5 rounded-full border flex items-center justify-center shrink-0", on ? "bg-primary border-primary" : "border-border")}>
                    {on && <Check className="w-3 h-3 text-primary-foreground" />}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">{selected.size} игрок(ов) выбрано · вы будете добавлены автоматически</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={create} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────── Board detail (ranking) ─────────────── */
function BoardDetail({ board, onBack }: { board: PrivateBoard; onBack: () => void }) {
  const ranked = useMemo(
    () => [...board.members].sort((a, b) => b.overall_elo - a.overall_elo),
    [board.members],
  )
  const rankColor = (i: number) => (i === 0 ? "text-amber-400" : i === 1 ? "text-zinc-300" : i === 2 ? "text-orange-400" : "text-muted-foreground")

  return (
    <div className="mt-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
        <ChevronLeft className="w-4 h-4" /> Все лидерборды
      </button>
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-extrabold tracking-tight">{board.name}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Владелец: {accountLabel(board.owner_name || "")} · {ranked.length} участник(ов)</p>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-[56px_1fr_90px] items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border bg-card/40">
          <span className="text-center">#</span><span>Игрок</span><span className="text-right">Рейтинг</span>
        </div>
        <div className="divide-y divide-border/60">
          {ranked.map((u: LeaderboardUser, i) => (
            <div key={u.id} className="grid grid-cols-[56px_1fr_90px] items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors">
              <span className={cn("text-center font-extrabold tabular-nums flex items-center justify-center gap-1", rankColor(i))}>
                {i === 0 && <Crown className="w-3.5 h-3.5" />}{i + 1}
              </span>
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="h-9 w-9 border border-border shrink-0"><AvatarFallback className="bg-muted text-xs font-bold">{initials(u.username)}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{accountLabel(u.username)}</p>
                  {u.id === board.owner ? <p className="text-xs text-amber-400/80">владелец</p> : <p className="text-xs text-muted-foreground truncate">ID {u.id}</p>}
                </div>
              </div>
              <span className="text-right font-bold tabular-nums">{u.overall_elo}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────── Root ─────────────── */
export function PrivateLeaderboards() {
  const [boards, setBoards] = useState<PrivateBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listPrivateBoards()
      .then(setBoards)
      .catch(() => setBoards([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const active = boards.find((b) => b.id === activeId) ?? null

  if (active) return <BoardDetail board={active} onBack={() => setActiveId(null)} />

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="text-sm text-muted-foreground">Лидерборды для твоих групп — добавляй игроков и соревнуйтесь отдельно.</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />Создать</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <Trophy className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground max-w-xs">У тебя пока нет приватных лидербордов. Создай первый и добавь игроков по имени или ID.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((b) => (
            <button key={b.id} onClick={() => setActiveId(b.id)} className="text-left rounded-xl border border-border bg-card/40 p-4 hover:bg-muted/40 hover:border-border transition-colors">
              <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-primary" /><span className="font-bold truncate">{b.name}</span></div>
              <div className="flex -space-x-2 mb-2">
                {b.members.slice(0, 5).map((m) => (
                  <Avatar key={m.id} className="h-7 w-7 border-2 border-background"><AvatarFallback className="bg-muted text-[9px] font-bold">{initials(m.username)}</AvatarFallback></Avatar>
                ))}
                {b.members.length > 5 && <span className="h-7 w-7 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[9px] font-bold">+{b.members.length - 5}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{b.members.length} участник(ов)</p>
            </button>
          ))}
        </div>
      )}

      <CreateBoardDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(b) => { load(); setActiveId(b.id) }} />
    </div>
  )
}
