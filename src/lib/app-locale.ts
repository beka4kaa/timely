// Язык кабинета и демо из адреса. Ссылки с английского лендинга несут `?lang=en`:
// middleware запоминает выбор в куке `timely-lang` и убирает его из адреса.
//
// Вход переносит исходный адрес в `callbackUrl`, поэтому `lang` ищется и там: иначе
// человек с английского лендинга увидел бы страницу входа по-русски.
//
// Чистые функции без Next и без словарей: их проверяет app-locale.test.ts, а middleware
// не тянет за собой переводы.

import { parseLandingLocale, type LandingLocale } from "./landing-locale";

export interface AppLocaleAction {
  locale: LandingLocale;
  /** Тот же адрес без `lang`. */
  destination: string;
}

const RELATIVE_BASE = "http://relative.invalid";

/** Убирает `lang` из адреса `callbackUrl`, сохраняя его вид: абсолютный или относительный. */
function stripLang(raw: string): { url: string; locale: LandingLocale | null } {
  let parsed: URL;
  try {
    parsed = new URL(raw, RELATIVE_BASE);
  } catch {
    return { url: raw, locale: null };
  }
  const locale = parseLandingLocale(parsed.searchParams.get("lang"));
  if (!locale) return { url: raw, locale: null };
  parsed.searchParams.delete("lang");
  const tail = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return { url: parsed.origin === RELATIVE_BASE ? tail : `${parsed.origin}${tail}`, locale };
}

/** Что сделать с запросом: запомнить язык и открыть адрес без `lang`, или ничего (null). */
export function resolveAppLocale(pathname: string, search: string): AppLocaleAction | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  let locale = parseLandingLocale(params.get("lang"));
  if (locale) params.delete("lang");

  const callback = params.get("callbackUrl");
  if (callback) {
    const inner = stripLang(callback);
    if (inner.locale) {
      locale ??= inner.locale;
      params.set("callbackUrl", inner.url);
    }
  }

  if (!locale) return null;
  const rest = params.toString();
  return { locale, destination: `${pathname}${rest ? `?${rest}` : ""}` };
}

/**
 * Язык из параметров страницы (`searchParams` в Next): `lang` сверху или внутри `callbackUrl`.
 * Нужен страницам входа и регистрации: NextAuth не пускает на них middleware, поэтому язык
 * с английского лендинга они читают сами.
 */
export function localeFromParams(params: Record<string, string | string[] | undefined>): LandingLocale | null {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) search.set(key, first);
  }
  return resolveAppLocale("/", search.toString())?.locale ?? null;
}

/** Ссылка лендинга в приложение или демо: английский лендинг добавляет `lang=en`. */
export function withLang(url: string, locale: LandingLocale): string {
  if (locale === "ru" || !url) return url;
  const [base, hash = ""] = url.split("#", 2);
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}lang=${locale}${hash ? `#${hash}` : ""}`;
}
