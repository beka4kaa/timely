// Этапы доски для заметки на полях.
//
// Бэкенд доски (`ai_engine/skills/router.py`) шлёт стадию одним словом:
// `routing`, `drawing`, `ask_clarification`. Панель вопросов шлёт свои три.
// Общий компонент `ThinkingNote` не должен знать ни те, ни другие — он рисует
// то, что ему дали, поэтому перевод живёт рядом с каждым источником.

import type { ThinkingStage } from "./thinking-note";

const LABELS: Record<string, string> = {
  routing: "Разбираю вопрос",
  drawing: "Строю схему",
  ask_clarification: "Уточняю вопрос",
};

/**
 * Текущая стадия доски → строки заметки.
 *
 * У доски, в отличие от панели, известна ровно одна стадия за раз: сервер
 * присылает её на смену, а не накапливает список. Поэтому и строка одна —
 * выдумывать пройденные этапы, о которых сервер не сообщал, значит показывать
 * ученику работу, которой не было.
 */
export function boardStages(stage: string | null | undefined): ThinkingStage[] {
  const key = stage || "routing";
  return [{ key, label: LABELS[key] ?? "Думаю", done: false }];
}
