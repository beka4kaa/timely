/**
 * Режимы тьютора для интерфейса доски.
 *
 * ИСТОЧНИК ИСТИНЫ — backend (`backend/ai_engine/tutor_modes.py`). Здесь лежат
 * только подписи для переключателя: правила поведения, права на подсказки и
 * список инструментов вычисляет сервер, и клиент их не воспроизводит.
 * Соответственно, отправить неизвестный slug безопасно — `get_mode` на бэкенде
 * молча вернёт режим по умолчанию.
 *
 * Политику (`HelpPolicySnapshot`) сервер присылает В ОТВЕТЕ на каждое
 * сообщение. Считать её на клиенте нельзя: тогда «можно ли готовый ответ»
 * решал бы тот, кто этот ответ хочет.
 */

/** Режимы, которые видит ученик на первом экране (PRODUCT.md §5.2). */
export type TutorModeSlug =
  | "explain"
  | "solve_together"
  | "practice"
  | "exam_prep";

export interface TutorModeOption {
  slug: TutorModeSlug;
  /** Короткая подпись на кнопке. */
  title: string;
  /** Что изменится в поведении — показывается подсказкой при наведении. */
  goal: string;
}

export const DEFAULT_TUTOR_MODE: TutorModeSlug = "explain";

export const PRIMARY_TUTOR_MODES: readonly TutorModeOption[] = [
  {
    slug: "explain",
    title: "Понять тему",
    goal: "Разберём идею с нуля: диагностика, объяснение, схема, контрольный вопрос",
  },
  {
    slug: "solve_together",
    title: "Решить задачу",
    goal: "Решаешь сам, тьютор проверяет шаги и даёт подсказки по одной",
  },
  {
    slug: "practice",
    title: "Потренироваться",
    goal: "Серия задач на один навык, по одной за раз",
  },
  {
    slug: "exam_prep",
    title: "Подготовиться",
    goal: "Есть дата: сначала самый дорогой пробел, потом смешанная практика",
  },
] as const;

/**
 * Подписи ВСЕХ режимов, включая выбираемые контекстом (контест, повторение,
 * разбор) — истории чатов нужно показать бейдж для сессии, которую
 * переключатель создать не мог.
 */
export const TUTOR_MODE_TITLES: Record<string, string> = {
  explain: "Понять тему",
  analyze_task: "Разобрать задачу",
  solve_together: "Решить задачу",
  practice: "Потренироваться",
  review: "Повторить",
  exam_prep: "Подготовиться",
  quick_answer: "Быстрый вопрос",
  contest: "Контест",
  post_contest: "Разбор после контеста",
};

export function tutorModeTitle(slug: string | null | undefined): string {
  if (!slug) return "";
  return TUTOR_MODE_TITLES[slug] ?? "";
}

/** Права, вычисленные сервером (`help_policy.HelpPolicy.as_dict`). */
export interface HelpPolicySnapshot {
  allow_full_solution: boolean;
  required_attempts: number;
  hints_allowed: boolean;
  max_hint_level: number;
  sources_allowed: boolean;
  calculator_allowed: boolean;
  rated: boolean;
}
