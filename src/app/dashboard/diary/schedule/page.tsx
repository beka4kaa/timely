"use client"

// Шаблон расписания: вся неделя таблицей. Правки копятся на странице и уходят в базу кнопкой
// «Сохранить»: шаблон пишется целиком, и по нему дневник собирает недели без записей.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { LessonEditor, type BlockOption, type TemplateSubject } from "@/components/diary/lesson-editor"
import { exportTemplateCsv, parseTemplateCsv } from "@/components/diary/template-csv"
import { WeekTable } from "@/components/diary/week-table"
import {
  addLesson,
  clearDay,
  copyDay,
  emptyWeek,
  moveToDay,
  removeLesson,
  retime,
  sameWeek,
  setContent,
  slotsFrom,
  swapLessons,
  weekFrom,
  type SlotContent,
  type SlotDraft,
  type SlotRef,
  type WeekDays,
} from "@/components/diary/week-template"
import { Icon } from "@/components/shell/icons"
import { SubNav } from "@/components/shell/tab-bar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { dataChanged, useDataChanged } from "@/lib/data-changed"
import { invalidateResources } from "@/lib/resource-cache"
import { createSubject } from "@/lib/weak-topics-api"
import { BLOCK_TYPE_META, DAYS_ORDER, DAY_OF_WEEK_LABELS, PRESET_BLOCK_TYPES } from "@/types/diary"
import type { DayOfWeek, WeeklyTemplate } from "@/types/diary"

const DEFAULT_NAME = "Школьное расписание"
const JSON_HEADERS = { "Content-Type": "application/json" }

// ── Свои виды блоков: живут в браузере, как и раньше ─────────────────────────
const CUSTOM_KEY = "schedule_custom_block_types"

interface CustomPreset {
  value: string
  label: string
  emoji: string
}

function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCustomPresets(presets: CustomPreset[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(presets))
  } catch {
    // Без хранилища вид блока проживёт до перезагрузки.
  }
}

// ── Цвет предмета ────────────────────────────────────────────────────────────
// У предмета без своего цвета стоит общий фиолетовый: в таблице все точки слились бы.
const DEFAULT_SUBJECT_COLOR = "#8b5cf6"
const PALETTE = ["#5b7cfa", "#e0803a", "#2fa37a", "#d4556b", "#3aa0b8", "#b5803c", "#8a63e8", "#5aa84e", "#c9568f", "#4f8ad1", "#3e9a8a", "#9aa13a"]

function colorOf(name: string, color?: string | null): string {
  if (color && color.toLowerCase() !== DEFAULT_SUBJECT_COLOR && color.toLowerCase() !== "#6366f1") return color
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

function toSubject(row: { id: string | number; name: string; color?: string | null }): TemplateSubject {
  return { id: String(row.id), name: row.name, color: colorOf(row.name, row.color) }
}

export default function SchedulePage() {
  const isPhone = useIsMobile()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<TemplateSubject[]>([])
  const [templates, setTemplates] = useState<WeeklyTemplate[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [name, setName] = useState(DEFAULT_NAME)
  const [week, setWeek] = useState<WeekDays>(emptyWeek)
  const [saved, setSaved] = useState<{ name: string; week: WeekDays }>(() => ({ name: DEFAULT_NAME, week: emptyWeek() }))
  const [selected, setSelected] = useState<SlotRef | null>(null)
  const [swapFrom, setSwapFrom] = useState<SlotRef | null>(null)
  const [shift, setShift] = useState(true)
  const [showSunday, setShowSunday] = useState(false)
  const [missing, setMissing] = useState<Set<string>>(() => new Set())
  const [customs, setCustoms] = useState<CustomPreset[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const pendingDelete = useRef<{ timer: ReturnType<typeof setTimeout>; restore: () => void } | null>(null)

  useEffect(() => setCustoms(loadCustomPresets()), [])

  const activeId = templates.find((row) => row.isActive)?.id ?? null
  const isActive = templateId !== null && templateId === activeId
  const dirty = name !== saved.name || !sameWeek(week, saved.week)

  const subjectMap = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects])
  const blocks = useMemo<BlockOption[]>(
    () => [
      ...PRESET_BLOCK_TYPES.filter((type) => type !== "lesson").map((type) => ({
        value: type,
        label: BLOCK_TYPE_META[type].label,
        custom: false,
      })),
      ...customs.map((preset) => ({ value: preset.value, label: preset.label, custom: true })),
    ],
    [customs],
  )
  const blockLabel = useCallback(
    (slot: SlotDraft) => slot.label || blocks.find((block) => block.value === slot.blockType)?.label || slot.blockType,
    [blocks],
  )

  /** Открыть шаблон в таблице. Всё несохранённое уходит. */
  const open = useCallback((template: WeeklyTemplate | null) => {
    const next = template ? weekFrom(template.slots) : emptyWeek()
    const title = template?.name ?? DEFAULT_NAME
    setTemplateId(template?.id ?? null)
    setName(title)
    setWeek(next)
    setSaved({ name: title, week: next })
    setSelected(null)
    setSwapFrom(null)
    setMissing(new Set())
    setShowSunday(next.sunday.length > 0)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [templateResponse, subjectResponse] = await Promise.all([fetch("/api/diary/template"), fetch("/api/subjects")])
      const subjectData = subjectResponse.ok ? await subjectResponse.json() : []
      const subjectList = Array.isArray(subjectData) ? subjectData : (subjectData.results ?? subjectData.subjects ?? [])
      setSubjects(subjectList.map(toSubject))
      if (!templateResponse.ok) throw new Error(String(templateResponse.status))
      const data = (await templateResponse.json()) as { templates?: WeeklyTemplate[]; active: WeeklyTemplate | null }
      const all = data.templates ?? []
      setTemplates(all)
      open(data.active ?? all[0] ?? null)
    } catch {
      toast.error("Расписание не загрузилось. Обнови страницу.")
    } finally {
      setLoading(false)
    }
  }, [open])

  useEffect(() => {
    void load()
  }, [load])

  // Тьютор мог записать расписание из мини-окна. Несохранённое молча не выбрасываем.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  useDataChanged("timetable", () => {
    if (!dirtyRef.current) {
      void load()
      return
    }
    toast("Расписание поменялось в другом месте", {
      description: "Твои несохранённые правки пока здесь.",
      action: { label: "Показать новое", onClick: () => void load() },
    })
  })

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  useEffect(() => {
    if (!swapFrom) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSwapFrom(null)
    }
    window.addEventListener("keydown", cancel)
    return () => window.removeEventListener("keydown", cancel)
  }, [swapFrom])

  const change = (next: WeekDays) => {
    setWeek(next)
    if (missing.size) setMissing(new Set())
  }

  const selectedSlot = selected ? week[selected.day].find((slot) => slot.id === selected.id) ?? null : null
  const days = DAYS_ORDER.filter((day) => day !== "sunday" || showSunday || week.sunday.length > 0)

  // ── Правки таблицы ─────────────────────────────────────────────────────────
  const add = (day: DayOfWeek) => {
    const { week: next, id } = addLesson(week, day, { subjectId: "", blockType: "lesson", label: "" }, () => crypto.randomUUID())
    if (!id) {
      toast.error("После последнего урока до полуночи не осталось времени.")
      return
    }
    change(next)
    setSwapFrom(null)
    setSelected({ day, id })
  }

  const swap = (first: SlotRef, second: SlotRef) => {
    change(swapLessons(week, first, second))
    setSwapFrom(null)
    setSelected(null)
  }

  const move = (from: SlotRef, day: DayOfWeek) => {
    const next = moveToDay(week, from, day)
    if (next === week) {
      toast.error(`В ${DAY_OF_WEEK_LABELS[day].toLowerCase()} после последнего урока не осталось времени.`)
      return
    }
    change(next)
  }

  const copy = (from: DayOfWeek, to: DayOfWeek[]) => {
    // Копия видна сразу в таблице, а отменить её можно полосой сохранения.
    change(copyDay(week, from, to, () => crypto.randomUUID()))
    if (to.includes("sunday")) setShowSunday(true)
  }

  const clear = (day: DayOfWeek) => {
    change(clearDay(week, day))
    setSelected(null)
  }

  const editContent = (content: SlotContent) => {
    if (selected) change(setContent(week, selected, content))
  }

  const editTimes = (start: string, end: string) => {
    if (selected) change(retime(week, selected, start, end, shift))
  }

  const newSubject = async (title: string) => {
    if (!title) return
    try {
      const created = toSubject(await createSubject(title))
      setSubjects((list) => [...list, created])
      editContent({ subjectId: created.id, blockType: "lesson", label: "" })
    } catch {
      toast.error("Предмет не создался. Попробуй ещё раз.")
    }
  }

  const newBlock = (title: string) => {
    if (!title) return
    const preset: CustomPreset = {
      value: title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-Ѐ-ӿ]/gi, "") || `block-${Date.now()}`,
      label: title,
      emoji: "🔖",
    }
    const next = [...customs.filter((row) => row.value !== preset.value), preset]
    setCustoms(next)
    saveCustomPresets(next)
    editContent({ subjectId: "", blockType: preset.value, label: "" })
  }

  const editor = selectedSlot ? (
    <LessonEditor
      key={selectedSlot.id}
      slot={selectedSlot}
      subjects={subjects}
      blocks={blocks}
      shift={shift}
      onShiftChange={setShift}
      onContent={editContent}
      onTimes={editTimes}
      onCreateSubject={newSubject}
      onCreateBlock={newBlock}
      onSwap={() => {
        setSwapFrom(selected)
        setSelected(null)
      }}
      onRemove={() => {
        if (selected) change(removeLesson(week, selected))
        setSelected(null)
      }}
    />
  ) : null

  // ── Сохранение ─────────────────────────────────────────────────────────────
  const save = async () => {
    const empty = DAYS_ORDER.flatMap((day) => week[day]).filter((slot) => slot.blockType === "lesson" && !slot.subjectId)
    if (empty.length) {
      setMissing(new Set(empty.map((slot) => slot.id)))
      return
    }
    setSaving(true)
    try {
      const slots = slotsFrom(week)
      const response = templateId
        ? await fetch("/api/diary/template", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ id: templateId, name, slots }) })
        : await fetch("/api/diary/template", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, slots }) })
      if (!response.ok) throw new Error(String(response.status))
      const stored = (await response.json()) as WeeklyTemplate
      const next = weekFrom(stored.slots)
      setTemplateId(stored.id)
      setWeek(next)
      setSaved({ name: stored.name, week: next })
      setTemplates((list) => {
        const rest = list
          .filter((row) => row.id !== stored.id)
          .map((row) => (stored.isActive ? { ...row, isActive: false } : row))
        return [stored, ...rest]
      })
      // Недели без записей соберутся из нового шаблона при следующем чтении.
      invalidateResources("now:diary:")
      dataChanged("diary")
      toast.success(stored.isActive ? "Сохранено. Новые недели дневника возьмут уроки отсюда." : "Сохранено.")
    } catch {
      toast.error("Не сохранилось. Попробуй ещё раз.")
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    setWeek(saved.week)
    setName(saved.name)
    setSelected(null)
    setSwapFrom(null)
    setMissing(new Set())
  }

  // ── Шаблоны ────────────────────────────────────────────────────────────────
  const unsavedFirst = () => {
    if (!dirty) return false
    toast("Сначала сохрани или отмени изменения")
    return true
  }

  const switchTo = (id: string) => {
    if (id === templateId || unsavedFirst()) return
    open(templates.find((row) => row.id === id) ?? null)
  }

  const run = async (what: string, action: () => Promise<void>, failed: string) => {
    setBusy(what)
    try {
      await action()
    } catch {
      toast.error(failed)
    } finally {
      setBusy(null)
    }
  }

  const createEmpty = () => {
    if (unsavedFirst()) return
    void run(
      "create",
      async () => {
        const response = await fetch("/api/diary/template/create-empty", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: "Новый шаблон" }),
        })
        if (!response.ok) throw new Error(String(response.status))
        const created = (await response.json()) as WeeklyTemplate
        setTemplates((list) => [created, ...list])
        open(created)
        toast.success("Новый шаблон создан")
      },
      "Шаблон не создался",
    )
  }

  const duplicate = () => {
    if (!templateId || unsavedFirst()) return
    void run(
      "duplicate",
      async () => {
        const response = await fetch("/api/diary/template/duplicate", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ templateId }),
        })
        if (!response.ok) throw new Error(String(response.status))
        const created = (await response.json()) as WeeklyTemplate
        setTemplates((list) => [created, ...list])
        open(created)
        toast.success(`Копия «${created.name}» создана`)
      },
      "Копия не создалась",
    )
  }

  const activate = () => {
    if (!templateId || isActive) return
    void run(
      "activate",
      async () => {
        const response = await fetch("/api/diary/template", {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ id: templateId, isActive: true }),
        })
        if (!response.ok) throw new Error(String(response.status))
        setTemplates((list) => list.map((row) => ({ ...row, isActive: row.id === templateId })))
        invalidateResources("now:diary:")
        dataChanged("diary")
        toast.success("Теперь дневник берёт уроки из этого шаблона")
      },
      "Не получилось сделать шаблон активным",
    )
  }

  /** Удаление с паузой на отмену: шаблон уходит через 6 секунд. */
  const remove = () => {
    if (!templateId || isActive || unsavedFirst()) return
    const doomed = templates.find((row) => row.id === templateId)
    if (!doomed) return
    const before = templates
    const rest = templates.filter((row) => row.id !== templateId)
    setTemplates(rest)
    open(rest.find((row) => row.isActive) ?? rest[0] ?? null)

    const restore = () => {
      setTemplates(before)
      open(doomed)
    }
    const timer = setTimeout(async () => {
      pendingDelete.current = null
      const response = await fetch(`/api/diary/template?id=${encodeURIComponent(doomed.id)}`, { method: "DELETE" }).catch(() => null)
      if (!response?.ok) {
        restore()
        toast.error("Шаблон не удалился, он снова на месте")
      }
    }, 6000)
    pendingDelete.current = { timer, restore }
    toast(`Шаблон «${doomed.name}» удалён`, {
      duration: 6000,
      action: {
        label: "Отменить",
        onClick: () => {
          if (!pendingDelete.current) return
          clearTimeout(pendingDelete.current.timer)
          pendingDelete.current.restore()
          pendingDelete.current = null
        },
      },
    })
  }

  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (importRef.current) importRef.current.value = ""
    if (!file || unsavedFirst()) return
    await run(
      "import",
      async () => {
        const rows = parseTemplateCsv(await file.text())
        if (!rows.length) {
          toast.error("Уроки в файле не нашлись. Проверь, что это CSV из экспорта.")
          return
        }
        const byName = new Map(subjects.map((subject) => [subject.name.toLowerCase().trim(), subject]))
        // Старый экспорт ставил перед названием значок предмета.
        const plain = (text: string) => ((text.codePointAt(0) ?? 0) > 0x2000 ? text.replace(/^\S+\s*/, "").trim() : text.trim())
        const slots = rows.map((row) => {
          const isLesson = !row.blockType || row.blockType === "lesson"
          return {
            id: crypto.randomUUID(),
            dayOfWeek: row.dayOfWeek,
            lessonNumber: row.lessonNumber,
            startTime: row.startTime,
            endTime: row.endTime,
            blockType: row.blockType,
            subjectId: isLesson ? (byName.get(plain(row.rawName).toLowerCase())?.id ?? "") : "",
            label: isLesson ? "" : row.rawName,
          }
        })
        const title = file.name.replace(/\.csv$/i, "").replace(/_/g, " ") || "Импорт"
        const created = await fetch("/api/diary/template/create-empty", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name: title }),
        })
        if (!created.ok) throw new Error(String(created.status))
        const template = (await created.json()) as WeeklyTemplate
        const stored = await fetch("/api/diary/template", {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ id: template.id, name: title, slots }),
        })
        if (!stored.ok) throw new Error(String(stored.status))
        const result = (await stored.json()) as WeeklyTemplate
        setTemplates((list) => [result, ...list])
        open(result)
        toast.success(`Загружено уроков: ${rows.length}. Шаблон «${title}»`)
      },
      "Файл не загрузился",
    )
  }

  if (loading) {
    return (
      <div className="content view ds-page">
        <SubNav group="study" />
        <header className="head">
          <h1 className="title">Шаблон расписания</h1>
        </header>
        <p className="dy-note" role="status">
          Загружаю шаблон…
        </p>
      </div>
    )
  }

  const activeName = templates.find((row) => row.isActive)?.name

  return (
    <div className="content view ds-page">
      <SubNav group="study" />
      <header className="head">
        <h1 className="title">Шаблон расписания</h1>
        <div className="head-tools">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="btn btn-line ds-tpl" aria-label="Шаблон и действия с ним">
                <span className="ds-tpl-name">{name}</span>
                {isActive ? <span className="ds-badge">Активный</span> : null}
                <Icon name="chev-d" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ds-menu">
              {templates.length > 1 ? (
                <>
                  <DropdownMenuLabel>Шаблоны</DropdownMenuLabel>
                  {templates.map((row) => (
                    <DropdownMenuItem key={row.id} disabled={dirty && row.id !== templateId} onSelect={() => switchTo(row.id)}>
                      <span className="ds-menu-main">{row.id === templateId ? name : row.name}</span>
                      {row.isActive ? <span className="ds-menu-note">активный</span> : null}
                      {row.id === templateId ? <Icon name="check" /> : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={() => setRenaming(name)}>Переименовать</DropdownMenuItem>
              <DropdownMenuItem disabled={busy !== null} onSelect={createEmpty}>
                Новый шаблон
              </DropdownMenuItem>
              {templateId ? (
                <DropdownMenuItem disabled={busy !== null} onSelect={duplicate}>
                  Сделать копию
                </DropdownMenuItem>
              ) : null}
              {templateId && !isActive ? (
                <DropdownMenuItem disabled={busy !== null} onSelect={activate}>
                  Сделать активным
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              {templateId ? (
                <DropdownMenuItem
                  onSelect={() =>
                    exportTemplateCsv(name, week, (id) => subjectMap.get(id)?.name, blockLabel)
                  }
                >
                  Скачать CSV
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={busy !== null} onSelect={() => importRef.current?.click()}>
                Загрузить из CSV
              </DropdownMenuItem>
              {templateId && !isActive ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="ds-menu-danger" onSelect={remove}>
                    Удалить шаблон
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={importRef} type="file" accept=".csv" className="is-off" onChange={(event) => void importCsv(event)} />
          <Link className="btn btn-text" href="/dashboard/diary">
            <Icon name="chev-l" />
            Дневник
          </Link>
        </div>
      </header>
      <p className="dy-note">Новые недели дневника берут уроки отсюда. Неделя, где уже есть оценки или задания, не меняется.</p>

      {templateId && !isActive ? (
        <div className="card ds-warn">
          <span>
            Этот шаблон не активный{activeName ? `: дневник берёт уроки из «${activeName}»` : ""}.
          </span>
          <button type="button" className="btn btn-line" disabled={busy !== null} onClick={activate}>
            Сделать активным
          </button>
        </div>
      ) : null}

      {swapFrom ? (
        <div className="glass ds-swapbar" role="status">
          <span>Нажми на урок, с которым поменять местами.</span>
          <button type="button" className="btn btn-text" onClick={() => setSwapFrom(null)}>
            Отмена
          </button>
        </div>
      ) : null}

      <WeekTable
        week={week}
        days={days}
        subjects={subjectMap}
        blockLabel={blockLabel}
        selected={selected}
        swapFrom={swapFrom}
        missing={missing}
        editor={isPhone ? null : editor}
        onOpen={(ref) => {
          setSwapFrom(null)
          setSelected(ref)
        }}
        onClose={() => setSelected(null)}
        onAdd={add}
        onSwap={swap}
        onMove={move}
        onCopyDay={copy}
        onClearDay={clear}
        hiddenDay={days.includes("sunday") ? null : "sunday"}
        onShowDay={() => setShowSunday(true)}
      />
      <p className="ds-hint">
        {isPhone
          ? "Нажми на урок, чтобы поменять предмет или время. Удержи и перетащи на другой, чтобы поменять местами."
          : "Перетащи урок на другой, и они поменяются местами, а время останется у своих мест. На «+ урок» другого дня, и урок переедет туда."}
      </p>

      {isPhone ? (
        <Drawer open={Boolean(selectedSlot)} onOpenChange={(value) => (value ? null : setSelected(null))} shouldScaleBackground={false}>
          <DrawerContent className="ds-sheet">
            <DrawerTitle className="ds-sheet-title">
              {selectedSlot && selected
                ? `${DAY_OF_WEEK_LABELS[selected.day]}, ${selectedSlot.lessonNumber}-й урок`
                : "Урок"}
            </DrawerTitle>
            {editor}
          </DrawerContent>
        </Drawer>
      ) : null}

      {dirty ? (
        <div className={`glass ds-foot${missing.size ? " is-alert" : ""}`} role="status">
          <span>
            {missing.size
              ? isPhone
                ? "Выбери предмет"
                : "Выбери предмет у подсвеченного урока"
              : isPhone
                ? "Не сохранено"
                : "Изменения не сохранены"}
          </span>
          <button type="button" className="btn btn-text" onClick={discard} disabled={saving}>
            Отменить
          </button>
          <button type="button" className="btn btn-main" onClick={() => void save()} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      ) : null}

      <Dialog open={renaming !== null} onOpenChange={(value) => (value ? null : setRenaming(null))}>
        <DialogContent className="ds-rename">
          <DialogTitle>Название шаблона</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const title = (renaming ?? "").trim()
              if (title) setName(title)
              setRenaming(null)
            }}
          >
            <input
              autoFocus
              value={renaming ?? ""}
              onChange={(event) => setRenaming(event.target.value)}
              placeholder={DEFAULT_NAME}
              aria-label="Название шаблона"
            />
            <div className="ds-rename-acts">
              <button type="button" className="btn btn-text" onClick={() => setRenaming(null)}>
                Отмена
              </button>
              <button type="submit" className="btn btn-main">
                Готово
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
