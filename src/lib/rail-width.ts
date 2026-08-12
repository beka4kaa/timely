// Ширина панели вопросов: границы и зажим.
//
// Чистые функции, отдельно от React: ширину зажимают в трёх местах — при
// загрузке из localStorage, при перетаскивании и при смене размера окна, — и
// три копии одного правила разъехались бы на первой же правке.

/** Уже этого панель перестаёт быть читаемой: ответ с формулами не помещается. */
export const RAIL_MIN_PX = 280;

/**
 * Дальше половины экрана не тянем.
 *
 * За этой границей странице слева нужен уже собственный узкий вид — это работа
 * по каждой странице дашборда, а не одна правка каталога.
 */
export const RAIL_MAX_SHARE = 0.5;

/**
 * Ширина по умолчанию и по двойному клику.
 *
 * Раньше это была четверть экрана, и на широком мониторе панель забирала 400+
 * px — рядом с календарём она начинала спорить с ним за главную роль. Триста
 * двадцать хватает разговору и оставляют неделе всё остальное. Растянуть
 * по-прежнему можно: это дефолт, а не потолок.
 */
export const RAIL_DEFAULT_PX = 320;

/** Шаг стрелками. Заметный, но не прыжок через полэкрана. */
export const RAIL_KEYBOARD_STEP = 32;

export function railBounds(viewportWidth: number): { min: number; max: number } {
  const max = Math.round(viewportWidth * RAIL_MAX_SHARE);
  // На узком окне верхняя граница может оказаться ниже нижней. Панель тогда
  // просто занимает половину: отдать ей 280 px из 500 значило бы оставить
  // странице меньше, чем ей самой.
  return { min: Math.min(RAIL_MIN_PX, max), max };
}

/** Зажимает ширину в допустимые границы для текущего окна. */
export function clampRailWidth(width: number, viewportWidth: number): number {
  const { min, max } = railBounds(viewportWidth);
  if (!Number.isFinite(width)) return defaultRailWidth(viewportWidth);
  return Math.round(Math.min(max, Math.max(min, width)));
}

export function defaultRailWidth(viewportWidth: number): number {
  return clampRailWidth(RAIL_DEFAULT_PX, viewportWidth);
}

/**
 * Ширина из сохранённого значения.
 *
 * Зажим обязателен: экран мог смениться на меньший, и сохранённые с монитора
 * 900 px оставили бы от страницы полосу.
 */
export function restoreRailWidth(
  stored: string | null,
  viewportWidth: number,
): number {
  const parsed = Number.parseInt(stored ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultRailWidth(viewportWidth);
  }
  return clampRailWidth(parsed, viewportWidth);
}

/** Доля экрана для подписи при перетаскивании. */
export function railShareLabel(width: number, viewportWidth: number): string {
  if (viewportWidth <= 0) return "";
  return `${Math.round((width / viewportWidth) * 100)} %`;
}
