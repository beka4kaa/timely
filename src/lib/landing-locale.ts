// Язык лендинга. Русская версия живёт на «/», английская — на «/en».
//
// Первый заход на «/» решает middleware: если человек ещё не выбирал язык, а браузер
// не называет ни одного из языков, на которых у нас читают по-русски, его ведут на
// «/en». Выбор переключателем RU/EN запоминается в куке и дальше всегда главнее.
// Поисковики и превью ссылок остаются на «/»: английскую версию они находят по hreflang.
//
// Здесь только чистые функции, без Next: их проверяет landing-locale.test.ts.

export type LandingLocale = "ru" | "en";

/** Кука с выбором переключателя: «ru» или «en». */
export const LANDING_LOCALE_COOKIE = "timely-lang";

/** Год: выбор языка не должен забываться между визитами. */
export const LANDING_LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

export const LANDING_PATHS: Record<LandingLocale, "/" | "/en"> = { ru: "/", en: "/en" };

/**
 * Языки, с которыми человек скорее читает по-русски, чем по-английски: русский,
 * казахский, белорусский, киргизский, узбекский, таджикский.
 */
const RUSSIAN_READERS = new Set(["ru", "kk", "be", "ky", "uz", "tg"]);

const BOT_PATTERN =
  /bot\b|crawl|spider|slurp|mediapartners|facebookexternalhit|embedly|preview|whatsapp|telegram|vkshare|pinterest|lighthouse|headless|inspectiontool/i;

export function parseLandingLocale(value: string | null | undefined): LandingLocale | null {
  return value === "ru" || value === "en" ? value : null;
}

/**
 * Явный выбор в адресе: переключатель ведёт на «/?lang=ru». Нужен, когда кука не
 * запишется — ссылку открыли в новой вкладке колёсиком или куки заблокированы, —
 * иначе английский браузер не попал бы на русскую версию никак.
 */
export function explicitLandingLocale(search: string | null | undefined): LandingLocale | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return parseLandingLocale(params.get("lang"));
}

/** Робот, сборщик превью или автоматический браузер. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && BOT_PATTERN.test(userAgent);
}

/**
 * Есть ли в Accept-Language хоть один язык из RUSSIAN_READERS. Язык с q=0 браузер
 * прямо просит не присылать, он не считается. «*» значит «любой», то есть и русский.
 */
export function acceptsRussianReaderLanguage(acceptLanguage: string): boolean {
  return acceptLanguage.split(",").some((part) => {
    const [range, ...params] = part.split(";").map((piece) => piece.trim());
    const tag = range.toLowerCase();
    if (!tag) return false;
    const quality = params.find((param) => param.toLowerCase().startsWith("q="));
    if (quality && Number(quality.slice(2)) === 0) return false;
    if (tag === "*") return true;
    return RUSSIAN_READERS.has(tag.split("-")[0]);
  });
}

export interface LandingLocaleInput {
  pathname: string;
  search?: string;
  /** Значение куки LANDING_LOCALE_COOKIE, если она есть. */
  cookie?: string | null;
  acceptLanguage?: string | null;
  userAgent?: string | null;
}

export type LandingLocaleAction = { type: "redirect"; destination: string; status: 302 };

/**
 * Куда отправить заход на русскую главную, или null — показать её как есть.
 * Работает только для «/» на сайте-визитке; остальные адреса не трогает.
 */
export function resolveLandingLocale(input: LandingLocaleInput): LandingLocaleAction | null {
  if (input.pathname !== "/") return null;

  const search = input.search?.startsWith("?")
    ? input.search
    : input.search
      ? `?${input.search}`
      : "";
  const toEnglish: LandingLocaleAction = {
    type: "redirect",
    destination: `${LANDING_PATHS.en}${search}`,
    status: 302,
  };

  if (explicitLandingLocale(input.search) === "ru") return null;

  const chosen = parseLandingLocale(input.cookie);
  if (chosen) return chosen === "en" ? toEnglish : null;

  if (isBotUserAgent(input.userAgent)) return null;
  // Без заголовка язык не узнать, а такие запросы шлют скорее программы, чем люди.
  const acceptLanguage = input.acceptLanguage?.trim();
  if (!acceptLanguage) return null;

  return acceptsRussianReaderLanguage(acceptLanguage) ? null : toEnglish;
}
