// Что показать ученику, пока идёт ответ и когда он не получился.
//
// Свой словарь, а не общий с доской (`board-stages.ts`): у доски свои этапы
// («рисую схему»).

import { citationSpot } from "@/lib/book-label";

export function stageLabel(stage: string, found?: number): string {
  if (stage === "retrieving") return "Ищу в книге";
  if (stage === "found") {
    return found ? `Нашёл ${found} ${fragmentWord(found)}` : "В книге не нашлось";
  }
  return "Отвечаю";
}

export function fragmentWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "фрагментов";
  if (ones === 1) return "фрагмент";
  if (ones >= 2 && ones <= 4) return "фрагмента";
  return "фрагментов";
}

/** Место в книге. В разделе без значка параграфа ставим его сами: «§8, стр. 38», а не «8, стр. 38». */
export function placeLabel(citation: {
  section_path: string;
  page_start: number;
  page_end: number;
}): string {
  const spot = citationSpot(citation);
  return /^\d/.test(spot) ? `§${spot}` : spot;
}

/** Ученик сам остановил ответ, а модель ещё ничего не сказала. Это не сбой. */
export const STOPPED_ERROR = "Остановлено.";

const EMPTY_ERROR = "Пустой ответ.";
const NOT_FOUND_ERROR = "Предмет не найден.";
const NETWORK = /failed to fetch|load failed|networkerror|network error/i;

/**
 * Понятная фраза вместо технической ошибки.
 *
 * В потоке сервер отдаёт текст исключения как есть, а там бывают адреса, коды и имена
 * классов. Ученику от них пользы нет: подробности остаются в журнале сервера.
 */
export function askErrorText(raw: string): string {
  if (raw === STOPPED_ERROR) return "Остановлено";
  if (raw === EMPTY_ERROR) return "Тьютор ничего не ответил. Попробуй спросить ещё раз.";
  if (raw === NOT_FOUND_ERROR) return "Этой книги больше нет. Выбери другую и спроси ещё раз.";
  if (NETWORK.test(raw)) return "Нет связи с сервером. Проверь интернет и попробуй ещё раз.";
  return "Тьютор сейчас не отвечает. Попробуй ещё раз через минуту.";
}
