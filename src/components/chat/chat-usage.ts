// Сколько стоил ответ: токены, контекстное окно, цена.
//
// Числа присылает сервер (`usage` в потоке), здесь только подписи. Без React и без
// запросов: чистые функции, проверяются тестом.

export interface AskUsage {
  model: string;
  model_name: string;
  reasoning: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  /** Часть `output_tokens`, которую модель потратила на раздумья. */
  reasoning_tokens: number;
  total_tokens: number;
  context_window: number;
  /** Сколько окна занято. У ответа с инструментами это последний круг, а не сумма всех. */
  context_tokens?: number;
  cost_usd: number;
  /** Провайдер цену не прислал, она посчитана по прайсу. */
  cost_estimated: boolean;
}

const LEVEL_NAMES: Record<string, string> = {
  low: "низкое",
  high: "высокое",
  max: "максимальное",
};

/** Такие ключи ещё лежат в браузерах учеников. */
const OLD_MODEL_KEYS: Record<string, string> = { "glm-5.3": "smart", "glm-5.3-flash": "fast" };

export function renamedModelKey(key: string): string {
  return OLD_MODEL_KEYS[key] ?? key;
}

/** В истории чатов лежат записи со старыми названиями: показываем их новыми словами. */
function modelLabel(name: string): string {
  if (!/^GLM/i.test(name)) return name;
  return /flash/i.test(name) ? "Быстрая" : "Умная";
}

/** 3214 → «3 214». Неразрывный пробел: число не должно переноситься. */
export function countLabel(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function trimmed(value: number): string {
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

/** 3214 → «3,2 тыс.», 1048576 → «1 млн». */
export function shortCount(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${trimmed(value / 1000)} тыс.`;
  return `${trimmed(value / 1_000_000)} млн`;
}

export function costLabel(value: number): string {
  if (value <= 0) return "$0";
  if (value < 0.0001) return "меньше $0,0001";
  const digits = value < 0.01 ? 4 : value < 1 ? 3 : 2;
  return `$${value.toFixed(digits).replace(".", ",")}`;
}

/**
 * Сколько окна занял этот разговор: всё, что ушло на вход, и то, что модель написала.
 * Раздумья в следующий запрос не попадают, поэтому они не считаются.
 */
export function contextUsed(usage: AskUsage): number {
  return usage.context_tokens ?? usage.input_tokens + Math.max(0, usage.output_tokens - usage.reasoning_tokens);
}

export function contextPercent(usage: AskUsage): number {
  if (!usage.context_window) return 0;
  return Math.min(100, (contextUsed(usage) / usage.context_window) * 100);
}

/** Строка под ответом. */
export function usageLine(usage: AskUsage): string {
  const parts = [`вход ${countLabel(usage.input_tokens)}`, `выход ${countLabel(usage.output_tokens)}`];
  if (usage.reasoning_tokens) parts.push(`из них рассуждение ${countLabel(usage.reasoning_tokens)}`);
  if (usage.cached_input_tokens) parts.push(`из кэша ${countLabel(usage.cached_input_tokens)}`);
  parts.push(`${usage.cost_estimated ? "примерно " : ""}${costLabel(usage.cost_usd)}`);
  const level = LEVEL_NAMES[usage.reasoning] ?? usage.reasoning;
  return `${modelLabel(usage.model_name)}, рассуждение ${level}: ${parts.join(", ")}`;
}

/** Последний ответ, у которого есть расход: по нему показывается окно. */
export function lastUsage(turns: ReadonlyArray<{ usage?: AskUsage }>): AskUsage | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    const usage = turns[index].usage;
    if (usage) return usage;
  }
  return null;
}
