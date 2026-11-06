// Что сказать ученику, когда лимит закончился.
//
// Когда он обновится, знает сервер: окон два, и недельное обновляется через несколько дней,
// а не часов. Поэтому время берём из ответа, а не обещаем заранее.

const OVER = "Лимит запросов закончился.";

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function limitMessage(resetAt: unknown, now: Date = new Date()): string {
  const when = typeof resetAt === "string" ? new Date(resetAt) : null;
  if (!when || Number.isNaN(when.getTime()) || when <= now) return `${OVER} Попробуй ещё раз позже.`;

  const time = when.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(when, now)) return `${OVER} Он обновится сегодня в ${time}.`;
  if (isSameDay(when, tomorrow)) return `${OVER} Он обновится завтра в ${time}.`;
  return `${OVER} Он обновится ${when.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} в ${time}.`;
}
