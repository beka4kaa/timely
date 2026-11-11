// Умная сетка контестов: никто ничего не расставляет руками, место решает время.
//
// Идущий контест, а если его нет, то ближайший, стоит билетом наверху. Следующие идут
// парами; если их нечётное число, последняя карточка растягивается на всю строку, чтобы
// не было дыры. Прошедшие идут маленькими плашками, новые сверху.

export type SlotSize = "card" | "wide";

export interface ContestLayout<T> {
  hero: T | null;
  next: Array<{ contest: T; size: SlotSize }>;
  past: T[];
}

const at = (iso: string) => Date.parse(iso);

export function layoutContests<T extends { start_time: string; end_time: string }>(
  rows: readonly T[],
  now: Date,
): ContestLayout<T> {
  const moment = now.getTime();
  const running: T[] = [];
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const row of rows) {
    if (at(row.end_time) <= moment) past.push(row);
    else if (at(row.start_time) <= moment) running.push(row);
    else upcoming.push(row);
  }
  running.sort((a, b) => at(a.end_time) - at(b.end_time));
  upcoming.sort((a, b) => at(a.start_time) - at(b.start_time));
  past.sort((a, b) => at(b.start_time) - at(a.start_time));

  const ahead = [...running, ...upcoming];
  const rest = ahead.slice(1);
  const odd = rest.length % 2 === 1;
  return {
    hero: ahead[0] ?? null,
    next: rest.map((contest, index) => ({
      contest,
      size: odd && index === rest.length - 1 ? "wide" : "card",
    })),
    past,
  };
}
