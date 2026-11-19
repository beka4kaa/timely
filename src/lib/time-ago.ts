// Когда отправлено сообщение, словами: «только что», «5 минут назад», «вчера», «9 ноября».
// Под ответом тьютора; точное время — во всплывающей подсказке.

import { dateLocale, getLocale, plural, t } from "./i18n";

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня", // i18n-skip
  "июля", "августа", "сентября", "октября", "ноября", "декабря", // i18n-skip
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayAndMonth(date: Date, now: number): string {
  const year = date.getFullYear() === new Date(now).getFullYear() ? "" : ` ${date.getFullYear()}`;
  if (getLocale() === "en") {
    const month = date.toLocaleDateString(dateLocale(), { month: "long" });
    return `${date.getDate()} ${month}${year}`;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

export function timeAgo(at: number, now: number = Date.now()): string {
  const diff = now - at;
  if (diff < MINUTE) return t("только что");
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE);
    return plural(minutes, "{n} минуту назад", "{n} минуты назад", "{n} минут назад");
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return plural(hours, "{n} час назад", "{n} часа назад", "{n} часов назад");
  }
  // Дни считаем по календарю, а не по суткам: вчерашний вечер — это «вчера».
  const days = Math.round((dayStart(now) - dayStart(at)) / DAY);
  if (days <= 1) return t("вчера");
  if (days < 7) return plural(days, "{n} день назад", "{n} дня назад", "{n} дней назад");
  return dayAndMonth(new Date(at), now);
}

/** «19 ноября, 14:05»; у прошлогоднего — с годом. */
export function sentAt(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  return `${dayAndMonth(date, now)}, ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}
