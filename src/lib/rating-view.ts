// Таблица рейтинга: кто на каком месте и что показать.
// Сервер отдаёт всех сразу, поэтому фильтр и места считаются здесь, без React и сети.

import type { LeaderboardUser } from "./contest-api";

/** Коды стран из `CustomUser.COUNTRY_CHOICES`. Незнакомый код показываем как есть. */
const COUNTRY_NAMES: Record<string, string> = { KZ: "Казахстан", RU: "Россия", US: "США" };
const COUNTRY_IN: Record<string, string> = { KZ: "в Казахстане", RU: "в России", US: "в США" };

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRY_NAMES[code] ?? code;
}

export function countryIn(code: string): string {
  return COUNTRY_IN[code] ?? `в стране ${code}`;
}

export interface BoardFilter {
  /** Название предмета. `null` значит общий рейтинг. */
  subject: string | null;
  /** Код страны. `null` значит весь мир. */
  country: string | null;
}

export interface BoardRow {
  id: number;
  name: string;
  countryCode: string | null;
  points: number;
  /** Равные баллы делят место: 1, 2, 2, 4. */
  place: number;
  tier: string | null;
  me: boolean;
}

/** Предметы, по которым у кого-то есть рейтинг: сначала те, где людей больше. */
export function subjectsOf(users: readonly LeaderboardUser[]): string[] {
  const counts = new Map<string, number>();
  for (const user of users) {
    for (const rating of user.ratings) {
      counts.set(rating.discipline_name, (counts.get(rating.discipline_name) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .map(([name]) => name);
}

export function buildBoard(
  users: readonly LeaderboardUser[],
  filter: BoardFilter,
  meId: number | null,
): BoardRow[] {
  const rows: Array<Omit<BoardRow, "place">> = [];
  for (const user of users) {
    if (filter.country && user.country_code !== filter.country) continue;
    let points = user.overall_elo;
    let tier: string | null = null;
    if (filter.subject) {
      const rating = user.ratings.find((row) => row.discipline_name === filter.subject);
      if (!rating) continue;
      points = rating.elo_score;
      tier = rating.tier_level;
    }
    rows.push({
      id: user.id,
      name: user.username,
      countryCode: user.country_code,
      points,
      tier,
      me: user.id === meId,
    });
  }
  rows.sort((a, b) => b.points - a.points || a.id - b.id);
  let place = 0;
  return rows.map((row, index) => {
    if (index === 0 || rows[index - 1].points !== row.points) place = index + 1;
    return { ...row, place };
  });
}

export type BoardLine =
  | { type: "row"; row: BoardRow }
  /** Сколько строк скрыто. Нажатие на промежуток показывает их. */
  | { type: "gap"; count: number };

/** Сколько человек видно вокруг ученика, если он далеко от начала таблицы. */
const AROUND_ME = 2;

/** Начало таблицы, а если ученик ниже, то ещё он сам с соседями. */
export function visibleLines(rows: readonly BoardRow[], limit: number): BoardLine[] {
  const lines: BoardLine[] = rows.slice(0, limit).map((row) => ({ type: "row", row }));
  const myIndex = rows.findIndex((row) => row.me);
  let shownTo = Math.min(limit, rows.length);
  if (myIndex >= limit) {
    const from = Math.max(limit, myIndex - AROUND_ME);
    const to = Math.min(rows.length, myIndex + AROUND_ME + 1);
    if (from > limit) lines.push({ type: "gap", count: from - limit });
    for (const row of rows.slice(from, to)) lines.push({ type: "row", row });
    shownTo = to;
  }
  if (shownTo < rows.length) lines.push({ type: "gap", count: rows.length - shownTo });
  return lines;
}

export interface Neighbours {
  /** Ближайший, у кого баллов больше. У равного с тобой места нет смысла догонять. */
  above: BoardRow | null;
  below: BoardRow | null;
}

export function neighboursOf(rows: readonly BoardRow[], me: BoardRow): Neighbours {
  let above: BoardRow | null = null;
  let below: BoardRow | null = null;
  for (const row of rows) {
    if (row.points > me.points) above = row;
    else if (row.points < me.points) {
      below = row;
      break;
    }
  }
  return { above, below };
}

/** Какую часть пути от соседа сзади до соседа впереди ты уже прошёл, в процентах. */
export function shareToNext(me: BoardRow, { above, below }: Neighbours): number | null {
  if (!above || !below) return null;
  const span = above.points - below.points;
  if (span <= 0) return null;
  return Math.max(8, Math.min(100, Math.round(((me.points - below.points) / span) * 100)));
}

/** Сколько баллов дали решения, принятые за последние семь дней. */
export function weeklyGain(
  submissions: ReadonlyArray<{ status: string; task_points: number; reviewed_at: string | null }>,
  now: Date,
): number {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return submissions.reduce((sum, row) => {
    if (row.status !== "approved" || !row.reviewed_at) return sum;
    return new Date(row.reviewed_at).getTime() >= since ? sum + row.task_points : sum;
  }, 0);
}

/** Пробел между разрядами, чтобы «1 530» не переносилось. */
export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
