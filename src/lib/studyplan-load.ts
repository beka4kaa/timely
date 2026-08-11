// Нагрузка недели: сколько времени занято в каждом дне и чем именно.
//
// Календарь Google показывает события. Timely показывает НАГРУЗКУ: занятия
// приходят из программы, их можно пропустить и нагнать, а часов в сутках
// конечное число. Поэтому первый вопрос страницы «План» — не «что когда», а
// «я не перегружен». Лента под заголовками дней отвечает на него до того, как
// ученик начнёт читать названия занятий.
//
// Модуль чистый и НИЧЕГО не импортирует из `@/`: так его проверяет `node --test`
// без React и без сборщика — тем же приёмом, что `studyplan-chat.ts`.

/** Одна запись календаря в терминах нагрузки. */
export interface LoadEntry {
  dateKey: string;
  minutes: number;
  /** Цвет источника: курс или вид занятого времени. Он же ключ группировки. */
  accent: string;
  /**
   * Освобождённое время: отменённое и перенесённое.
   *
   * В ленте не участвует. Иначе отменённая пара продолжала бы утверждать, что
   * день занят, и ученик не увидел бы освободившееся окно.
   */
  released?: boolean;
}

export interface LoadSegment {
  accent: string;
  minutes: number;
}

export interface DayLoad {
  dateKey: string;
  totalMinutes: number;
  /** Куски одного цвета, сложенные вместе. Пустой массив — свободный день. */
  segments: LoadSegment[];
}

export interface WeekLoad {
  days: DayLoad[];
  totalMinutes: number;
  /** Самый плотный день недели. `null` — неделя пустая. */
  peakDateKey: string | null;
  peakMinutes: number;
}

/**
 * Складывает записи в ленту нагрузки по дням.
 *
 * `days` задаёт и состав, и порядок: день без записей остаётся в результате с
 * нулём, иначе лента поехала бы и у пустой среды не было бы своего места.
 */
export function weekLoad(days: string[], entries: LoadEntry[]): WeekLoad {
  const byDay = new Map<string, Map<string, number>>();
  for (const day of days) byDay.set(day, new Map());

  for (const entry of entries) {
    if (entry.released) continue;
    if (entry.minutes <= 0) continue;
    const bucket = byDay.get(entry.dateKey);
    // День вне недели молча пропускаем: календарь показывает семь колонок, и
    // хвост соседней недели не должен подмешиваться в её итог.
    if (!bucket) continue;
    bucket.set(entry.accent, (bucket.get(entry.accent) ?? 0) + entry.minutes);
  }

  const result: DayLoad[] = days.map((dateKey) => {
    const bucket = byDay.get(dateKey) ?? new Map<string, number>();
    const segments = Array.from(bucket.entries())
      .map(([accent, minutes]) => ({ accent, minutes }))
      // Порядок детерминированный: сначала по объёму, при равенстве — по цвету.
      // Без второго ключа две одинаковые по времени программы менялись бы
      // местами между рендерами, и лента мерцала бы на ровном месте.
      .sort((a, b) => b.minutes - a.minutes || (a.accent < b.accent ? -1 : 1));
    const totalMinutes = segments.reduce((sum, item) => sum + item.minutes, 0);
    return { dateKey, totalMinutes, segments };
  });

  let peakDateKey: string | null = null;
  let peakMinutes = 0;
  for (const day of result) {
    // Строгое «больше»: при равенстве побеждает более ранний день недели.
    if (day.totalMinutes > peakMinutes) {
      peakMinutes = day.totalMinutes;
      peakDateKey = day.dateKey;
    }
  }

  return {
    days: result,
    totalMinutes: result.reduce((sum, day) => sum + day.totalMinutes, 0),
    peakDateKey,
    peakMinutes,
  };
}

/**
 * Высота столбика в ленте, 0…1.
 *
 * Масштаб задаёт самый плотный день недели, а не абстрактные «24 часа»: при
 * шкале в сутки учебная неделя выглядела бы как ровная линия у пола. Пол в 0.12
 * нужен, чтобы день с одним коротким занятием был виден как занятый, а не как
 * пустой.
 */
export function loadRatio(minutes: number, peakMinutes: number): number {
  if (minutes <= 0 || peakMinutes <= 0) return 0;
  return Math.max(0.12, Math.min(1, minutes / peakMinutes));
}
