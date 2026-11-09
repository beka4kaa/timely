// Чтение недели дневника. Без запросов и без «@/» в рантайме: ради `node --test`.

import type { DiaryWeek } from "@/types/diary";

/** Неделя без записей: при чтении её можно собрать из шаблона заново. Старые строки бывают без оценок. */
export function isWeekUnchanged(week: DiaryWeek): boolean {
  return (week.days ?? []).every(
    (day) =>
      !day.youtubeLinks?.length &&
      (day.lessons ?? []).every(
        (lesson) =>
          (lesson.grades?.retelling ?? null) === null &&
          (lesson.grades?.exercises ?? null) === null &&
          (lesson.grades?.test ?? null) === null &&
          !(lesson.homework ?? "").trim() &&
          !(lesson.notes ?? "").trim() &&
          !lesson.homeworkDone,
      ),
  );
}

/**
 * Неделя из ответа поиска или `null`, если её правда нет. Сбой бросает: раньше он выглядел как
 * «недели нет», дальше шло создание, а создание на сервере обновляет найденную неделю и стирает
 * её оценки и задания.
 */
export async function existingWeek(response: Response): Promise<DiaryWeek | null> {
  if (!response.ok) throw new Error(`Неделя не прочиталась (${response.status})`);
  const weeks: unknown = await response.json();
  if (!Array.isArray(weeks)) throw new Error("Неделя не прочиталась: ответ не список");
  return (weeks[0] as DiaryWeek | undefined) ?? null;
}
