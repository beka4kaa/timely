"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  PlusIcon,
  Trash2Icon,
  Loader2,
  Settings2Icon,
  CheckIcon,
  GripVertical,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { WeeklyTemplate, TemplateLessonSlot, DayOfWeek, BlockType } from "@/types/diary"
import { DAYS_ORDER, DAY_OF_WEEK_LABELS, BLOCK_TYPE_META, PRESET_BLOCK_TYPES } from "@/types/diary"

// ── Custom preset persistence ──────────────────────────────────────
const CUSTOM_KEY = 'schedule_custom_block_types'

interface CustomPreset { value: string; label: string; emoji: string }

function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveCustomPresets(presets: CustomPreset[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(presets))
}

// ── BlockTypeCombobox ──────────────────────────────────────────────
function getBlockLabel(type: BlockType, label: string, customs: CustomPreset[]) {
  if (type in BLOCK_TYPE_META) return BLOCK_TYPE_META[type as keyof typeof BLOCK_TYPE_META].label
  const custom = customs.find(c => c.value === type)
  return custom?.label ?? label ?? type
}

function getBlockEmoji(type: BlockType, customs: CustomPreset[]) {
  if (type in BLOCK_TYPE_META) return BLOCK_TYPE_META[type as keyof typeof BLOCK_TYPE_META].emoji
  return customs.find(c => c.value === type)?.emoji ?? '🔖'
}

function getBlockColor(type: BlockType) {
  if (type in BLOCK_TYPE_META) return BLOCK_TYPE_META[type as keyof typeof BLOCK_TYPE_META].color
  return 'text-pink-400'
}

interface BlockTypeComboboxProps {
  value: BlockType
  onValueChange: (type: BlockType, label: string) => void
  customs: CustomPreset[]
  onCustomsChange: (presets: CustomPreset[]) => void
}

function BlockTypeCombobox({ value, onValueChange, customs, onCustomsChange }: BlockTypeComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const allOptions = [
    ...PRESET_BLOCK_TYPES.map(t => ({ value: t, label: BLOCK_TYPE_META[t].label, emoji: BLOCK_TYPE_META[t].emoji, isPreset: true })),
    ...customs.map(c => ({ ...c, isPreset: false })),
  ]

  const filtered = query
    ? allOptions.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : allOptions

  const exactMatch = allOptions.some(o => o.label.toLowerCase() === query.toLowerCase())
  const canCreate = query.trim().length > 0 && !exactMatch

  function select(opt: { value: string; label: string }) {
    onValueChange(opt.value, opt.label)
    setQuery('')
    setOpen(false)
  }

  function create() {
    const newPreset: CustomPreset = {
      value: query.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-Ѐ-ӿ]/gi, ''),
      label: query.trim(),
      emoji: '🔖',
    }
    const updated = [...customs, newPreset]
    onCustomsChange(updated)
    saveCustomPresets(updated)
    onValueChange(newPreset.value, newPreset.label)
    setQuery('')
    setOpen(false)
  }

  function removeCustom(e: React.MouseEvent, val: string) {
    e.stopPropagation()
    const updated = customs.filter(c => c.value !== val)
    onCustomsChange(updated)
    saveCustomPresets(updated)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 h-7 px-2 rounded-md border border-input bg-transparent text-xs hover:bg-accent transition-colors w-28 shrink-0',
            getBlockColor(value)
          )}
        >
          <span>{getBlockEmoji(value, customs)}</span>
          <span className="truncate">{getBlockLabel(value, '', customs)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <div className="flex flex-col">
          <div className="border-b px-3 py-2">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canCreate) create() }}
              placeholder="Поиск или создать..."
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="py-1 max-h-48 overflow-auto">
            {filtered.map(opt => (
              <div
                key={opt.value}
                onClick={() => select(opt)}
                className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-accent cursor-pointer rounded-sm mx-1 group"
              >
                <span className={cn('flex items-center gap-2', getBlockColor(opt.value))}>
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </span>
                <span className="flex items-center gap-1">
                  {value === opt.value && <CheckIcon className="h-3 w-3 text-primary" />}
                  {!opt.isPreset && (
                    <button
                      onClick={e => removeCustom(e, opt.value)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-all"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              </div>
            ))}
            {canCreate && (
              <div
                onClick={create}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent cursor-pointer rounded-sm mx-1 text-muted-foreground"
              >
                <PlusIcon className="h-3 w-3" />
                <span>Создать «{query}»</span>
              </div>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Ничего не найдено</div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface Subject {
  id: string
  name: string
  emoji: string
  color: string
}

type SlotDraft = Omit<TemplateLessonSlot, 'id'> & { id: string; _key: string; blockType: BlockType; label: string }

const DEFAULT_TIMES = [
  { start: '08:00', end: '08:45' },
  { start: '09:00', end: '09:45' },
  { start: '10:00', end: '10:45' },
  { start: '11:00', end: '11:45' },
  { start: '12:00', end: '12:45' },
  { start: '13:00', end: '13:45' },
  { start: '14:00', end: '14:45' },
]

function pad(n: number) { return String(n).padStart(2, '0') }

function formatHHMM(value: string): string {
  // Accept "HH:MM" or raw input — clean to HH:MM
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export default function SchedulePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('Моё расписание')
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])

  // Load custom presets from localStorage on mount
  useEffect(() => { setCustomPresets(loadCustomPresets()) }, [])

  // Slots per day: map DayOfWeek → SlotDraft[]
  const [slotsByDay, setSlotsByDay] = useState<Record<DayOfWeek, SlotDraft[]>>(
    () => Object.fromEntries(DAYS_ORDER.map(d => [d, []])) as unknown as Record<DayOfWeek, SlotDraft[]>
  )

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [tplRes, subRes] = await Promise.all([
          fetch('/api/diary/template'),
          fetch('/api/subjects'),
        ])

        const subData = await subRes.json()
        const subList: Subject[] = Array.isArray(subData)
          ? subData
          : (subData.results ?? subData.subjects ?? [])
        setSubjects(subList.map((s: any) => ({
          id: String(s.id),
          name: s.name,
          emoji: s.emoji || '📚',
          color: s.color || '#6366f1',
        })))

        if (tplRes.ok) {
          const tplData = await tplRes.json()
          const active: WeeklyTemplate | null = tplData.active
          if (active) {
            setTemplateId(active.id)
            setTemplateName(active.name)
            const map: Record<DayOfWeek, SlotDraft[]> = Object.fromEntries(
              DAYS_ORDER.map(d => [d, []])
            ) as unknown as Record<DayOfWeek, SlotDraft[]>
            for (const s of active.slots) {
              map[s.dayOfWeek].push({ ...s, _key: s.id, blockType: s.blockType ?? 'lesson', label: s.label ?? '' })
            }
            // Sort each day by lesson number
            for (const d of DAYS_ORDER) {
              map[d] = map[d].sort((a, b) => a.lessonNumber - b.lessonNumber)
            }
            setSlotsByDay(map)
          }
        }
      } catch (e) {
        toast.error('Ошибка загрузки расписания')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function addSlot(day: DayOfWeek) {
    setSlotsByDay(prev => {
      const existing = prev[day]
      const lessonNumber = existing.length + 1
      const times = DEFAULT_TIMES[existing.length] ?? { start: '08:00', end: '08:45' }
      const newSlot: SlotDraft = {
        id: crypto.randomUUID(),
        _key: crypto.randomUUID(),
        dayOfWeek: day,
        lessonNumber,
        startTime: times.start,
        endTime: times.end,
        subjectId: subjects[0]?.id ?? '',
        blockType: 'lesson',
        label: '',
      }
      return { ...prev, [day]: [...existing, newSlot] }
    })
  }

  function removeSlot(day: DayOfWeek, key: string) {
    setSlotsByDay(prev => {
      const updated = prev[day].filter(s => s._key !== key)
      // Renumber
      const renumbered = updated.map((s, i) => ({ ...s, lessonNumber: i + 1 }))
      return { ...prev, [day]: renumbered }
    })
  }

  function updateSlot(day: DayOfWeek, key: string, patch: Partial<SlotDraft>) {
    setSlotsByDay(prev => ({
      ...prev,
      [day]: prev[day].map(s => s._key === key ? { ...s, ...patch } : s),
    }))
  }

  // Drag-and-drop state
  const dragKey = useRef<string | null>(null)
  const dragDay = useRef<DayOfWeek | null>(null)

  function handleDragStart(day: DayOfWeek, key: string) {
    dragKey.current = key
    dragDay.current = day
  }

  function handleDragOver(e: React.DragEvent, day: DayOfWeek, key: string) {
    e.preventDefault()
    if (dragDay.current !== day || dragKey.current === key) return
    setSlotsByDay(prev => {
      const slots = [...prev[day]]
      const fromIdx = slots.findIndex(s => s._key === dragKey.current)
      const toIdx = slots.findIndex(s => s._key === key)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev
      const reordered = [...slots]
      const [moved] = reordered.splice(fromIdx, 1)
      reordered.splice(toIdx, 0, moved)
      const renumbered = reordered.map((s, i) => ({ ...s, lessonNumber: i + 1 }))
      return { ...prev, [day]: renumbered }
    })
  }

  function handleDrop() {
    dragKey.current = null
    dragDay.current = null
  }

  async function handleSave() {
    const allSlots = DAYS_ORDER.flatMap(d => slotsByDay[d]).map(({ _key, ...s }) => s)
    setSaving(true)
    try {
      let res: Response
      if (templateId) {
        res = await fetch('/api/diary/template', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: templateId, name: templateName, slots: allSlots }),
        })
      } else {
        res = await fetch('/api/diary/template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: templateName, slots: allSlots }),
        })
        if (res.ok) {
          const data = await res.json()
          setTemplateId(data.id)
        }
      }
      if (!res.ok) throw new Error(await res.text())
      toast.success('Расписание сохранено! Новые недели будут использовать его.')
    } catch (e: any) {
      toast.error(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/dashboard/diary')}>
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <Settings2Icon className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold leading-none">Настройка расписания</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Шаблон применяется к новым неделям. Уже открытые недели не меняются.
          </p>
        </div>
      </div>

      {/* Template name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-name" className="text-xs font-medium">Название шаблона</Label>
        <Input
          id="tpl-name"
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          className="max-w-xs h-8 text-sm"
          placeholder="Моё расписание"
        />
      </div>

      {subjects.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Предметы не найдены. Добавьте предметы во вкладке Subjects, чтобы добавлять уроки. Другие блоки (перерыв, фокус, тест) доступны всегда.
        </div>
      )}

      {/* Days */}
      <div className="flex flex-col gap-4">
        {DAYS_ORDER.map(dow => {
          const slots = slotsByDay[dow]
          const isWeekend = dow === 'saturday' || dow === 'sunday'
          return (
            <div
              key={dow}
              className={cn(
                "rounded-xl border bg-card overflow-hidden",
                isWeekend && slots.length === 0 && "opacity-50"
              )}
            >
              {/* Day header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
                <span className="font-semibold text-sm">{DAY_OF_WEEK_LABELS[dow]}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {slots.length} {slots.length === 1 ? 'урок' : slots.length < 5 ? 'урока' : 'уроков'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2 gap-1"
                    onClick={() => addSlot(dow)}
                  >
                    <PlusIcon className="h-3 w-3" />
                    Добавить
                  </Button>
                </div>
              </div>

              {/* Slot rows */}
              {slots.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {slots.map(slot => (
                    <div
                      key={slot._key}
                      className="flex items-center gap-2 px-3 py-2 flex-wrap group"
                      draggable
                      onDragStart={() => handleDragStart(dow, slot._key)}
                      onDragOver={e => handleDragOver(e, dow, slot._key)}
                      onDrop={handleDrop}
                    >
                      {/* Drag handle */}
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 transition-colors" />
                      {/* Lesson number badge */}
                      <span className="text-xs font-bold text-muted-foreground min-w-[20px] text-center">
                        {slot.lessonNumber}
                      </span>

                      {/* Block type selector */}
                      <BlockTypeCombobox
                        value={slot.blockType ?? 'lesson'}
                        onValueChange={(type, lbl) => updateSlot(dow, slot._key, { blockType: type, label: lbl })}
                        customs={customPresets}
                        onCustomsChange={setCustomPresets}
                      />

                      {/* Start time */}
                      <div className="flex flex-col gap-0.5 w-20">
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Начало</span>
                        <Input
                          value={slot.startTime}
                          onChange={e => updateSlot(dow, slot._key, { startTime: formatHHMM(e.target.value) })}
                          placeholder="08:00"
                          className="h-7 text-xs px-2 font-mono"
                          maxLength={5}
                        />
                      </div>

                      {/* End time */}
                      <div className="flex flex-col gap-0.5 w-20">
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Конец</span>
                        <Input
                          value={slot.endTime}
                          onChange={e => updateSlot(dow, slot._key, { endTime: formatHHMM(e.target.value) })}
                          placeholder="08:45"
                          className="h-7 text-xs px-2 font-mono"
                          maxLength={5}
                        />
                      </div>

                      {/* Subject select OR label input */}
                      <div className="flex flex-col gap-0.5 flex-1 min-w-[140px]">
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                          {slot.blockType === 'lesson' || !slot.blockType ? 'Предмет' : 'Название'}
                        </span>
                        {(slot.blockType === 'lesson' || !slot.blockType) ? (
                          <Select
                            value={slot.subjectId}
                            onValueChange={v => updateSlot(dow, slot._key, { subjectId: v })}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Выберите предмет">
                                {subjects.find(s => s.id === slot.subjectId) ? (
                                  <span>
                                    {subjects.find(s => s.id === slot.subjectId)!.emoji}{' '}
                                    {subjects.find(s => s.id === slot.subjectId)!.name}
                                  </span>
                                ) : 'Выберите предмет'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {subjects.map(s => (
                                <SelectItem key={s.id} value={s.id}>
                                  <span className="flex items-center gap-1.5">
                                    <span>{s.emoji}</span>
                                    <span>{s.name}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            value={slot.label ?? ''}
                            onChange={e => updateSlot(dow, slot._key, { label: e.target.value })}
                            placeholder={getBlockLabel(slot.blockType, slot.label ?? '', customPresets) + '...'}
                            className="h-7 text-xs px-2"
                          />
                        )}
                      </div>

                      {/* Remove button */}
                      <button
                        onClick={() => removeSlot(dow, slot._key)}
                        className="mt-3.5 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                        title="Удалить урок"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-3 text-xs text-muted-foreground/60">
                  Нет уроков — {isWeekend ? 'выходной день' : 'нажмите «Добавить»'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 sticky bottom-4">
        <Button onClick={handleSave} disabled={saving} className="gap-2 shadow-lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
          {saving ? 'Сохраняю...' : 'Сохранить расписание'}
        </Button>
        <Button variant="ghost" onClick={() => router.push('/dashboard/diary')}>
          Назад к дневнику
        </Button>
      </div>
    </div>
  )
}
