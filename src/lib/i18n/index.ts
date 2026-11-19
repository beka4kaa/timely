// Язык интерфейса кабинета.
//
// Русский — исходный: строка в коде пишется по-русски и сама служит ключом, английский
// перевод лежит в словарях `en/`. Компоненты читаются как раньше, а следующий язык
// (казахский) — это ещё один словарь с теми же ключами.
//
// Выбор хранится в куке `timely-lang`, той же, что у переключателя RU/EN на лендинге.
// Кабинет рисуется в браузере после входа, поэтому язык читается один раз, когда модуль
// загрузился, а смена языка перезагружает страницу. На сервере всегда русский: страницы,
// которые рисует сервер (вход, публичный чат), берут язык из куки через `LocaleProvider`
// и `useT`, см. `react.tsx`.
//
// `t()` нельзя звать на уровне модуля, в константах: переводить при отрисовке или внутри
// функции. Тогда словарь можно грузить отдельно, а смена языка не оставит старых строк.
//
// Относительные импорты, а не «@/»: модуль проверяют тесты на ts-node без алиасов.

import { DEFAULT_LOCALE, cookieLocale, writeLocaleCookie } from "./cookie";
import EN from "./en/index";
import type { Dictionary, Locale } from "./types";

export type { Dictionary, Locale } from "./types";
export { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_MAX_AGE, cookieLocale, parseLocale } from "./cookie";

/** Названия языков всегда на них самих: так их узнают, на каком бы языке ни был экран. */
export const LOCALES: { key: Locale; name: string }[] = [
  { key: "ru", name: "Русский" }, // i18n-skip: название языка на нём самом
  { key: "en", name: "English" },
];

const DICTIONARIES: Partial<Record<Locale, Dictionary>> = { en: EN };

type Vars = Record<string, string | number>;

/** Язык из строки `document.cookie` или заголовка Cookie. Нет куки — русский. */
export function localeFromCookie(cookie: string | null | undefined): Locale {
  return cookieLocale(cookie) ?? DEFAULT_LOCALE;
}

let current: Locale = typeof document === "undefined" ? DEFAULT_LOCALE : localeFromCookie(document.cookie);

export function getLocale(): Locale {
  return current;
}

/** Только для тестов: в браузере язык меняет `switchLocale` с перезагрузкой. */
export function setLocaleForTests(next: Locale): void {
  current = next;
}

const reported = new Set<string>();

function report(key: string): void {
  if (process.env.NODE_ENV === "production" || reported.has(key)) return;
  reported.add(key);
  console.warn(`[i18n] нет перевода (${current}): ${key}`);
}

function lookup(locale: Locale, key: string): string | undefined {
  const found = DICTIONARIES[locale]?.[key];
  if (found === undefined) report(key);
  return found;
}

/** Ключ словаря: русский текст, а для одинакового текста с разным смыслом — «контекст::текст». */
export function dictionaryKey(ru: string, context?: string): string {
  return context ? `${context}::${ru}` : ru;
}

/** Подставляет `{имя}` из `vars`. Незнакомое имя остаётся как есть, чтобы ошибку было видно. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Перевод строки на язык `locale`. Нет перевода — русский текст. */
export function translate(locale: Locale, ru: string, vars?: Vars, context?: string): string {
  if (locale === DEFAULT_LOCALE) return fill(ru, vars);
  return fill(lookup(locale, dictionaryKey(ru, context)) ?? ru, vars);
}

/**
 * Строка интерфейса на текущем языке. Ключ — сам русский текст:
 * `t("Сохранить")`, `t("Осталось {n} мин", { n: 5 })`.
 *
 * Если одинаковый русский текст значит разное («По дням» в истории и в расписании
 * привычки), третий аргумент даёт ему контекст: `t("По дням", undefined, "история")`, а в
 * словаре ключ «история::По дням». По-русски контекст ни на что не влияет.
 */
export function t(ru: string, vars?: Vars, context?: string): string {
  return translate(current, ru, vars, context);
}

/**
 * Помечает строку для перевода, ничего с ней не делая: для констант на уровне модуля, где
 * `t()` звать нельзя. Переводить при отрисовке: `t(item.title)`. Проверка словаря находит
 * такие строки по `msg("…")`, поэтому ключ без перевода не потеряется.
 */
export function msg(ru: string): string {
  return ru;
}

/** Русская форма для 1, 2–4 и 5+ (дробные числа — как 2–4: «1,5 часа»). */
export function russianForm<T>(n: number, one: T, few: T, many: T): T {
  if (!Number.isInteger(n)) return few;
  const hundred = Math.abs(n) % 100;
  const ten = hundred % 10;
  if (hundred >= 11 && hundred <= 14) return many;
  if (ten === 1) return one;
  if (ten >= 2 && ten <= 4) return few;
  return many;
}

/** Склонение на языке `locale`. См. `plural`. */
export function translatePlural(locale: Locale, n: number, one: string, few: string, many: string): string {
  if (locale !== DEFAULT_LOCALE) {
    const found = lookup(locale, `${one}|${few}|${many}`);
    if (found !== undefined) {
      const [single, other = single] = found.split("|");
      return fill(Math.abs(n) === 1 ? single : other, { n });
    }
  }
  return fill(russianForm(n, one, few, many), { n });
}

/**
 * Слово при числе: `plural(n, "урок", "урока", "уроков")`. Формы могут нести само число:
 * `plural(n, "{n} урок", "{n} урока", "{n} уроков")` → «3 урока», «3 lessons».
 * Английский перевод лежит под ключом «урок|урока|уроков» в виде «lesson|lessons».
 */
export function plural(n: number, one: string, few: string, many: string): string {
  return translatePlural(current, n, one, few, many);
}

/**
 * Язык для `toLocaleDateString`, `Intl.DateTimeFormat` и других `Intl`. Английский —
 * британский: 24 часа и неделя с понедельника, как в расписании кабинета.
 */
export function dateLocale(locale: Locale = current): string {
  return locale === "en" ? "en-GB" : "ru-RU";
}

/** Дробное число по правилам языка: «2,5» по-русски, «2.5» по-английски. */
export function decimal(value: number, digits = 1): string {
  const text = value.toFixed(digits);
  return current === "en" ? text : text.replace(".", ",");
}

/** Записывает выбор в куку и в `<html lang>`. */
export function saveLocale(next: Locale): void {
  writeLocaleCookie(next);
}

/** Меняет язык и перезагружает страницу: так перерисуется всё, и посчитанные строки тоже. */
export function switchLocale(next: Locale): void {
  if (next === current) return;
  saveLocale(next);
  window.location.reload();
}

/**
 * Скрипт в <head>: ставит `<html lang>` до первой отрисовки. Английский лендинг живёт на
 * «/en», остальное решает кука. Без куки остаётся русский из разметки.
 */
export function langBootScript(): string {
  return `try{var p=location.pathname,m=/(?:^|;\\s*)timely-lang=(ru|en)(?:;|$)/.exec(document.cookie),l=p==="/en"||p.indexOf("/en/")===0?"en":m&&m[1];if(l)document.documentElement.lang=l}catch(e){}`;
}
