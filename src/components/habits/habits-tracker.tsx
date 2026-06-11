"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Home, BarChart3, Image as ImageIcon, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Habit, api, mapHabit, COLORS, EMOJIS, greeting, getMilestone,
  cardGradient, softHaptic, GLASS, ACCENT_GRADIENT, randomPraise,
} from './lib'
import { HabitCard } from './HabitCard'
import { HabitDetailModal } from './HabitDetailModal'
import { Analytics } from './Analytics'
import { Gallery } from './Gallery'

type View = 'today' | 'stats' | 'gallery'

/* ───────────────────────── Energy / balance bar ───────────────────────── */

function EnergyBar({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? done / total : 0
  const pct = Math.round(ratio * 100)
  const label =
    total === 0 ? 'Добавь первую привычку'
      : ratio === 1 ? 'Идеальный баланс! 🎉'
      : ratio >= 0.6 ? 'Отличный темп, продолжай'
      : ratio > 0 ? 'Хорошее начало дня'
      : 'Начни с маленького шага'

  return (
    <div className={cn(GLASS, 'rounded-[24px] p-5')}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-amber-400" /> Баланс дня
        </span>
        <span className="text-sm font-semibold tabular-nums">{done} / {total}</span>
      </div>
      <div className="h-3.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: ACCENT_GRADIENT, boxShadow: '0 0 18px rgba(240,171,252,0.6)' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-2.5">{label}</p>
    </div>
  )
}

/* ───────────────────────── Add / edit form ───────────────────────── */

function HabitForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<Habit>
  onSave: (data: { name: string; emoji: string; color: string; goal_text: string; freeze_budget: number }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [goal, setGoal] = useState(initial?.goalText ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '✨')
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
  const [freeze, setFreeze] = useState(initial?.freezeBudget ?? 2)

  return (
    <div className="flex flex-col gap-4 mt-1">
      {/* Live preview */}
      <div className="rounded-2xl p-4 text-white" style={{ background: cardGradient(color) }}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">{emoji}</span>
          <div>
            <div className="font-semibold">{name || 'Название привычки'}</div>
            {goal && <div className="text-xs text-white/85">🎯 {goal}</div>}
          </div>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Название</label>
        <Input placeholder="Например: Читать" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Микро-цель <span className="text-muted-foreground font-normal">(необязательно)</span></label>
        <Input placeholder="хотя бы 5 минут" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <p className="text-xs text-muted-foreground mt-1">Маленький порог проще выполнять каждый день</p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Иконка</label>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => setEmoji(e)}
              className={cn('w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all hover:scale-110',
                emoji === e ? 'bg-muted ring-2 ring-offset-1 ring-foreground/20' : 'hover:bg-muted')}>
              {e}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Цвет</label>
        <div className="flex gap-2 flex-wrap">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}
              className={cn('w-8 h-8 rounded-full transition-all hover:scale-110', color === c && 'ring-2 ring-offset-2 ring-foreground/30')}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Гибкость серии</label>
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <button key={n} onClick={() => setFreeze(n)}
              className={cn('flex-1 py-2 rounded-xl text-sm border transition-all',
                freeze === n ? 'border-foreground/40 bg-muted font-semibold' : 'hover:bg-muted')}>
              {n === 0 ? 'Строго' : `🛡 ${n}`}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Сколько пропусков переживёт серия, не сбрасываясь в ноль</p>
      </div>

      <div className="flex gap-2 mt-1">
        <Button variant="outline" onClick={onClose} className="flex-1">Отмена</Button>
        <Button
          onClick={() => name.trim() && onSave({ name: name.trim(), emoji, color, goal_text: goal.trim(), freeze_budget: freeze })}
          disabled={!name.trim()}
          className="flex-1 text-white"
          style={{ backgroundColor: color }}
        >
          {initial?.id ? 'Сохранить' : 'Добавить'}
        </Button>
      </div>
    </div>
  )
}

/* ───────────────────────── Bottom tab bar ───────────────────────── */

function TabBar({ view, setView }: { view: View; setView: (v: View) => void }) {
  const tabs: { id: View; icon: React.ReactNode }[] = [
    { id: 'today', icon: <Home className="w-5 h-5" /> },
    { id: 'stats', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'gallery', icon: <ImageIcon className="w-5 h-5" /> },
  ]
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-1 p-1.5 rounded-full bg-white/70 dark:bg-white/[0.08] backdrop-blur-2xl border border-white/60 dark:border-white/10 shadow-[0_12px_40px_rgba(15,23,42,0.18)]">
        {tabs.map((t) => (
          <motion.button
            key={t.id}
            whileTap={{ scale: 0.88 }}
            onClick={() => { softHaptic(); setView(t.id) }}
            className={cn(
              'relative w-12 h-12 rounded-full flex items-center justify-center transition-colors',
              view === t.id ? 'text-white' : 'text-muted-foreground hover:text-foreground'
            )}
            aria-label={t.id}
          >
            {view === t.id && (
              <motion.span
                layoutId="tabactive"
                className="absolute inset-0 rounded-full"
                style={{ background: ACCENT_GRADIENT, boxShadow: '0 6px 18px rgba(240,171,252,0.5)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
            <span className="relative z-10">{t.icon}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────── Main ───────────────────────── */

export function HabitsTracker() {
  const { data: session } = useSession()
  const email = session?.user?.email ?? 'dev@timely.app'
  const firstName = (session?.user?.name ?? '').split(' ')[0]

  const [habits, setHabits] = useState<Habit[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('today')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Habit | null>(null)
  const [detail, setDetail] = useState<Habit | null>(null)

  const fetchHabits = useCallback(async () => {
    const res = await api('/', email)
    if (res.ok) setHabits((await res.json()).map(mapHabit))
    setLoading(false)
  }, [email])

  useEffect(() => { fetchHabits() }, [fetchHabits])

  const replaceHabit = (h: Habit) => setHabits((prev) => prev.map((x) => (x.id === h.id ? h : x)))

  const handleSave = async (data: { name: string; emoji: string; color: string; goal_text: string; freeze_budget: number }) => {
    if (editing) {
      const res = await api(`/${editing.id}/`, email, { method: 'PATCH', body: JSON.stringify(data) })
      if (res.ok) { toast.success('Привычка обновлена'); fetchHabits() }
    } else {
      const res = await api('/', email, { method: 'POST', body: JSON.stringify(data) })
      if (res.ok) { toast.success('Привычка добавлена'); fetchHabits() }
    }
    setDialogOpen(false); setEditing(null)
  }

  const handleToggle = async (id: number) => {
    const target = habits.find((h) => h.id === id)
    const wasDone = target?.doneToday
    // optimistic
    setHabits((prev) => prev.map((h) => h.id === id ? {
      ...h, doneToday: !h.doneToday,
      streak: !h.doneToday ? h.streak + 1 : Math.max(0, h.streak - 1),
    } : h))
    const res = await api(`/${id}/toggle/`, email, { method: 'POST' })
    if (res.ok) {
      const updated = mapHabit(await res.json())
      replaceHabit(updated)
      if (!wasDone) {
        const ms = getMilestone(updated.streak)
        toast.success(ms && updated.streak >= 3 ? ms : randomPraise())
      }
    } else fetchHabits()
  }

  const handleDelete = async (id: number) => {
    setHabits((prev) => prev.filter((h) => h.id !== id))
    await api(`/${id}/`, email, { method: 'DELETE' })
    toast.success('Привычка удалена')
  }

  const doneToday = habits.filter((h) => h.doneToday).length
  const bestStreak = habits.reduce((m, h) => Math.max(m, h.streak), 0)

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* Header bento */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-plus-jakarta text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            {greeting()}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {view === 'today' && 'Маленькие шаги каждый день — большие перемены'}
            {view === 'stats' && 'Твой прогресс в цифрах и на карте'}
            {view === 'gallery' && 'Визуальная история твоих достижений'}
          </p>
        </div>
        {!loading && habits.length > 0 && view === 'today' && (
          <div className={cn(GLASS, 'rounded-2xl px-4 py-2.5 flex items-center gap-2 shrink-0')}>
            <span className="text-2xl">🔥</span>
            <div className="leading-none">
              <div className="text-xl font-bold tabular-nums">{bestStreak}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">лучший стрик</div>
            </div>
          </div>
        )}
      </div>

      {!loading && habits.length > 0 && view === 'today' && (
        <EnergyBar done={doneToday} total={habits.length} />
      )}

      {/* Views */}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <div key={i} className={cn(GLASS, 'rounded-[28px] h-40 animate-pulse')} />)}
            </div>
          ) : view === 'today' ? (
            habits.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="text-5xl mb-4">🌱</span>
                <h3 className="text-lg font-semibold mb-1">Пока нет привычек</h3>
                <p className="text-muted-foreground text-sm mb-6">Добавь первую — маленький шаг каждый день меняет жизнь</p>
                <Button onClick={() => { setEditing(null); setDialogOpen(true) }} className="gap-2">
                  <Plus className="w-4 h-4" /> Добавить привычку
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                {habits.map((h) => (
                  <HabitCard key={h.id} habit={h} onToggle={handleToggle} onOpen={setDetail} />
                ))}
                <motion.button
                  whileHover={{ y: -4, scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  onClick={() => { setEditing(null); setDialogOpen(true) }}
                  className="rounded-[28px] border-2 border-dashed border-foreground/15 bg-white/30 dark:bg-white/[0.03] backdrop-blur-sm p-5 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors min-h-[150px]"
                >
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-white" style={{ background: ACCENT_GRADIENT }}>
                    <Plus className="w-5 h-5" />
                  </span>
                  <span className="text-sm font-medium">Новая привычка</span>
                </motion.button>
              </div>
            )
          ) : view === 'stats' ? (
            habits.length === 0
              ? <p className="text-muted-foreground text-sm text-center py-20">Добавь привычки, чтобы увидеть аналитику</p>
              : <Analytics habits={habits} />
          ) : (
            <Gallery email={email} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Tab bar */}
      <TabBar view={view} setView={setView} />

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null) }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto bg-white/80 dark:bg-[#13131a]/80 backdrop-blur-2xl border-white/60 dark:border-white/10">
          <DialogHeader>
            <DialogTitle className="font-plus-jakarta text-xl">{editing ? 'Редактировать привычку' : 'Новая привычка'}</DialogTitle>
          </DialogHeader>
          <HabitForm
            initial={editing ?? undefined}
            onSave={handleSave}
            onClose={() => { setDialogOpen(false); setEditing(null) }}
          />
        </DialogContent>
      </Dialog>

      {/* Detail modal */}
      {detail && (
        <HabitDetailModal
          habit={habits.find((h) => h.id === detail.id) ?? detail}
          email={email}
          onClose={() => setDetail(null)}
          onChanged={replaceHabit}
          onEdit={(h) => { setDetail(null); setEditing(h); setDialogOpen(true) }}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
