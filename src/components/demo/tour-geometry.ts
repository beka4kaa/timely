// Геометрия тура: где вырезать «окно» вокруг цели и куда поставить карточку.
// Чистые функции, чтобы их можно было проверить без браузера.

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export type Placement = "below" | "above" | "over" | "center" | "dock"

/** Отступ карточки от окна. */
export const GAP = 14
/** Отступ от краёв экрана. */
export const MARGIN = 16
/**
 * На такой ширине и уже карточка садится внизу экрана во всю ширину. Совпадает с
 * `max-width: 640px`, где пропадает левая панель и появляются вкладки.
 */
export const DOCK_BELOW = 640
/** Насколько окно шире самой цели. */
export const HOLE_PAD = 8

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** Окно вокруг цели с запасом, обрезанное краями экрана. */
export function holeFor(target: Rect, viewport: Size): Rect {
  const edge = MARGIN / 2
  const top = Math.max(edge, target.top - HOLE_PAD)
  const left = Math.max(edge, target.left - HOLE_PAD)
  const right = Math.min(viewport.width - edge, target.left + target.width + HOLE_PAD)
  const bottom = Math.min(viewport.height - edge, target.top + target.height + HOLE_PAD)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/**
 * Куда поставить карточку. Под окном, если влезает; иначе над ним; если цель
 * высокая и не влезает ни то ни другое, карточка ложится поверх её нижнего угла.
 * Без цели — по центру. На узком экране — всегда внизу, над панелью вкладок
 * (`dockOffset` — её высота с отступом).
 */
export function placeCard(
  hole: Rect | null,
  card: Size,
  viewport: Size,
  dockOffset = 0,
): { top: number; left: number; placement: Placement } {
  if (viewport.width <= DOCK_BELOW) {
    return {
      placement: "dock",
      left: MARGIN,
      top: Math.max(MARGIN, viewport.height - dockOffset - card.height - MARGIN),
    }
  }

  if (!hole) {
    return {
      placement: "center",
      left: clamp((viewport.width - card.width) / 2, MARGIN, viewport.width - card.width - MARGIN),
      top: clamp((viewport.height - card.height) / 2, MARGIN, viewport.height - card.height - MARGIN),
    }
  }

  const centered = hole.left + hole.width / 2 - card.width / 2
  const left = clamp(centered, MARGIN, viewport.width - card.width - MARGIN)

  const below = hole.top + hole.height + GAP
  if (below + card.height <= viewport.height - MARGIN) {
    return { placement: "below", left, top: below }
  }

  const above = hole.top - GAP - card.height
  if (above >= MARGIN) {
    return { placement: "above", left, top: above }
  }

  return {
    placement: "over",
    left: clamp(hole.left + hole.width - card.width - MARGIN, MARGIN, viewport.width - card.width - MARGIN),
    top: clamp(viewport.height - card.height - MARGIN * 2, MARGIN, viewport.height - card.height - MARGIN),
  }
}

/** Путь затемнения с вырезом: весь экран минус скруглённое окно (evenodd). */
export function veilPath(hole: Rect | null, viewport: Size, radius = 16): string {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`
  if (!hole || hole.width <= 0 || hole.height <= 0) return outer
  const r = Math.max(0, Math.min(radius, hole.width / 2, hole.height / 2))
  const x = hole.left
  const y = hole.top
  const w = hole.width
  const h = hole.height
  const inner =
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  return `${outer}${inner}`
}
