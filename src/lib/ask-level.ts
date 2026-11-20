// Насколько глубоко думает тьютор: один переключатель вместо выбора модели и рассуждения.
//
// Instant — быстрая модель с коротким рассуждением, Medium — быстрая с долгим, High — умная
// с долгим. Уровня medium у моделей нет (только low, high и max), поэтому середина — это
// быстрая модель, которая думает дольше. Сервер по-прежнему принимает модель и уровень;
// «Максимум» из выбора убран, а у тех, кто выбрал его раньше, он идёт как High. Прежний
// Medium (умная с коротким рассуждением) показывается и отправляется как новый Medium.

import { msg } from "./i18n";

export type AskLevel = "instant" | "medium" | "high";

export const ASK_LEVELS: { key: AskLevel; name: string; note: string }[] = [
  { key: "instant", name: "Instant", note: msg("Быстрая модель, отвечает сразу") },
  { key: "medium", name: "Medium", note: msg("Быстрая модель, думает дольше") },
  { key: "high", name: "High", note: msg("Умная модель, думает дольше и тратит больше") },
];

const CHOICES: Record<AskLevel, { model: string; reasoning: string }> = {
  instant: { model: "fast", reasoning: "low" },
  medium: { model: "fast", reasoning: "high" },
  high: { model: "smart", reasoning: "high" },
};

export function choiceOf(level: AskLevel): { model: string; reasoning: string } {
  return { ...CHOICES[level] };
}

/** Какое положение показать для сохранённых модели и рассуждения. Пустое — выбор сервера. */
export function levelOf(model: string, reasoning: string): AskLevel {
  const deep = reasoning === "high" || reasoning === "max";
  if (model === "fast") return deep ? "medium" : "instant";
  return deep ? "high" : "medium";
}

/** Что отправить с вопросом: ничего, пока ученик не выбирал, иначе выбор его положения. */
export function askChoice(prefs: { model: string; reasoning: string }): { model?: string; reasoning?: string } {
  if (!prefs.model && !prefs.reasoning) return {};
  return choiceOf(levelOf(prefs.model, prefs.reasoning));
}

const GAUGE: Record<AskLevel, number> = { instant: -55, medium: 0, high: 55 };

/** Наклон стрелки спидометра на кнопке, в градусах от вертикали. */
export function gaugeAngle(level: AskLevel): number {
  return GAUGE[level];
}
