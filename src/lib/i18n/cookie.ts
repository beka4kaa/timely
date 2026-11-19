// Кука с языком интерфейса без словарей: её читает и пишет и то, что грузится на каждой
// странице (установщик демо), а словарь нужен только кабинету.

import type { Locale } from "./types";

/** Кука с выбором языка: «ru» или «en». Её же пишет переключатель на лендинге. */
export const LOCALE_COOKIE = "timely-lang";

/** Год: выбор не должен забываться между визитами. */
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_LOCALE: Locale = "ru";

export function parseLocale(value: unknown): Locale | null {
  return value === "ru" || value === "en" ? value : null;
}

/** Язык из строки `document.cookie` или заголовка Cookie, если он выбран. */
export function cookieLocale(cookie: string | null | undefined): Locale | null {
  const match = /(?:^|;\s*)timely-lang=([^;]*)/.exec(cookie ?? "");
  return parseLocale(match?.[1]?.trim());
}

/** Записывает выбор в куку и в `<html lang>`. Только в браузере. */
export function writeLocaleCookie(next: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_MAX_AGE}; samesite=lax`;
  document.documentElement.lang = next;
}
