// Что сказать ученику, когда лимит закончился.
//
// Когда он обновится, знает сервер: окон два, и недельное обновляется через несколько дней,
// а не часов. Поэтому время берём из ответа, а не обещаем заранее.

const OVER = "Лимит запросов закончился.";

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «сегодня в 18:40», «завтра в 03:05», «9 ноября в 03:00» или null, если времени нет или оно прошло. */
export function resetPhrase(resetAt: unknown, now: Date = new Date()): string | null {
  const when = typeof resetAt === "string" ? new Date(resetAt) : null;
  if (!when || Number.isNaN(when.getTime()) || when <= now) return null;

  const time = when.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(when, now)) return `сегодня в ${time}`;
  if (isSameDay(when, tomorrow)) return `завтра в ${time}`;
  return `${when.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} в ${time}`;
}

export function limitMessage(resetAt: unknown, now: Date = new Date()): string {
  const phrase = resetPhrase(resetAt, now);
  if (!phrase) return `${OVER} Попробуй ещё раз позже.`;
  return `${OVER} Он обновится ${phrase}.`;
}
