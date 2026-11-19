// Когда отправлено сообщение, словами: «только что», «5 минут назад», «вчера», «9 ноября».
// Под ответом тьютора; точное время — во всплывающей подсказке.

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, one: string, few: string, many: string): string {
  const hundred = count % 100;
  const ten = count % 10;
  if (hundred >= 11 && hundred <= 14) return many;
  if (ten === 1) return one;
  if (ten >= 2 && ten <= 4) return few;
  return many;
}

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayAndMonth(date: Date, now: number): string {
  const year = date.getFullYear() === new Date(now).getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

export function timeAgo(at: number, now: number = Date.now()): string {
  const diff = now - at;
  if (diff < MINUTE) return "только что";
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  }
  // Дни считаем по календарю, а не по суткам: вчерашний вечер — это «вчера».
  const days = Math.round((dayStart(now) - dayStart(at)) / DAY);
  if (days <= 1) return "вчера";
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  return dayAndMonth(new Date(at), now);
}

/** «19 ноября, 14:05»; у прошлогоднего — с годом. */
export function sentAt(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  return `${dayAndMonth(date, now)}, ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}
