// Что показать ученику, пока идёт ответ и когда он не получился.
//
// Свой словарь, а не общий с доской (`board-stages.ts`): у доски свои этапы
// («рисую схему»).

import { citationSpot } from "../../lib/book-label.ts";
import { plural, t } from "../../lib/i18n";

export function stageLabel(stage: string, found?: number): string {
  if (stage === "retrieving") return t("Ищу в книге");
  if (stage === "found") {
    return found
      ? plural(found, "Нашёл {n} фрагмент", "Нашёл {n} фрагмента", "Нашёл {n} фрагментов")
      : t("В книге не нашлось");
  }
  // Этап виден, только пока модель молчит: у GLM это её обязательное рассуждение.
  return t("Думаю");
}

/** Подпись текущего этапа ответа. Пока тьютор смотрит дела ученика, её присылает сервер. */
export function turnStage(turn: { stage?: string; found?: number; toolLabel?: string }): string {
  return turn.toolLabel || stageLabel(turn.stage ?? "", turn.found);
}

export function fragmentWord(count: number): string {
  return plural(count, "фрагмент", "фрагмента", "фрагментов");
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
export const STOPPED_ERROR = "Остановлено."; // i18n-skip

const EMPTY_ERROR = "Пустой ответ."; // i18n-skip
const NOT_FOUND_ERROR = "Предмет не найден."; // i18n-skip
const NETWORK = /failed to fetch|load failed|networkerror|network error/i;
/** Лимит от сервера приходит по-русски: по русскому тексту и узнаём, показываем переведённым. */
const LIMIT = /лимит/i;
/** Свой текст о лимите (`limitMessage`) уже на языке интерфейса: в нём время обновления. */
const OWN_LIMIT_EN = /^(AI|Request) limit reached\./;

/**
 * Понятная фраза вместо технической ошибки.
 *
 * Сервер присылает общую фразу, а браузер и сеть могут подставить свою, с адресами и кодами.
 * Ученику от них пользы нет: подробности остаются в журнале сервера. Текст о лимите приходит
 * готовым: в нём время обновления (`limitMessage`).
 *
 * `raw` — исходный текст ошибки, без перевода: разбор идёт по русским фразам сервера, а
 * перевод делается здесь, при показе.
 */
export function askErrorText(raw: string): string {
  if (raw === STOPPED_ERROR) return t("Остановлено");
  if (raw === EMPTY_ERROR) return t("Тьютор ничего не ответил. Попробуй спросить ещё раз.");
  if (raw === NOT_FOUND_ERROR) return t("Этой книги больше нет. Выбери другую и спроси ещё раз.");
  if (LIMIT.test(raw)) return t(raw);
  if (OWN_LIMIT_EN.test(raw)) return raw;
  if (NETWORK.test(raw)) return t("Нет связи с сервером. Проверь интернет и попробуй ещё раз.");
  return t("Тьютор сейчас не отвечает. Попробуй ещё раз через минуту.");
}
