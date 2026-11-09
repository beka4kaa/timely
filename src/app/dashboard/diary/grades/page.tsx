"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Icon } from "@/components/shell/icons"
import { SubNav } from "@/components/shell/tab-bar"
import { useDiaryYearStats } from "@/hooks/use-diary-year-stats"
import { calcMonthStats } from "@/lib/diary-grades"
import { MONTH_SHORT } from "@/lib/diary-grades"
import { plural } from "@/lib/now-feed"

// Учебный год: сентябрь–август
const SCHOOL_MONTHS: number[] = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]

/** Оценка от руки. Цвет только у тройки и ниже: остальное здесь не повод для тревоги. */
function GradeMark({ value, digits }: { value: number | null; digits?: number }) {
  if (value === null) return null
  const text = digits === undefined && Number.isInteger(value)
    ? String(value)
    : value.toFixed(digits ?? 1).replace(".", ",")
  const rounded = Math.min(5, Math.max(1, Math.round(value)))
  return <span className={`g g${rounded}`}>{text}</span>
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

type View = "month" | "year" | "videos"

const VIEWS: Array<{ value: View; title: string }> = [
  { value: "month", title: "По месяцу" },
  { value: "year", title: "За год" },
  { value: "videos", title: "Видео" },
]

function getYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0]
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v")
  } catch {}
  return null
}

/** Адрес, который можно открыть: `javascript:` в href выполнился бы по клику. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

function clockLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${hours > 0 ? `${hours}:` : ""}${String(minutes % 60).padStart(2, "0")}`
}

export default function GradesPage() {
  const now = new Date()
  const defaultSchoolYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  const [schoolYearStart, setSchoolYearStart] = useState(defaultSchoolYear)
  const [view, setView] = useState<View>("month")

  // Текущий месяц в пределах учебного года
  const initMonth = now.getMonth() // 0-11
  const initYear = now.getFullYear()
  const [viewYear, setViewYear] = useState(initYear)
  const [viewMonth, setViewMonth] = useState(initMonth)

  // Данные учебного года Y1 (sep-dec) и Y2 (jan-aug)
  const { stats: statsY1, weeks: weeksY1, loading: l1, error: e1, refetch: r1 } = useDiaryYearStats(schoolYearStart)
  const { stats: statsY2, weeks: weeksY2, loading: l2, error: e2, refetch: r2 } = useDiaryYearStats(schoolYearStart + 1)
  const loading = l1 || l2
  const failed = Boolean(e1 || e2)
  const allWeeks = useMemo(() => [...weeksY1, ...weeksY2], [weeksY1, weeksY2])

  // Годовые строки
  const yearRows = useMemo(() => {
    const ids = Array.from(new Set([...statsY1.map(s => s.subjectId), ...statsY2.map(s => s.subjectId)]))
    return ids.map(id => {
      const s1 = statsY1.find(s => s.subjectId === id)
      const s2 = statsY2.find(s => s.subjectId === id)
      const ref = s1 ?? s2!
      const monthlyGrades: (number | null)[] = SCHOOL_MONTHS.map(m =>
        m >= 8 ? (s1?.monthlyGrades[m] ?? null) : (s2?.monthlyGrades[m] ?? null)
      )
      const filled = monthlyGrades.filter((v): v is number => v !== null)
      const yearlyGrade = filled.length === 0
        ? null
        : Math.round(filled.reduce((a, b) => a + b, 0) / filled.length * 10) / 10
      return { ...ref, monthlyGrades, yearlyGrade }
    })
  }, [statsY1, statsY2])

  // Месячные строки
  const monthStats = useMemo(
    () => calcMonthStats(allWeeks, viewYear, viewMonth),
    [allWeeks, viewYear, viewMonth]
  )

  const totalDays = daysInMonth(viewYear, viewMonth)
  const dayNumbers = Array.from({ length: totalDays }, (_, i) => i + 1)

  function isoDay(d: number): string {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y: number) => y - 1) }
    else setViewMonth((m: number) => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y: number) => y + 1) }
    else setViewMonth((m: number) => m + 1)
  }

  const monthLabel = `${MONTH_SHORT[viewMonth]} ${viewYear}`

  function renderMonth() {
    if (monthStats.length === 0) {
      return (
        <div className="card dy-empty">
          <h2>{monthLabel}: оценок нет</h2>
          <p>Ставь оценки в дневнике, и они появятся здесь.</p>
          <Link className="btn btn-line" href="/dashboard/plan">Открыть неделю</Link>
        </div>
      )
    }
    return (
      <div className="card dy-tbl-card">
        <div className="dy-tbl-wrap" tabIndex={0} aria-label={`Оценки за ${monthLabel}`}>
          <table className="dy-tbl is-month">
            <colgroup>
              <col style={{ width: "138px" }} />
              {dayNumbers.map(d => <col key={d} />)}
              <col style={{ width: "54px" }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="dy-pin dy-pin-l">Предмет</th>
                {dayNumbers.map(d => <th key={d} scope="col">{d}</th>)}
                <th scope="col" className="dy-pin dy-pin-r">Итог</th>
              </tr>
            </thead>
            <tbody>
              {monthStats.map(row => (
                <tr key={row.subjectId}>
                  <th scope="row" className="dy-pin dy-pin-l" title={row.subjectName}>{row.subjectName}</th>
                  {dayNumbers.map(d => (
                    <td key={d}><GradeMark value={row.byDay[isoDay(d)] ?? null} /></td>
                  ))}
                  <td className="dy-pin dy-pin-r">
                    {row.monthGrade === null ? "" : <GradeMark value={row.monthGrade} digits={1} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderYear() {
    if (yearRows.length === 0) {
      return (
        <div className="card dy-empty">
          <h2>Нет оценок за {schoolYearStart}–{schoolYearStart + 1}</h2>
          <p>Ставь оценки в дневнике, и здесь появится итог по предметам.</p>
          <Link className="btn btn-line" href="/dashboard/plan">Открыть неделю</Link>
        </div>
      )
    }
    const yearAverages = yearRows.map(r => r.yearlyGrade).filter((v): v is number => v !== null)
    const yearAverage = yearAverages.length === 0
      ? null
      : Math.round(yearAverages.reduce((a, b) => a + b, 0) / yearAverages.length * 10) / 10
    return (
      <div className="card dy-tbl-card">
        <div className="dy-tbl-wrap" tabIndex={0} aria-label={`Оценки за ${schoolYearStart}–${schoolYearStart + 1}`}>
          <table className="dy-tbl is-year">
            <thead>
              <tr>
                <th scope="col" className="dy-pin dy-pin-l">Предмет</th>
                {SCHOOL_MONTHS.map(m => <th key={m} scope="col">{MONTH_SHORT[m]}</th>)}
                <th scope="col" className="dy-pin dy-pin-r">Год</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map(row => (
                <tr key={row.subjectId}>
                  <th scope="row" className="dy-pin dy-pin-l">{row.subjectName}</th>
                  {row.monthlyGrades.map((grade, mi) => (
                    <td key={mi}><GradeMark value={grade} digits={1} /></td>
                  ))}
                  <td className="dy-pin dy-pin-r"><GradeMark value={row.yearlyGrade} digits={1} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="dy-pin dy-pin-l">Среднее</th>
                {SCHOOL_MONTHS.map((_, mi) => {
                  const vals = yearRows.map(r => r.monthlyGrades[mi]).filter((v): v is number => v !== null)
                  const avg = vals.length === 0 ? null : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
                  return <td key={mi}><GradeMark value={avg} digits={1} /></td>
                })}
                <td className="dy-pin dy-pin-r"><GradeMark value={yearAverage} digits={1} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  function renderVideos() {
    const isoPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`
    const videos: { url: string; label?: string; durationMin?: number; date: string; dayName: string }[] = []
    for (const week of allWeeks) {
      for (const day of week.days) {
        if (!day.date.startsWith(isoPrefix)) continue
        const d = new Date(day.date)
        const dayName = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric" })
        for (const link of (day.youtubeLinks ?? [])) {
          videos.push({ url: link.url, label: link.label, durationMin: link.durationMin, date: day.date, dayName })
        }
      }
    }
    if (videos.length === 0) {
      return (
        <div className="card dy-empty">
          <h2>{monthLabel}: видео нет</h2>
          <p>Добавляй ссылки на записи уроков в дневнике, и они появятся здесь.</p>
          <Link className="btn btn-line" href="/dashboard/plan">Открыть неделю</Link>
        </div>
      )
    }
    const totalMin = videos.reduce((s, v) => s + (v.durationMin ?? 0), 0)
    return (
      <>
        <p className="dg-sum">
          <span>{videos.length} видео</span>
          {totalMin > 0 && (
            <span>
              {Math.floor(totalMin / 60) > 0 ? `${Math.floor(totalMin / 60)} ч ` : ""}
              {totalMin % 60} {plural(totalMin % 60, ["минута", "минуты", "минут"])}
            </span>
          )}
        </p>
        <div className="dg-videos">
          {videos.map((v, i) => {
            const vid = getYoutubeId(v.url)
            return (
              <a
                key={i}
                href={isWebUrl(v.url) ? v.url : undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="card dg-video"
              >
                <span className="dg-video-art">
                  {vid ? (
                    <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt="" loading="lazy" />
                  ) : null}
                  {v.durationMin != null && v.durationMin > 0 && (
                    <span className="dg-video-time">{clockLabel(v.durationMin)}</span>
                  )}
                </span>
                <span className="dg-video-b">
                  <b>{v.label ?? "YouTube"}</b>
                  <small>{v.dayName}</small>
                </span>
              </a>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <div className="content view">
      <SubNav group="study" />
      <header className="head">
        <h1 className="title">Итоговые оценки</h1>
        <div className="head-tools">
          <Link className="btn btn-text" href="/dashboard/plan">
            <Icon name="chev-l" />
            Неделя
          </Link>
          <div className="tabs" role="group" aria-label="Что показать">
            {VIEWS.map(item => (
              <button
                key={item.value}
                type="button"
                aria-pressed={view === item.value}
                onClick={() => setView(item.value)}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view === "year" ? (
        <div className="dg-bar">
          <div className="pager dg-year">
            <button type="button" className="icon-btn" aria-label="Прошлый учебный год" onClick={() => setSchoolYearStart(y => y - 1)}>
              <Icon name="chev-l" />
            </button>
            <span aria-live="polite">{schoolYearStart}–{schoolYearStart + 1}</span>
            <button type="button" className="icon-btn" aria-label="Следующий учебный год" onClick={() => setSchoolYearStart(y => y + 1)}>
              <Icon name="chev-r" />
            </button>
          </div>
        </div>
      ) : (
        <div className="dg-bar">
          <div className="pager">
            <button type="button" className="icon-btn" aria-label="Прошлый месяц" onClick={prevMonth}>
              <Icon name="chev-l" />
            </button>
            <span aria-live="polite">{monthLabel}</span>
            <button type="button" className="icon-btn" aria-label="Следующий месяц" onClick={nextMonth}>
              <Icon name="chev-r" />
            </button>
          </div>
          <div className="tabs scroll dg-months" role="group" aria-label="Месяц учебного года">
            {SCHOOL_MONTHS.map(m => {
              const y = m >= 8 ? schoolYearStart : schoolYearStart + 1
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={m === viewMonth && y === viewYear}
                  onClick={() => { setViewMonth(m); setViewYear(y) }}
                >
                  {MONTH_SHORT[m]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {failed ? (
        <div className="card dy-empty" role="alert">
          <h2>Оценки не загрузились</h2>
          <p>В дневнике всё на месте, это ошибка связи.</p>
          <button type="button" className="btn btn-line" onClick={() => { r1(); r2() }}>Повторить</button>
        </div>
      ) : loading ? (
        <p className="dy-note" role="status">Загружаю оценки…</p>
      ) : view === "month" ? (
        renderMonth()
      ) : view === "videos" ? (
        renderVideos()
      ) : (
        renderYear()
      )}
    </div>
  )
}
