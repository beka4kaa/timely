import { msg, t } from "./i18n";

// Имена инструментов помощника — чтобы подсветить их как скиллы, а не как код.
//
// Помощник в ответе ссылается на свои инструменты: «идентификатор берётся из
// `list_courses`». В обычном оформлении инлайн-кода это выглядит как кусок
// программы и читается ученику как ошибка интерфейса. Подсвеченное имя скилла
// читается как действие, которое помощник умеет, — так же, как это сделано у
// Claude.
//
// Модуль чистый и ничего не импортирует: список проверяется `node --test`, и
// он же держит фронтенд в курсе того, что реально зарегистрировано в
// `backend/studyplan/tools.py`. Разъедутся — подсветка просто пропадёт, ничего
// не сломав.

/** Инструменты помощника по расписанию (`SCHEDULE_TOOLS`). */
export const SCHEDULE_SKILLS = [
  "get_schedule",
  "find_free_slots",
  "explain_schedule",
  "propose_move_blocks",
  "propose_load_reduction",
  "propose_recovery_plan",
  "propose_fixed_commitments",
  "list_courses",
  "propose_study_plan",
] as const;

const SKILLS = new Set<string>(SCHEDULE_SKILLS);

/** Человеческие названия: ученику «list_courses» ничего не говорит. */
const SKILL_LABELS: Record<string, string> = {
  get_schedule: msg("смотрю расписание"),
  find_free_slots: msg("ищу свободные окна"),
  explain_schedule: msg("разбираю день"),
  propose_move_blocks: msg("переношу занятия"),
  propose_load_reduction: msg("разгружаю день"),
  propose_recovery_plan: msg("собираю план догона"),
  propose_fixed_commitments: msg("записываю занятость"),
  list_courses: msg("смотрю программы"),
  propose_study_plan: msg("настраиваю предмет"),
};

/**
 * Это имя скилла?
 *
 * Сравнение точное и по обрезанной строке: `list_courses` — скилл,
 * `list_courses()` и `course_plan_id` — нет. Подсветить лишнее хуже, чем не
 * подсветить нужное: ложный чип превращает обычный текст в кнопку, которой
 * нет.
 */
export function isSkillName(value: string): boolean {
  return SKILLS.has(value.trim());
}

/** Подпись скилла для подсказки. Пусто — скилл неизвестен. */
export function skillLabel(value: string): string {
  const label = SKILL_LABELS[value.trim()];
  return label ? t(label) : "";
}
