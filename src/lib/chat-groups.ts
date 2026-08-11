// Разговоры по дням: «Сегодня», «Вчера», «На этой неделе», «Ранее».
//
// Список чатов на странице «Тьютор» идёт сплошной лентой по всем предметам, и
// без заголовков дней в нём через неделю не найти вчерашний разбор. Дата у
// каждой строки была бы точнее, но двадцать одинаковых дат подряд читаются
// хуже одного слова над группой.
//
// Отдельным модулем, потому что это чистая функция с граничными случаями
// (полночь, переход на летнее время, дата из будущего), а проверять их в
// компоненте с DOM неудобно.

export type ChatDayBucket = "today" | "yesterday" | "week" | "earlier";

export interface ChatGroup<T> {
  key: ChatDayBucket;
  label: string;
  rows: T[];
}

const LABELS: Record<ChatDayBucket, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  week: "На этой неделе",
  earlier: "Ранее",
};

const ORDER: ChatDayBucket[] = ["today", "yesterday", "week", "earlier"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Полночь по местному времени: границы групп — календарные, а не «24 часа». */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayBucket(iso: string, now: Date): ChatDayBucket {
  const date = new Date(iso);
  // Испорченная дата не должна ронять список: такой разговор уходит в «Ранее»,
  // где его хотя бы видно.
  if (Number.isNaN(date.getTime())) return "earlier";

  // Округление, а не отбрасывание: в дни перевода часов сутки длятся 23 или 25
  // часов, и деление нацело дало бы соседнюю группу.
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  // Отрицательное — дата из будущего: часы устройства могут отставать от
  // сервера. Показываем как сегодняшнее, а не заводим группу «Завтра».
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 6) return "week";
  return "earlier";
}

/**
 * Группирует строки по дню последнего изменения.
 *
 * Пустые группы не возвращаются: заголовок «Вчера» без единой строки под ним
 * сообщал бы об отсутствии разговоров, а не о чём-то полезном.
 */
export function groupChatsByDay<T extends { updated_at: string }>(
  rows: T[],
  now: Date = new Date(),
): ChatGroup<T>[] {
  const buckets = new Map<ChatDayBucket, T[]>();
  for (const row of rows) {
    const key = dayBucket(row.updated_at, now);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }

  return ORDER.filter((key) => buckets.get(key)?.length).map((key) => ({
    key,
    label: LABELS[key],
    // Внутри группы — свежие сверху. Порядок сервера не гарантирован, а
    // перескок дат внутри одного дня выглядит как сбой.
    rows: [...(buckets.get(key) as T[])].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    ),
  }));
}
