"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { BACKEND_URL } from '@/lib/api-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Check, Flame, Plus, Trash2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CalendarDay {
  date: string
  done: boolean
}

interface Habit {
  id: number
  name: string
  emoji: string
  color: string
  streak: number
  doneToday: boolean
  totalDone: number
  calendar: CalendarDay[]
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#06b6d4',
]

const EMOJIS = ['✨', '💪', '📚', '🏃', '🧘', '💧', '🎯', '🌱', '🔥', '🎨', '🎵', '🍎', '😴', '🧠', '✍️', '🚀']

const MILESTONES: { days: number; message: string }[] = [
  { days: 3,   message: '3 дня подряд — хорошее начало!' },
  { days: 7,   message: 'Целая неделя! Привычка формируется 🎉' },
  { days: 14,  message: 'Две недели! Ты справляешься 💪' },
  { days: 21,  message: '21 день — говорят, именно столько нужно для привычки!' },
  { days: 30,  message: 'Месяц! Это уже часть твоей жизни 🌱' },
  { days: 60,  message: 'Два месяца! Ты невероятен ⚡' },
  { days: 100, message: '100 дней! Это легенда 🏆' },
  { days: 365, message: 'ГОД. Целый год. Ты изменил себя ✨' },
]

function getMilestoneMessage(streak: number): string | null {
  const hit = [...MILESTONES].reverse().find(m => streak >= m.days)
  return hit ? hit.message : null
}

function api(path: string, email: string, options: RequestInit = {}) {
  return fetch(`${BACKEND_URL}/api/habits${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': email,
      ...options.headers,
    },
  })
}

function MiniCalendar({ calendar, color }: { calendar: CalendarDay[]; color: string }) {
  const weeks: CalendarDay[][] = []
  for (let i = 0; i < calendar.length; i += 7) {
    weeks.push(calendar.slice(i, i + 7))
  }
  return (
    <div className="flex gap-0.5 mt-3">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-0.5">
          {week.map((day) => (
            <div
              key={day.date}
              className="w-3 h-3 rounded-sm transition-all"
              style={{ backgroundColor: day.done ? color : 'var(--color-muted)' }}
              title={day.date}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function HabitCard({
  habit,
  onToggle,
  onDelete,
  onEdit,
}: {
  habit: Habit
  onToggle: (id: number) => void
  onDelete: (id: number) => void
  onEdit: (habit: Habit) => void
}) {
  const milestone = getMilestoneMessage(habit.streak)

  return (
    <div
      className="rounded-2xl border bg-card p-5 flex flex-col gap-1 transition-all hover:shadow-md relative group"
      style={{ borderLeftColor: habit.color, borderLeftWidth: 4 }}
    >
      {/* Actions */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(habit)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(habit.id)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3">
        {/* Check button */}
        <button
          onClick={() => onToggle(habit.id)}
          className={cn(
            'flex-shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all active:scale-90',
            habit.doneToday
              ? 'border-transparent text-white shadow-sm'
              : 'border-current text-muted-foreground hover:border-current hover:scale-105'
          )}
          style={habit.doneToday ? { backgroundColor: habit.color } : { color: habit.color }}
        >
          {habit.doneToday ? <Check className="w-5 h-5" strokeWidth={2.5} /> : <span className="text-xl">{habit.emoji}</span>}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {habit.doneToday && <span className="text-base">{habit.emoji}</span>}
            <span className="font-semibold text-base leading-tight truncate">{habit.name}</span>
          </div>
          {/* Streak */}
          <div className="flex items-center gap-1 mt-0.5">
            <Flame
              className="w-4 h-4"
              style={{ color: habit.streak > 0 ? '#f97316' : undefined }}
            />
            <span className="text-sm font-medium" style={{ color: habit.streak > 0 ? '#f97316' : undefined }}>
              {habit.streak} {habit.streak === 1 ? 'день' : habit.streak >= 2 && habit.streak <= 4 ? 'дня' : 'дней'}
            </span>
            <span className="text-xs text-muted-foreground ml-1">• {habit.totalDone} всего</span>
          </div>
        </div>
      </div>

      {/* Milestone */}
      {milestone && (
        <p className="text-xs font-medium mt-1 px-2 py-1 rounded-lg" style={{ backgroundColor: habit.color + '20', color: habit.color }}>
          {milestone}
        </p>
      )}

      {/* Calendar heatmap */}
      <MiniCalendar calendar={habit.calendar} color={habit.color} />
    </div>
  )
}

function HabitForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<Habit>
  onSave: (data: { name: string; emoji: string; color: string }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '✨')
  const [color, setColor] = useState(initial?.color ?? COLORS[0])

  return (
    <div className="flex flex-col gap-4 mt-2">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Название</label>
        <Input
          placeholder="Например: Читать 20 минут"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Иконка</label>
        <div className="flex flex-wrap gap-2">
          {EMOJIS.map(e => (
            <button
              key={e}
              onClick={() => setEmoji(e)}
              className={cn(
                'w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all hover:scale-110',
                emoji === e ? 'ring-2 ring-offset-1 bg-muted' : 'hover:bg-muted'
              )}
              style={{}}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Цвет</label>
        <div className="flex gap-2 flex-wrap">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                'w-8 h-8 rounded-full transition-all hover:scale-110',
                color === c ? 'ring-2 ring-offset-2' : ''
              )}
              style={{ backgroundColor: c, ...(color === c ? { ringColor: c } : {}) }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-2">
        <Button variant="outline" onClick={onClose} className="flex-1">Отмена</Button>
        <Button
          onClick={() => name.trim() && onSave({ name: name.trim(), emoji, color })}
          disabled={!name.trim()}
          className="flex-1"
          style={{ backgroundColor: color, color: '#fff', borderColor: color }}
        >
          {initial?.id ? 'Сохранить' : 'Добавить'}
        </Button>
      </div>
    </div>
  )
}

export function HabitsTracker() {
  const { data: session } = useSession()
  const email = session?.user?.email ?? 'dev@timely.app'

  const [habits, setHabits] = useState<Habit[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null)

  const fetchHabits = useCallback(async () => {
    const res = await api('/', email)
    if (res.ok) {
      const data = await res.json()
      setHabits(data.map((h: any) => ({
        ...h,
        doneToday: h.done_today,
        totalDone: h.total_done,
      })))
    }
    setLoading(false)
  }, [email])

  useEffect(() => { fetchHabits() }, [fetchHabits])

  const handleAdd = async (data: { name: string; emoji: string; color: string }) => {
    const res = await api('/', email, { method: 'POST', body: JSON.stringify(data) })
    if (res.ok) { setDialogOpen(false); fetchHabits() }
  }

  const handleEdit = async (data: { name: string; emoji: string; color: string }) => {
    if (!editingHabit) return
    const res = await api(`/${editingHabit.id}/`, email, { method: 'PATCH', body: JSON.stringify(data) })
    if (res.ok) { setEditingHabit(null); fetchHabits() }
  }

  const handleToggle = async (id: number) => {
    // Optimistic update
    setHabits(prev => prev.map(h => {
      if (h.id !== id) return h
      const newDone = !h.doneToday
      return { ...h, doneToday: newDone, streak: newDone ? h.streak + 1 : Math.max(0, h.streak - 1) }
    }))
    const res = await api(`/${id}/toggle/`, email, { method: 'POST' })
    if (res.ok) {
      const { done_today, streak, total_done } = await res.json()
      setHabits(prev => prev.map(h => h.id === id ? { ...h, doneToday: done_today, streak, totalDone: total_done } : h))
    } else {
      fetchHabits()
    }
  }

  const handleDelete = async (id: number) => {
    await api(`/${id}/`, email, { method: 'DELETE' })
    setHabits(prev => prev.filter(h => h.id !== id))
  }

  const doneToday = habits.filter(h => h.doneToday).length
  const bestStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0)
  const topMilestone = getMilestoneMessage(bestStreak)

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-2xl border bg-card p-5 h-44 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Stats bar */}
      {habits.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5">
            <Check className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium">Сегодня: <strong>{doneToday}/{habits.length}</strong></span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5">
            <Flame className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium">Лучший стрик: <strong>{bestStreak} дн.</strong></span>
          </div>
          {topMilestone && (
            <div className="flex items-center gap-2 rounded-xl bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 px-4 py-2.5">
              <span className="text-sm font-medium text-orange-700 dark:text-orange-300">🎉 {topMilestone}</span>
            </div>
          )}
        </div>
      )}

      {/* Habits grid */}
      {habits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="text-5xl mb-4">🌱</span>
          <h3 className="text-lg font-semibold mb-1">Пока нет привычек</h3>
          <p className="text-muted-foreground text-sm mb-6">Добавь первую — маленький шаг каждый день меняет жизнь</p>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Добавить привычку
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {habits.map(h => (
              <HabitCard
                key={h.id}
                habit={h}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={h => { setEditingHabit(h); setDialogOpen(true) }}
              />
            ))}
            {/* Add card */}
            <button
              onClick={() => { setEditingHabit(null); setDialogOpen(true) }}
              className="rounded-2xl border-2 border-dashed border-muted-foreground/25 p-5 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground transition-all min-h-[160px]"
            >
              <Plus className="w-6 h-6" />
              <span className="text-sm font-medium">Новая привычка</span>
            </button>
          </div>
        </>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) setEditingHabit(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingHabit ? 'Редактировать привычку' : 'Новая привычка'}</DialogTitle>
          </DialogHeader>
          <HabitForm
            initial={editingHabit ?? undefined}
            onSave={editingHabit ? handleEdit : handleAdd}
            onClose={() => { setDialogOpen(false); setEditingHabit(null) }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
