"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { GripVertical } from "lucide-react"
import { Icon } from "@/components/shell/icons"
import { useDataChanged } from "@/lib/data-changed"
import { SubNav } from "@/components/shell/tab-bar"
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
import { plural } from "@/lib/now-feed"
import { toast } from "sonner"
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
        <button type="button" className="ds-type" aria-label="Тип блока">
          <span>{getBlockLabel(value, '', customs)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="ds-type-pop w-52 rounded-xl p-0" align="start">
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) create() }}
          placeholder="Поиск или новый тип"
          aria-label="Поиск или новый тип блока"
          className="ds-type-search"
        />
        <div className="ds-type-list">
          {filtered.map(opt => (
            <div
              key={opt.value}
              role="button"
              tabIndex={0}
              onClick={() => select(opt)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(opt) } }}
              className="ds-type-opt"
            >
              <span>{opt.label}</span>
              <span className="flex items-center gap-1">
                {value === opt.value && <Icon name="check" />}
                {!opt.isPreset && (
                  <button
                    type="button"
                    onClick={e => removeCustom(e, opt.value)}
                    className="ds-type-x"
                    aria-label={`Удалить тип «${opt.label}»`}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </span>
            </div>
          ))}
          {canCreate && (
            <button type="button" onClick={create} className="ds-type-opt">
              <span>Создать «{query}»</span>
              <Icon name="plus" />
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div className="ds-type-none">Ничего не найдено</div>
          )}
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

/** Wrap a cell value for CSV: escape quotes, wrap in quotes if needed */
function csvCell(val: string): string {
  const s = String(val ?? '').replace(/"/g, '""')
  return /[,"\n\r]/.test(s) ? `"${s}"` : s
}

function exportToCsv(
  templateName: string,
  slotsByDay: Record<string, SlotDraft[]>,
  subjects: { id: string; name: string; emoji: string }[],
  blockLabels: (type: string, label: string) => string,
) {
  const subjectMap = new Map(subjects.map(s => [s.id, s]))
  const DAY_LABELS: Record<string, string> = {
    monday: 'Понедельник', tuesday: 'Вторник', wednesday: 'Среда',
    thursday: 'Четверг', friday: 'Пятница', saturday: 'Суббота', sunday: 'Воскресенье',
  }
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

  const header = ['День', '№', 'Начало', 'Конец', 'Тип', 'Предмет / Название'].map(csvCell).join(',')
  const rows: string[] = [header]

  for (const day of DAYS) {
    for (const slot of (slotsByDay[day] ?? [])) {
      const isLesson = !slot.blockType || slot.blockType === 'lesson'
      const subj = isLesson ? subjectMap.get(slot.subjectId) : undefined
      const nameCell = isLesson
        ? (subj ? `${subj.emoji} ${subj.name}` : slot.subjectId)
        : blockLabels(slot.blockType, slot.label)
      rows.push([
        DAY_LABELS[day] ?? day,
        String(slot.lessonNumber),
        slot.startTime,
        slot.endTime,
        slot.blockType || 'lesson',
        nameCell,
      ].map(csvCell).join(','))
    }
  }

  const bom = '\uFEFF'   // UTF-8 BOM so Excel opens cyrillic correctly
  const blob = new Blob([bom + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${templateName.replace(/[\\/:*?"<>|]/g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Parse a single CSV row, respecting quoted fields */
function parseCSVRow(row: string): string[] {
  const cells: string[] = []
  let i = 0
  while (i < row.length) {
    if (row[i] === '"') {
      let val = ''; i++
      while (i < row.length) {
        if (row[i] === '"' && row[i + 1] === '"') { val += '"'; i += 2 }
        else if (row[i] === '"') { i++; break }
        else { val += row[i++] }
      }
      cells.push(val)
      if (row[i] === ',') i++
    } else {
      const end = row.indexOf(',', i)
      if (end === -1) { cells.push(row.slice(i)); break }
      cells.push(row.slice(i, end)); i = end + 1
    }
  }
  return cells
}

const DAY_NAME_TO_KEY: Record<string, DayOfWeek> = {
  'понедельник': 'monday', 'вторник': 'tuesday', 'среда': 'wednesday',
  'четверг': 'thursday', 'пятница': 'friday', 'суббота': 'saturday', 'воскресенье': 'sunday',
  monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
  thursday: 'thursday', friday: 'friday', saturday: 'saturday', sunday: 'sunday',
}

type ParsedRow = {
  dayOfWeek: DayOfWeek
  lessonNumber: number
  startTime: string
  endTime: string
  blockType: string
  rawName: string
}

function parseCsvToRows(csv: string): ParsedRow[] {
  // Strip UTF-8 BOM if present
  const content = csv.replace(/^\uFEFF/, '')
  const lines = content.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const rows: ParsedRow[] = []
  for (const line of lines.slice(1)) {          // skip header
    const cells = parseCSVRow(line)
    if (cells.length < 5) continue
    const [dayRaw, numRaw, start, end, type, name = ''] = cells
    const dayKey = DAY_NAME_TO_KEY[dayRaw.trim().toLowerCase()]
    if (!dayKey) continue
    rows.push({
      dayOfWeek: dayKey,
      lessonNumber: parseInt(numRaw) || 1,
      startTime: start.trim(),
      endTime: end.trim(),
      blockType: type.trim() || 'lesson',
      rawName: name.trim(),
    })
  }
  return rows
}

export default function SchedulePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [subjects, setSubjects] = useState<Subject[]>([])

  // ── Template list (for selector) ──────────────────────────────
  const [allTemplates, setAllTemplates] = useState<WeeklyTemplate[]>([])
  /** ID of the template currently open in the editor */
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('Моё расписание')
  /** True when the template being edited is the active (applied) template */
  const [isActiveTemplate, setIsActiveTemplate] = useState(false)
  const [activatingTemplate, setActivatingTemplate] = useState(false)
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [duplicatingTemplate, setDuplicatingTemplate] = useState(false)
  const [importingTemplate, setImportingTemplate] = useState(false)
  const importFileRef = useRef<HTMLInputElement>(null)

  // Pending soft-delete: holds the template being "undone" until timeout fires
  const pendingDeleteRef = useRef<{
    template: WeeklyTemplate
    previousTemplates: WeeklyTemplate[]
    previousEditorId: string | null
    previousEditorName: string
    previousSlots: Record<DayOfWeek, SlotDraft[]>
    previousIsActive: boolean
    timer: ReturnType<typeof setTimeout>
    toastId: string | number
  } | null>(null)

  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])

  // Load custom presets from localStorage on mount
  useEffect(() => { setCustomPresets(loadCustomPresets()) }, [])

  // Slots per day: map DayOfWeek → SlotDraft[]
  const [slotsByDay, setSlotsByDay] = useState<Record<DayOfWeek, SlotDraft[]>>(
    () => Object.fromEntries(DAYS_ORDER.map(d => [d, []])) as unknown as Record<DayOfWeek, SlotDraft[]>
  )

  /** Load a template object into the editor fields */
  function loadTemplateIntoEditor(tpl: WeeklyTemplate, activeId: string | null) {
    setTemplateId(tpl.id)
    setTemplateName(tpl.name)
    setIsActiveTemplate(tpl.id === activeId)
    const map: Record<DayOfWeek, SlotDraft[]> = Object.fromEntries(
      DAYS_ORDER.map(d => [d, []])
    ) as unknown as Record<DayOfWeek, SlotDraft[]>
    for (const s of tpl.slots) {
      map[s.dayOfWeek].push({ ...s, _key: s.id, blockType: s.blockType ?? 'lesson', label: s.label ?? '' })
    }
    for (const d of DAYS_ORDER) {
      map[d] = map[d].sort((a, b) => a.lessonNumber - b.lessonNumber)
    }
    setSlotsByDay(map)
  }

  // Тьютор мог записать расписание из мини-окна: иначе «Сохранить» затёрло бы его старым.
  const [reloads, setReloads] = useState(0)
  useDataChanged('timetable', () => setReloads(count => count + 1))

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
          const templates: WeeklyTemplate[] = tplData.templates ?? []
          const active: WeeklyTemplate | null = tplData.active
          setAllTemplates(templates)
          const toEdit = active ?? templates[0] ?? null
          if (toEdit) {
            loadTemplateIntoEditor(toEdit, active?.id ?? null)
          }
        }
      } catch (e) {
        toast.error('Ошибка загрузки расписания')
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloads])

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

  /** Switch the editor to a different template from the list */
  async function handleSwitchTemplate(id: string) {
    if (id === templateId) return
    const tpl = allTemplates.find(t => t.id === id)
    if (!tpl) return
    const activeId = allTemplates.find(t => t.isActive)?.id ?? null
    loadTemplateIntoEditor(tpl, activeId)
  }

  /** Create a blank new template and open it for editing */
  async function handleCreateEmpty() {
    setCreatingTemplate(true)
    try {
      const res = await fetch('/api/diary/template/create-empty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Новый шаблон' }),
      })
      if (!res.ok) throw new Error(await res.text())
      const created: WeeklyTemplate = await res.json()
      setAllTemplates(prev => [created, ...prev])
      const activeId = allTemplates.find(t => t.isActive)?.id ?? null
      loadTemplateIntoEditor(created, activeId)
      toast.success('Новый шаблон создан')
    } catch (e: any) {
      toast.error(e.message || 'Ошибка создания шаблона')
    } finally {
      setCreatingTemplate(false)
    }
  }

  /** Duplicate the currently open template and open the copy for editing */
  async function handleDuplicate() {
    if (!templateId) return
    setDuplicatingTemplate(true)
    try {
      const res = await fetch('/api/diary/template/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      })
      if (!res.ok) throw new Error(await res.text())
      const copy: WeeklyTemplate = await res.json()
      setAllTemplates(prev => [copy, ...prev])
      const activeId = allTemplates.find(t => t.isActive)?.id ?? null
      loadTemplateIntoEditor(copy, activeId)
      toast.success(`Копия «${copy.name}» создана`)
    } catch (e: any) {
      toast.error(e.message || 'Ошибка дублирования')
    } finally {
      setDuplicatingTemplate(false)
    }
  }

  /** Import a CSV file and create a new template from it */
  async function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!importFileRef.current) return
    importFileRef.current.value = ''   // reset so same file can be re-selected
    if (!file) return

    setImportingTemplate(true)
    try {
      const text = await file.text()
      const rows = parseCsvToRows(text)
      if (rows.length === 0) {
        toast.error('Не удалось распознать уроки — проверьте формат CSV')
        return
      }

      // Resolve subject names to IDs (strip leading emoji + space)
      const nameToSubject = new Map(
        subjects.map(s => [s.name.toLowerCase().trim(), s])
      )
      /** Strip a leading emoji/symbol (codePoint > U+2000) and any trailing space */
      const stripEmoji = (s: string) =>
        (s.codePointAt(0) ?? 0) > 0x2000 ? s.replace(/^\S+\s*/, '').trim() : s.trim()

      const slots = rows.map((r) => {
        const isLesson = !r.blockType || r.blockType === 'lesson'
        const cleanName = stripEmoji(r.rawName)
        const matched = nameToSubject.get(cleanName.toLowerCase())
        return {
          id: crypto.randomUUID(),
          dayOfWeek: r.dayOfWeek,
          lessonNumber: r.lessonNumber,
          startTime: r.startTime,
          endTime: r.endTime,
          blockType: r.blockType,
          subjectId: isLesson ? (matched?.id ?? '') : '',
          label: isLesson ? '' : (r.rawName || ''),
        }
      })

      // Derive template name from filename (strip extension)
      const importedName = file.name.replace(/\.csv$/i, '').replace(/_/g, ' ') || 'Импорт'

      // Create empty template then save slots via PUT
      const createRes = await fetch('/api/diary/template/create-empty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: importedName }),
      })
      if (!createRes.ok) throw new Error('Ошибка создания шаблона')
      const created: WeeklyTemplate = await createRes.json()

      const saveRes = await fetch('/api/diary/template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: created.id, name: importedName, slots }),
      })
      if (!saveRes.ok) throw new Error('Ошибка сохранения')
      const saved: WeeklyTemplate = await saveRes.json()

      const activeId = allTemplates.find(t => t.isActive)?.id ?? null
      setAllTemplates(prev => [saved, ...prev])
      loadTemplateIntoEditor(saved, activeId)
      toast.success(`Импортировано ${rows.length} уроков — «${importedName}»`)
    } catch (err: any) {
      toast.error(err.message || 'Ошибка импорта')
    } finally {
      setImportingTemplate(false)
    }
  }

  /** Undo the last soft-deleted template */
  function undoDelete() {
    const p = pendingDeleteRef.current
    if (!p) return
    clearTimeout(p.timer)
    toast.dismiss(p.toastId)
    // Restore UI
    setAllTemplates(p.previousTemplates)
    setTemplateId(p.previousEditorId)
    setTemplateName(p.previousEditorName)
    setIsActiveTemplate(p.previousIsActive)
    setSlotsByDay(p.previousSlots)
    pendingDeleteRef.current = null
  }

  // Ctrl+Z = undo delete, Ctrl+Shift+Z = nothing extra needed (no redo)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (pendingDeleteRef.current) {
          e.preventDefault()
          undoDelete()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** Delete the currently edited template (not allowed for active template) */
  function handleDeleteTemplate() {
    if (!templateId || isActiveTemplate) return

    // Snapshot current state for undo
    const snapshotTemplates = [...allTemplates]
    const snapshotId       = templateId
    const snapshotName     = templateName
    const snapshotSlots    = slotsByDay
    const snapshotIsActive = isActiveTemplate
    const deletedTemplate  = allTemplates.find(t => t.id === templateId)!

    // Optimistically remove from UI
    const remaining = allTemplates.filter(t => t.id !== templateId)
    setAllTemplates(remaining)
    const next = remaining[0] ?? null
    if (next) {
      const activeId = remaining.find(t => t.isActive)?.id ?? null
      loadTemplateIntoEditor(next, activeId)
    } else {
      setTemplateId(null)
      setTemplateName('Моё расписание')
      setSlotsByDay(Object.fromEntries(DAYS_ORDER.map(d => [d, []])) as any)
    }

    // Schedule actual API delete after 6 s
    const timer = setTimeout(async () => {
      pendingDeleteRef.current = null
      try {
        const res = await fetch(`/api/diary/template?id=${snapshotId}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(await res.text())
      } catch {
        // If delete failed, silently restore
        setAllTemplates(snapshotTemplates)
        setTemplateId(snapshotId)
        setTemplateName(snapshotName)
        setIsActiveTemplate(snapshotIsActive)
        setSlotsByDay(snapshotSlots)
        toast.error('Ошибка удаления — шаблон восстановлен')
      }
    }, 6000)

    const toastId = toast('Шаблон «' + deletedTemplate.name + '» удалён', {
      duration: 6000,
      action: {
        label: 'Отменить',
        onClick: undoDelete,
      },
      description: 'Ctrl+Z — тоже отменяет',
    })

    pendingDeleteRef.current = {
      template:            deletedTemplate,
      previousTemplates:   snapshotTemplates,
      previousEditorId:    snapshotId,
      previousEditorName:  snapshotName,
      previousSlots:       snapshotSlots,
      previousIsActive:    snapshotIsActive,
      timer,
      toastId,
    }
  }

  /** Activate the currently edited template (makes it the live schedule) */
  async function handleSetActive() {
    if (!templateId || isActiveTemplate) return
    setActivatingTemplate(true)
    try {
      const res = await fetch('/api/diary/template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: templateId, isActive: true }),
      })
      if (!res.ok) throw new Error(await res.text())
      setIsActiveTemplate(true)
      // Update the list to reflect new active state
      setAllTemplates(prev =>
        prev.map(t => ({ ...t, isActive: t.id === templateId }))
      )
      toast.success('Шаблон активирован — новые недели будут его использовать')
    } catch (e: any) {
      toast.error(e.message || 'Ошибка активации')
    } finally {
      setActivatingTemplate(false)
    }
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
      if (!res!.ok) throw new Error(await res!.text())
      toast.success('Расписание сохранено! Новые недели будут использовать его.')
      // Keep the local template list in sync with the new name
      setAllTemplates(prev =>
        prev.map(t => t.id === templateId ? { ...t, name: templateName } : t)
      )
    } catch (e: any) {
      toast.error(e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="content view">
        <SubNav group="study" />
        <header className="head">
          <h1 className="title">Шаблон расписания</h1>
        </header>
        <p className="dy-note" role="status">Загружаю шаблон…</p>
      </div>
    )
  }

  return (
    <div className="content view">
      <SubNav group="study" />
      <header className="head">
        <h1 className="title">Шаблон расписания</h1>
        <div className="head-tools">
          <Link className="btn btn-text" href="/dashboard/diary">
            <Icon name="chev-l" />
            Дневник
          </Link>
        </div>
      </header>
      <p className="dy-note">
        Шаблон применяется к новым неделям. Неделя, в которой уже есть записи, не меняется.
      </p>

      {/* Какой шаблон открыт и что с ним можно сделать */}
      <section className="card ds-card">
        <div className="ds-card-top">
          <h2>Шаблон</h2>
          {isActiveTemplate && <span className="ds-badge">Активный</span>}
          <div className="ds-card-tools">
            {templateId && (
              <button
                type="button"
                className="btn btn-text"
                onClick={() => exportToCsv(
                  templateName,
                  slotsByDay,
                  subjects,
                  (type, label) => getBlockLabel(type, label, customPresets),
                )}
              >
                Экспорт CSV
              </button>
            )}
            <button
              type="button"
              className="btn btn-text"
              disabled={importingTemplate}
              onClick={() => importFileRef.current?.click()}
            >
              {importingTemplate ? "Загружаю…" : "Импорт CSV"}
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImportCsv}
            />
          </div>
        </div>

        {allTemplates.length > 1 && (
          <Select value={templateId ?? ''} onValueChange={handleSwitchTemplate}>
            <SelectTrigger className="ds-select ds-name" aria-label="Выбрать шаблон">
              <SelectValue placeholder="Выбери шаблон" />
            </SelectTrigger>
            <SelectContent>
              {allTemplates.map(t => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}{t.isActive ? ", активный" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <label className="field ds-name">
          Название шаблона
          <input
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="Моё расписание"
          />
        </label>

        <div className="ds-acts">
          <button type="button" className="btn btn-line" onClick={handleCreateEmpty} disabled={creatingTemplate}>
            {creatingTemplate ? "Создаю…" : "Новый шаблон"}
          </button>
          {templateId && (
            <button type="button" className="btn btn-line" onClick={handleDuplicate} disabled={duplicatingTemplate}>
              {duplicatingTemplate ? "Копирую…" : "Дублировать"}
            </button>
          )}
          {templateId && !isActiveTemplate && (
            <button type="button" className="btn btn-line" onClick={handleSetActive} disabled={activatingTemplate}>
              {activatingTemplate ? "Включаю…" : "Сделать активным"}
            </button>
          )}
          {templateId && !isActiveTemplate && (
            <button type="button" className="btn btn-text danger" onClick={handleDeleteTemplate}>
              Удалить
            </button>
          )}
        </div>
      </section>

      {subjects.length === 0 && (
        <div className="card ds-warn">
          <b>Предметов пока нет.</b>{" "}
          <Link className="link" href="/dashboard/subjects">Добавь их</Link>, чтобы ставить уроки. Другие блоки (перерыв, фокус, тест) доступны и без них.
        </div>
      )}

      {DAYS_ORDER.map(dow => {
        const slots = slotsByDay[dow]
        const isWeekend = dow === 'saturday' || dow === 'sunday'
        return (
          <section key={dow} className="ds-day">
            <h2 className="sec">
              {DAY_OF_WEEK_LABELS[dow]}
              <span>{slots.length} {plural(slots.length, ['урок', 'урока', 'уроков'])}</span>
            </h2>
            <div className="card">
              {slots.length === 0 && (
                <p className="ds-none">Уроков нет{isWeekend ? ', выходной' : ''}</p>
              )}
              {slots.map(slot => {
                const isLesson = slot.blockType === 'lesson' || !slot.blockType
                const subject = subjects.find(s => s.id === slot.subjectId)
                return (
                  <div
                    key={slot._key}
                    className="ds-slot"
                    draggable
                    onDragStart={() => handleDragStart(dow, slot._key)}
                    onDragOver={e => handleDragOver(e, dow, slot._key)}
                    onDrop={handleDrop}
                  >
                    <GripVertical className="ds-grip" aria-hidden="true" />
                    <span className="ds-n">{slot.lessonNumber}</span>

                    <BlockTypeCombobox
                      value={slot.blockType ?? 'lesson'}
                      onValueChange={(type, lbl) => updateSlot(dow, slot._key, { blockType: type, label: lbl })}
                      customs={customPresets}
                      onCustomsChange={setCustomPresets}
                    />

                    <span className="dy-input ds-time">
                      <input
                        value={slot.startTime}
                        onChange={e => updateSlot(dow, slot._key, { startTime: formatHHMM(e.target.value) })}
                        placeholder="08:00"
                        aria-label="Начало"
                        inputMode="numeric"
                        maxLength={5}
                      />
                    </span>
                    <span className="dy-input ds-time">
                      <input
                        value={slot.endTime}
                        onChange={e => updateSlot(dow, slot._key, { endTime: formatHHMM(e.target.value) })}
                        placeholder="08:45"
                        aria-label="Конец"
                        inputMode="numeric"
                        maxLength={5}
                      />
                    </span>

                    <div className="ds-what">
                      {isLesson ? (
                        <Select
                          value={slot.subjectId}
                          onValueChange={v => updateSlot(dow, slot._key, { subjectId: v })}
                        >
                          <SelectTrigger className="ds-select" aria-label="Предмет">
                            <SelectValue placeholder="Выбери предмет">
                              {subject ? subject.name : 'Выбери предмет'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {subjects.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="dy-input">
                          <input
                            value={slot.label ?? ''}
                            onChange={e => updateSlot(dow, slot._key, { label: e.target.value })}
                            placeholder={getBlockLabel(slot.blockType, slot.label ?? '', customPresets)}
                            aria-label="Название блока"
                          />
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeSlot(dow, slot._key)}
                      className="icon-btn"
                      aria-label={`Убрать урок ${slot.lessonNumber}`}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                )
              })}
              <div className="dy-add">
                <span />
                <button type="button" className="btn btn-text" onClick={() => addSlot(dow)}>
                  <Icon name="plus" />
                  Добавить урок
                </button>
              </div>
            </div>
          </section>
        )
      })}

      <div className="glass ds-foot">
        <button type="button" className="btn btn-main" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить расписание'}
        </button>
        <Link className="btn btn-text" href="/dashboard/diary">
          К дневнику
        </Link>
      </div>
    </div>
  )
}
