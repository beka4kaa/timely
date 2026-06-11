"use client"

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Check, Flame, Shield, Play, Pause, RotateCcw, Camera,
  Pencil, Trash2, Timer, Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Habit, api, mapHabit, daysWord, resizeImage, cardGradient } from './lib'

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function HabitDetailModal({
  habit,
  email,
  onClose,
  onChanged,
  onEdit,
  onDelete,
}: {
  habit: Habit
  email: string
  onClose: () => void
  onChanged: (h: Habit) => void
  onEdit: (h: Habit) => void
  onDelete: (id: number) => void
}) {
  const [note, setNote] = useState(habit.noteToday)
  const [saving, setSaving] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Flow timer
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await api(`/${habit.id}/log/`, email, { method: 'POST', body: JSON.stringify(body) })
    if (res.ok) onChanged(mapHabit(await res.json()))
    return res.ok
  }, [habit.id, email, onChanged])

  const toggleDone = async () => {
    const res = await api(`/${habit.id}/toggle/`, email, { method: 'POST' })
    if (res.ok) onChanged(mapHabit(await res.json()))
  }

  const saveNote = async () => {
    setSaving(true)
    const ok = await post({ note })
    setSaving(false)
    if (ok) toast.success('Заметка сохранена')
  }

  const saveTimer = async () => {
    const mins = Math.max(1, Math.round(seconds / 60))
    setRunning(false)
    const ok = await post({ add_minutes: mins })
    if (ok) {
      toast.success(`+${mins} мин в копилку потока`)
      setSeconds(0)
    }
  }

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = await resizeImage(file)
      setPhoto(data)
      const ok = await post({ photo: data })
      if (ok) toast.success('Фото прикреплено')
    } catch {
      toast.error('Не удалось обработать фото')
    }
  }

  const currentPhoto = photo ?? (habit.hasPhotoToday ? 'has' : null)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0 bg-white/85 dark:bg-[#13131a]/85 backdrop-blur-2xl border-white/60 dark:border-white/10">
        {/* Gradient header */}
        <div className="p-5 text-white" style={{ background: cardGradient(habit.color) }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-white">
              <span className="w-11 h-11 rounded-2xl bg-white/20 flex items-center justify-center text-2xl">
                {habit.emoji}
              </span>
              <div className="text-left">
                <div className="text-lg leading-tight">{habit.name}</div>
                {habit.goalText && <div className="text-xs font-normal text-white/85">🎯 {habit.goalText}</div>}
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-4 mt-4 text-sm">
            <span className="flex items-center gap-1.5"><Flame className="w-4 h-4" />{habit.streak} {daysWord(habit.streak)}</span>
            <span className="flex items-center gap-1.5"><Shield className="w-4 h-4" />{habit.shieldsLeft} щитов</span>
            <span className="flex items-center gap-1.5"><Timer className="w-4 h-4" />{habit.totalMinutes} мин всего</span>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-5 max-h-[60vh] overflow-y-auto">
          {/* Done toggle */}
          <button
            onClick={toggleDone}
            className={cn(
              'w-full rounded-2xl py-3.5 font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98]',
              habit.doneToday ? 'text-white shadow-md' : 'border-2 hover:bg-muted'
            )}
            style={habit.doneToday
              ? { background: cardGradient(habit.color) }
              : { borderColor: habit.color, color: habit.color }}
          >
            <Check className="w-5 h-5" strokeWidth={3} />
            {habit.doneToday ? 'Выполнено сегодня' : 'Отметить выполненной'}
          </button>

          {/* Flow timer */}
          <div className="rounded-2xl border p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium flex items-center gap-1.5"><Timer className="w-4 h-4" /> Flow-таймер</span>
              {habit.minutesToday > 0 && (
                <span className="text-xs text-muted-foreground">сегодня: {habit.minutesToday} мин</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-3xl tabular-nums tracking-tight flex-1">{fmt(seconds)}</span>
              <Button size="icon" variant="outline" onClick={() => setRunning((r) => !r)}>
                {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="outline" onClick={() => { setRunning(false); setSeconds(0) }} disabled={seconds === 0}>
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button onClick={saveTimer} disabled={seconds < 5} style={{ backgroundColor: habit.color }} className="text-white">
                <Save className="w-4 h-4 mr-1" /> Записать
              </Button>
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Заметка дня</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Что получилось сегодня?"
              rows={3}
            />
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={saveNote} disabled={saving || note === habit.noteToday}>
              <Save className="w-3.5 h-3.5 mr-1" /> Сохранить заметку
            </Button>
          </div>

          {/* Photo */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Фото результата</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="result" className="rounded-xl w-full max-h-48 object-cover" />
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed py-6 flex flex-col items-center gap-1.5 text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
              >
                <Camera className="w-5 h-5" />
                <span className="text-xs">{currentPhoto === 'has' ? 'Фото уже прикреплено — заменить' : 'Прикрепить фото'}</span>
              </button>
            )}
          </div>

          {/* Edit / Delete */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onEdit(habit)}>
              <Pencil className="w-4 h-4 mr-1.5" /> Изменить
            </Button>
            <Button
              variant="outline"
              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              onClick={() => { if (confirm(`Удалить «${habit.name}»?`)) { onDelete(habit.id); onClose() } }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
