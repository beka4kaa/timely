// Язык на сервере: из куки запроса. Для заголовков вкладок (`generateMetadata`) и для
// страниц, которые рисует сервер (вход, публичный чат): они передают язык в `LocaleProvider`.
//
//   export async function generateMetadata(): Promise<Metadata> {
//     const { t } = await serverT();
//     return { title: t("Помодоро") };
//   }

import { cookies } from "next/headers";

import { DEFAULT_LOCALE, LOCALE_COOKIE, parseLocale, translate, translatePlural, type Locale } from "./index";

export async function serverLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value) ?? DEFAULT_LOCALE;
}

export async function serverT() {
  const locale = await serverLocale();
  return {
    locale,
    t: (ru: string, vars?: Record<string, string | number>, context?: string) => translate(locale, ru, vars, context),
    plural: (n: number, one: string, few: string, many: string) => translatePlural(locale, n, one, few, many),
  };
}
