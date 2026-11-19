// Насколько глубоко думает тьютор: один переключатель вместо выбора модели и рассуждения.
//
// Instant — быстрая модель, Medium — умная с коротким рассуждением, High — умная с долгим.
// Сервер по-прежнему принимает модель и уровень рассуждения; «Максимум» из выбора убран,
// а у тех, кто выбрал его раньше, он показывается и отправляется как High.

import { msg } from "./i18n";

export type AskLevel = "instant" | "medium" | "high";

export const ASK_LEVELS: { key: AskLevel; name: string; note: string }[] = [
  { key: "instant", name: "Instant", note: msg("Быстрая модель, отвечает сразу") },
  { key: "medium", name: "Medium", note: msg("Умная модель, рассуждает коротко") },
  { key: "high", name: "High", note: msg("Умная модель, думает дольше и тратит больше") },
];

const CHOICES: Record<AskLevel, { model: string; reasoning: string }> = {
  instant: { model: "fast", reasoning: "low" },
  medium: { model: "smart", reasoning: "low" },
  high: { model: "smart", reasoning: "high" },
};

export function choiceOf(level: AskLevel): { model: string; reasoning: string } {
  return { ...CHOICES[level] };
}

/** Какое положение показать для сохранённых модели и рассуждения. Пустое — выбор сервера. */
export function levelOf(model: string, reasoning: string): AskLevel {
  if (model === "fast") return "instant";
  return reasoning === "high" || reasoning === "max" ? "high" : "medium";
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
