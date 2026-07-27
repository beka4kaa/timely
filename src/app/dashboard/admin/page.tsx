"use client"

import React, { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Plus, Check, X, Pencil, Search, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  useMe, listTasks, createTask, updateTask, listContests, createContest,
  listPendingSubmissions, listMySubmissions, approveSubmission, rejectSubmission,
  listAdminUsers, updateAdminUserAccess,
  type ContestTask, type Contest, type Submission, type Difficulty, type AdminUser,
} from "@/lib/contest-api"
import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell"

const DIFF_STYLES: Record<Difficulty, string> = {
  easy: "text-emerald-800 border-emerald-200 bg-emerald-50",
  medium: "text-amber-800 border-amber-200 bg-amber-50",
  hard: "text-rose-800 border-rose-200 bg-rose-50",
}
const DIFF_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" }
const SUBMISSION_STATUS_LABEL: Record<Submission["status"], string> = {
  pending: "На проверке",
  approved: "Выполнено",
  rejected: "Отклонено",
}
const SUBMISSION_STATUS_CLASS: Record<Submission["status"], string> = {
  pending: "text-amber-800 border-amber-200 bg-amber-50",
  approved: "text-emerald-800 border-emerald-200 bg-emerald-50",
  rejected: "text-rose-800 border-rose-200 bg-rose-50",
}

function DifficultyBadge({ d }: { d: Difficulty }) {
  return <Badge variant="outline" className={cn("font-medium", DIFF_STYLES[d] ?? "")}>{DIFF_LABEL[d] ?? d}</Badge>
}

function SubmissionStatusBadge({ status }: { status: Submission["status"] }) {
  return (
    <Badge variant="outline" className={cn("font-medium", SUBMISSION_STATUS_CLASS[status] ?? "")}>
      {SUBMISSION_STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/* ──────────────────────────── Users tab ──────────────────────────── */
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listAdminUsers(query)
      .then(setUsers)
      .catch((e) => toast.error(`Не удалось загрузить участников: ${e.message}`))
      .finally(() => setLoading(false))
  }, [query])

  useEffect(() => {
    const id = window.setTimeout(load, 200)
    return () => window.clearTimeout(id)
  }, [load])

  const updateAccess = async (
    user: AdminUser,
    field: "has_full_access" | "is_moderator" | "is_staff",
    value: boolean,
  ) => {
    const key = `${user.id}:${field}`
    setBusy(key)
    try {
      const updated = await updateAdminUserAccess(user.id, { [field]: value })
      setUsers((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      toast.success("Права обновлены")
    } catch (e: any) {
      toast.error(`Не удалось обновить права: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Участники</CardTitle>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            placeholder="Поиск по email или имени"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : users.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Участники не найдены.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Аккаунт</TableHead>
                <TableHead className="w-[90px] text-right">Рейтинг</TableHead>
                <TableHead className="w-[150px] text-right">Решения</TableHead>
                <TableHead className="w-[130px] text-center">Все страницы</TableHead>
                <TableHead className="w-[120px] text-center">Модератор</TableHead>
                <TableHead className="w-[100px] text-center">Staff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="font-medium">{user.name || user.username || user.email}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{user.overall_elo}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {user.submissions_approved}/{user.submissions_total}
                    {user.submissions_pending > 0 && <span className="ml-1 text-amber-400">+{user.submissions_pending}</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={user.has_full_access}
                      disabled={busy !== null}
                      onCheckedChange={(checked) => updateAccess(user, "has_full_access", checked)}
                      aria-label="Полный доступ"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={user.is_moderator}
                      disabled={busy !== null}
                      onCheckedChange={(checked) => updateAccess(user, "is_moderator", checked)}
                      aria-label="Модератор"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={user.is_staff}
                      disabled={busy !== null}
                      onCheckedChange={(checked) => updateAccess(user, "is_staff", checked)}
                      aria-label="Staff"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ──────────────────────────── Tasks tab ──────────────────────────── */
function TasksTab() {
  const [tasks, setTasks] = useState<ContestTask[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ContestTask | null>(null)
  const [form, setForm] = useState({ title: "", condition_text: "", difficulty: "medium" as Difficulty, points: 100 })
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listTasks().then(setTasks).catch((e) => toast.error(`Не удалось загрузить задачи: ${e.message}`)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm({ title: "", condition_text: "", difficulty: "medium", points: 100 }); setOpen(true) }
  const openEdit = (t: ContestTask) => { setEditing(t); setForm({ title: t.title, condition_text: t.condition_text, difficulty: t.difficulty, points: t.points }); setOpen(true) }

  const save = async () => {
    if (!form.title.trim()) { toast.error("Введите название задачи"); return }
    setSaving(true)
    try {
      if (editing) { await updateTask(editing.id, form); toast.success("Задача обновлена") }
      else { await createTask(form); toast.success("Задача создана") }
      setOpen(false); load()
    } catch (e: any) { toast.error(`Ошибка: ${e.message}`) } finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">Задачи</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />Создать задачу</Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : tasks.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Пока нет задач. Создайте первую.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead className="w-[120px]">Сложность</TableHead>
                <TableHead className="w-[90px] text-right">Очки</TableHead>
                <TableHead className="w-[110px]">Статус</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.title || <span className="text-muted-foreground">(без названия)</span>}</TableCell>
                  <TableCell><DifficultyBadge d={t.difficulty} /></TableCell>
                  <TableCell className="text-right tabular-nums">{t.points}</TableCell>
                  <TableCell><span className="text-xs text-muted-foreground capitalize">{t.status}</span></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Редактировать задачу" : "Новая задача"}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <Input placeholder="Название задачи" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea placeholder="Условие задачи (поддерживается markdown)" rows={6} value={form.condition_text} onChange={(e) => setForm({ ...form, condition_text: e.target.value })} />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1.5 block">Сложность</label>
                <Select value={form.difficulty} onValueChange={(v) => setForm({ ...form, difficulty: v as Difficulty })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <label className="text-xs text-muted-foreground mb-1.5 block">Очки</label>
                <Input type="number" value={form.points} onChange={(e) => setForm({ ...form, points: Number(e.target.value) || 0 })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}{editing ? "Сохранить" : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* ──────────────────────────── Contests tab ──────────────────────────── */
function ContestsTab() {
  const [contests, setContests] = useState<Contest[]>([])
  const [tasks, setTasks] = useState<ContestTask[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: "", description: "", start_time: "", end_time: "" })
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([listContests(), listTasks()])
      .then(([c, t]) => { setContests(c); setTasks(t) })
      .catch((e) => toast.error(`Ошибка загрузки: ${e.message}`))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const openNew = () => { setForm({ title: "", description: "", start_time: "", end_time: "" }); setSelected(new Set()); setOpen(true) }
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async () => {
    if (!form.title.trim()) { toast.error("Введите название контеста"); return }
    if (!form.start_time || !form.end_time) { toast.error("Укажите время начала и конца"); return }
    setSaving(true)
    try {
      await createContest({ ...form, tasks: Array.from(selected) })
      toast.success("Контест создан"); setOpen(false); load()
    } catch (e: any) { toast.error(`Ошибка: ${e.message}`) } finally { setSaving(false) }
  }

  const fmt = (s: string) => (s ? new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—")

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">Контесты</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />Создать контест</Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : contests.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Контестов пока нет.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead className="w-[140px]">Начало</TableHead>
                <TableHead className="w-[140px]">Конец</TableHead>
                <TableHead className="w-[80px] text-right">Задач</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contests.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.title}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmt(c.start_time)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{fmt(c.end_time)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.task_details?.length ?? c.tasks.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Новый контест</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3 py-1">
            <Input placeholder="Название контеста" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea placeholder="Описание (необязательно)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1.5 block">Начало</label>
                <Input type="datetime-local" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1.5 block">Конец</label>
                <Input type="datetime-local" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Задачи ({selected.size} выбрано)</label>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {tasks.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">Сначала создайте задачи.</p>
                ) : tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    className={cn("w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50", selected.has(t.id) && "bg-muted/60")}
                  >
                    <span className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0", selected.has(t.id) ? "bg-primary border-primary" : "border-border")}>
                      {selected.has(t.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                    </span>
                    <span className="flex-1 truncate">{t.title || "(без названия)"}</span>
                    <DifficultyBadge d={t.difficulty} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

/* ──────────────────────────── Review tab ──────────────────────────── */
function ReviewTab() {
  const [subs, setSubs] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listPendingSubmissions().then(setSubs).catch((e) => toast.error(`Ошибка: ${e.message}`)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (id: number, kind: "approve" | "reject") => {
    setBusy(id)
    try {
      if (kind === "approve") { const r = await approveSubmission(id); toast.success(`Принято · +${r.task_points} к рейтингу`) }
      else { await rejectSubmission(id); toast.success("Отклонено") }
      setSubs((s) => s.filter((x) => x.id !== id))
    } catch (e: any) { toast.error(`Ошибка: ${e.message}`) } finally { setBusy(null) }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Проверка решений {subs.length > 0 && <span className="text-muted-foreground font-normal">· {subs.length} в очереди</span>}</CardTitle></CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : subs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Нет решений на проверке.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Студент</TableHead>
                <TableHead>Задача</TableHead>
                <TableHead>Решение</TableHead>
                <TableHead className="w-[70px] text-right">Очки</TableHead>
                <TableHead className="w-[140px] text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">{s.student_name}<div className="text-xs text-muted-foreground">{s.student_email}</div></TableCell>
                  <TableCell className="text-sm">{s.task_title || `#${s.task}`}</TableCell>
                  <TableCell className="max-w-[260px]"><code className="text-xs text-muted-foreground break-all line-clamp-2">{s.file_url_or_code || s.student_solution_image || "—"}</code></TableCell>
                  <TableCell className="text-right tabular-nums">{s.task_points}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button size="icon" variant="outline" className="h-8 w-8 text-emerald-400 hover:text-emerald-300 border-emerald-400/30" disabled={busy === s.id} onClick={() => act(s.id, "approve")}><Check className="w-4 h-4" /></Button>
                      <Button size="icon" variant="outline" className="h-8 w-8 text-rose-400 hover:text-rose-300 border-rose-400/30" disabled={busy === s.id} onClick={() => act(s.id, "reject")}><X className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ──────────────────────────── Submissions tab ──────────────────────────── */
function SubmissionsTab() {
  const [subs, setSubs] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listMySubmissions()
      .then(setSubs)
      .catch((e) => toast.error(`Ошибка загрузки решений: ${e.message}`))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (id: number, kind: "approve" | "reject") => {
    setBusy(id)
    try {
      const updated = kind === "approve" ? await approveSubmission(id) : await rejectSubmission(id)
      setSubs((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      toast.success(kind === "approve" ? "Решение принято" : "Решение отклонено")
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Все решения</CardTitle></CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : subs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Решений пока нет.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Студент</TableHead>
                <TableHead>Задача</TableHead>
                <TableHead className="w-[120px]">Статус</TableHead>
                <TableHead>Ответ</TableHead>
                <TableHead className="w-[130px] text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">
                    {s.student_name}
                    <div className="text-xs text-muted-foreground">{s.student_email}</div>
                  </TableCell>
                  <TableCell className="text-sm">{s.task_title || `#${s.task}`}</TableCell>
                  <TableCell><SubmissionStatusBadge status={s.status} /></TableCell>
                  <TableCell className="max-w-[260px]">
                    <code className="text-xs text-muted-foreground break-all line-clamp-2">
                      {s.file_url_or_code || s.student_solution_image || "—"}
                    </code>
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === "pending" ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="icon" variant="outline" className="h-8 w-8 text-emerald-400 hover:text-emerald-300 border-emerald-400/30" disabled={busy === s.id} onClick={() => act(s.id, "approve")}><Check className="w-4 h-4" /></Button>
                        <Button size="icon" variant="outline" className="h-8 w-8 text-rose-400 hover:text-rose-300 border-rose-400/30" disabled={busy === s.id} onClick={() => act(s.id, "reject")}><X className="w-4 h-4" /></Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ──────────────────────────── Page ──────────────────────────── */
export default function AdminPage() {
  const router = useRouter()
  const { me, loading } = useMe()

  useEffect(() => {
    if (!loading && !me?.is_admin) {
      router.replace("/dashboard/diary")
    }
  }, [loading, me?.is_admin, router])

  if (loading) {
    return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  if (!me?.is_admin) {
    return null
  }

  return (
    <CoffeePageShell
      eyebrow="Управление Timely"
      title="Админ-панель"
      description="Аккаунты, рейтинг, доступы, задачи и решения."
      icon={<ShieldCheck className="h-5 w-5" />}
      contentClassName="max-w-6xl"
    >
      <Tabs defaultValue="users">
        <TabsList className="h-auto flex-wrap justify-start rounded-[14px] border border-[#ded8cf] bg-[#f0ece5] p-1">
          <TabsTrigger value="users">Участники</TabsTrigger>
          <TabsTrigger value="submissions">Решения</TabsTrigger>
          <TabsTrigger value="review">Проверка</TabsTrigger>
          <TabsTrigger value="tasks">Задачи</TabsTrigger>
          <TabsTrigger value="contests">Контесты</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="submissions" className="mt-4"><SubmissionsTab /></TabsContent>
        <TabsContent value="review" className="mt-4"><ReviewTab /></TabsContent>
        <TabsContent value="tasks" className="mt-4"><TasksTab /></TabsContent>
        <TabsContent value="contests" className="mt-4"><ContestsTab /></TabsContent>
      </Tabs>
    </CoffeePageShell>
  )
}
