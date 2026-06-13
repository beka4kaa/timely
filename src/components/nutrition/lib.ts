/**
 * nutrition/lib.ts
 * ────────────────────────────────────────────────────────────────────
 * Общие типы, токены стекла и помощники для «Трекера калорий и БЖУ».
 *
 * История дня — локальная (localStorage по дню). Библиотека продуктов и
 * поиск по штрихкоду и фото-анализ ходят в Django-бэкенд
 * (/api/nutrition/*, см. backend/nutrition).
 */

import { BACKEND_URL } from '@/lib/api-utils'

/** Один приём пищи / продукт в истории дня. */
export interface FoodEntry {
  id: string
  name: string
  kcal: number
  protein: number
  fat: number
  carbs: number
  /** ISO-строка момента добавления (для сортировки и подписи времени). */
  addedAt: string
}

/** Дневные цели по 4 метрикам. */
export interface Goals {
  kcal: number
  protein: number
  fat: number
  carbs: number
}

/** Суммарные значения за день (тот же набор ключей, что у Goals). */
export type Totals = Goals

export type MacroKey = keyof Goals

/** Дефолтные цели на день (среднестатистические; позже — из профиля). */
export const DEFAULT_GOALS: Goals = {
  kcal: 2200,
  protein: 140,
  fat: 70,
  carbs: 250,
}

/** Метаданные метрики: подпись, единица, цвет кольца (для градиента). */
export interface MacroMeta {
  key: MacroKey
  label: string
  unit: string
  /** Базовый акцентный цвет метрики. */
  color: string
  /** Светлый конец градиента кольца. */
  colorSoft: string
}

export const MACROS: MacroMeta[] = [
  { key: 'kcal', label: 'Калории', unit: 'ккал', color: '#f59e0b', colorSoft: '#fcd34d' },
  { key: 'protein', label: 'Белки', unit: 'г', color: '#fb7185', colorSoft: '#fda4af' },
  { key: 'fat', label: 'Жиры', unit: 'г', color: '#a78bfa', colorSoft: '#c4b5fd' },
  { key: 'carbs', label: 'Углеводы', unit: 'г', color: '#34d399', colorSoft: '#6ee7b7' },
]

/**
 * Glassmorphism 2.0 — тот же язык, что у остального дашборда (habits/lib.ts):
 * полупрозрачный фон, сильное размытие, тонкий светлый бордер, мягкая тень.
 */
// Apple-grade стекло: blur + saturate (цвета за стеклом оживают), тонкий
// светлый бордер, мягкая многослойная тень. saturate — ключ к «дорогому»
// ощущению, без него dark-стекло выглядит плоско-серым.
export const GLASS =
  'bg-white/70 dark:bg-white/[0.055] backdrop-blur-2xl backdrop-saturate-150 ' +
  'border border-white/60 dark:border-white/[0.08] shadow-[0_8px_30px_rgba(15,23,42,0.08)]'

/** Подсвеченное стекло для интерактивных кнопок (hover-отклик). */
export const GLASS_INTERACTIVE =
  'bg-white/60 dark:bg-white/[0.05] backdrop-blur-2xl backdrop-saturate-150 ' +
  'border border-white/60 dark:border-white/[0.08] shadow-[0_8px_30px_rgba(15,23,42,0.08)] ' +
  'transition-all duration-200 hover:bg-white/80 dark:hover:bg-white/[0.09] ' +
  'hover:shadow-[0_12px_40px_rgba(15,23,42,0.12)] hover:-translate-y-0.5'

/** Фирменный peach → lavender акцент (как в habits). */
export const ACCENT_GRADIENT = 'linear-gradient(135deg, #fdba74 0%, #f0abfc 50%, #c4b5fd 100%)'

/** Безопасно парсит число из строки инпута (пустое/мусор → 0, без минусов). */
export function parseNum(v: string): number {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Суммирует список продуктов в дневные тоталы. */
export function sumTotals(entries: FoodEntry[]): Totals {
  return entries.reduce<Totals>(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein: acc.protein + e.protein,
      fat: acc.fat + e.fat,
      carbs: acc.carbs + e.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  )
}

/** "14:05" из ISO-строки. */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Лёгкая тактильная отдача на мобильных (как в habits). */
export function softHaptic() {
  try { navigator.vibrate?.(10) } catch { /* no-op */ }
}

/* ── Библиотека продуктов / штрихкод (Django-бэкенд) ─────────────────
 * БЖУ продуктов из библиотеки приходят НА 100 Г; порцию в граммах
 * пользователь выбирает в UI (scalePortion). */

export interface FoodLibraryItem {
  id: number | string
  name: string
  emoji: string
  category: string
  /** Значения на 100 г. */
  kcal: number
  protein: number
  fat: number
  carbs: number
  barcode: string
  source?: string
  /** Опц. миниатюра (приходит из Open Food Facts). */
  image?: string
}

/** Поиск по локальной библиотеке продуктов. Пустой/ошибочный ответ → []. */
export async function searchFoods(q: string, signal?: AbortSignal): Promise<FoodLibraryItem[]> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/nutrition/foods/?q=${encodeURIComponent(q)}&limit=40`,
      { signal, cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export type OffSearchResult =
  | { ok: true; items: FoodLibraryItem[] }
  | { ok: false; error: string }

/**
 * Текстовый поиск продуктов в Open Food Facts (через бэкенд-прокси — браузер
 * не может выставить требуемый OFF кастомный User-Agent). Debounce — на
 * вызывающей стороне (DiaryTab). Возвращает разделённый ok/error для UI.
 */
export async function searchOpenFoodFacts(q: string, signal?: AbortSignal): Promise<OffSearchResult> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/nutrition/search-off/?q=${encodeURIComponent(q)}`,
      { signal, cache: 'no-store' },
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `Ошибка ${res.status}` }
    const items = Array.isArray(body?.items) ? (body.items as FoodLibraryItem[]) : []
    return { ok: true, items }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { ok: true, items: [] }
    return { ok: false, error: 'Сеть недоступна' }
  }
}

export type BarcodeResult =
  | { found: true; item: FoodLibraryItem }
  | { found: false; error?: string }

/** Поиск продукта по штрихкоду (кэш бэкенда → Open Food Facts). */
export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/nutrition/barcode/${encodeURIComponent(code)}/`,
      { cache: 'no-store' },
    )
    if (res.status === 404) return { found: false }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { found: false, error: body?.error || 'Не удалось найти продукт' }
    }
    return await res.json()
  } catch {
    return { found: false, error: 'Сеть недоступна' }
  }
}

/** Распознанный с фото продукт (БЖУ на 100 г + оценка порции в граммах). */
export interface PhotoFoodItem extends FoodLibraryItem {
  /** Оценка размера видимой на фото порции, г. */
  grams: number
  /** Canonical class from vision model/backend, e.g. "bagel". */
  identifiedClass?: string
  /** Whole-item/catalog baseline before OpenCV completeness adjustment. */
  defaultCatalogWeight?: number
  /** Visible completeness ratio, 0..1. */
  completenessRatio?: number
  /** Diagnostic confidence for the OpenCV portion estimate. */
  portionConfidence?: number
}

/** Собирает распознанные с фото продукты в одну запись "готового блюда". */
export function buildPhotoDishEntry(items: PhotoFoodItem[]): Omit<FoodEntry, 'id' | 'addedAt'> | null {
  const valid = items.filter((item) => item.grams > 0 && item.kcal > 0)
  if (valid.length === 0) return null

  const totals = valid.reduce(
    (acc, item) => {
      const scaled = scalePortion(item, item.grams)
      return {
        kcal: acc.kcal + scaled.kcal,
        protein: acc.protein + scaled.protein,
        fat: acc.fat + scaled.fat,
        carbs: acc.carbs + scaled.carbs,
      }
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  )
  const names = Array.from(new Set(valid.map((item) => item.name.trim()).filter(Boolean)))
  const namePreview = names.slice(0, 3).join(', ')
  const extra = names.length > 3 ? ` +${names.length - 3}` : ''

  return {
    name: valid.length === 1 ? names[0] || 'Блюдо с фото' : `Блюдо с фото: ${namePreview}${extra}`,
    kcal: Math.round(totals.kcal),
    protein: Math.round(totals.protein * 10) / 10,
    fat: Math.round(totals.fat * 10) / 10,
    carbs: Math.round(totals.carbs * 10) / 10,
  }
}

/**
 * Сжимает картинку (File или dataURL) до JPEG с ограничением длинной стороны —
 * чтобы payload в vision provider был лёгким и быстрым. Возвращает data URL.
 */
export async function imageToDataURL(file: File, max = 768, quality = 0.74): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', quality)
}

export type PhotoAnalysisResult =
  | { ok: true; items: PhotoFoodItem[] }
  | { ok: false; error: string }

/** Шлёт фото (data URL) на бэкенд → vision provider → список распознанных продуктов. */
export async function analyzePhoto(dataUrl: string, timeoutMs = 36_000): Promise<PhotoAnalysisResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${BACKEND_URL}/api/nutrition/analyze-photo/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body?.error || `Ошибка ${res.status}` }
    const rawItems = Array.isArray(body?.items) ? body.items : []
    // Достраиваем до FoodLibraryItem-совместимого вида для PortionPicker.
    const items: PhotoFoodItem[] = rawItems.map((it: Record<string, unknown>, i: number) => ({
      id: -1 - i,
      name: String(it.name ?? 'Продукт'),
      emoji: String(it.emoji ?? '🍽'),
      category: 'Фото',
      kcal: Number(it.kcal) || 0,
      protein: Number(it.protein) || 0,
      fat: Number(it.fat) || 0,
      carbs: Number(it.carbs) || 0,
      grams: Number(it.grams) || 100,
      identifiedClass: String(it.identified_class ?? it.identifiedClass ?? '').trim() || undefined,
      defaultCatalogWeight: Number(it.default_catalog_weight ?? it.defaultCatalogWeight) || undefined,
      completenessRatio: Number(it.completeness_ratio ?? it.completenessRatio) || undefined,
      portionConfidence: Number(it.portion_confidence ?? it.portionConfidence) || undefined,
      barcode: '',
      source: 'ai',
    }))
    return { ok: true, items }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return {
        ok: false,
        error: 'Фото-анализ слишком долго отвечает. Попробуйте более светлое фото или кадр поближе.',
      }
    }
    return { ok: false, error: 'Сеть недоступна' }
  } finally {
    window.clearTimeout(timeout)
  }
}

/** Масштабирует БЖУ продукта (на 100 г) на порцию в граммах → запись истории. */
export function scalePortion(
  food: Pick<FoodLibraryItem, 'name' | 'kcal' | 'protein' | 'fat' | 'carbs'>,
  grams: number,
): Omit<FoodEntry, 'id' | 'addedAt'> {
  const k = Math.max(0, grams) / 100
  const round1 = (n: number) => Math.round(n * k * 10) / 10
  return {
    name: food.name,
    kcal: Math.round(food.kcal * k),
    protein: round1(food.protein),
    fat: round1(food.fat),
    carbs: round1(food.carbs),
  }
}

/* ── Локальное хранилище (день) ──────────────────────────────────────
 * Ключ привязан к дате, поэтому «История за день» естественно обнуляется
 * на следующий день. Это заглушка под будущий бэкенд. */

const todayKey = () => `timely.nutrition.${new Date().toISOString().slice(0, 10)}`

export function loadEntries(): FoodEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(todayKey())
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveEntries(entries: FoodEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(todayKey(), JSON.stringify(entries))
  } catch {
    /* quota/private mode — тихо игнорируем */
  }
}
