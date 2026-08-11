// Этапы ответа по книге → строки «заметки на полях».
//
// Свой словарь, а не общий с доской (`board-stages.ts`): у доски свои этапы
// («рисую схему»), и `ThinkingNote` намеренно не знает ни одного набора.

import type { ThinkingStage } from "./thinking-note";
import type { Turn } from "./use-subject-chat";

// Этапы в порядке прохождения. Больше трёх не бывает намеренно: длинный список
// превращает заметку на полях в чеклист.
export const STAGE_ORDER = ["retrieving", "found", "answering"] as const;

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

/** Этапы для заметки: пройденные гаснут, текущий остаётся живым. */
export function buildStages(turn: Turn): ThinkingStage[] {
  const current = STAGE_ORDER.indexOf(turn.stage as (typeof STAGE_ORDER)[number]);
  if (current < 0) return [];
  // Без книги поиска не было, и первые два этапа показывать не за что: ответ
  // начинается сразу с «отвечаю».
  const passed = STAGE_ORDER.slice(0, current + 1).filter(
    (key) => turn.library !== false || key === "answering",
  );
  const activeAt = passed.length - 1;
  return passed.map((key, index) => ({
    key,
    label: stageLabel(key, turn.found),
    done: index < activeAt,
  }));
}

/** Сводка под завершённым ответом: «8 фрагментов» или «в книге не нашлось». */
export function foundSummary(turn: Turn): string | undefined {
  if (turn.found === undefined) return undefined;
  return turn.found
    ? `${turn.found} ${fragmentWord(turn.found)}`
    : "в книге не нашлось";
}
