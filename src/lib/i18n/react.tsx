"use client";

// Язык для страниц, которые рисует сервер: вход, публичный чат, политика, «не найдено».
//
// Сервер не знает языка браузера, поэтому такая страница читает куку в своём layout и
// оборачивает себя в `LocaleProvider`. Компоненты внутри берут перевод из `useT()`: на
// сервере и в браузере язык один и тот же, и React не ругается на расхождение.
//
// Кабинет рисуется только в браузере, ему хватает обычного `t()` из `@/lib/i18n`. Без
// провайдера `useT()` берёт тот же язык, что и `t()`.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { dateLocale, getLocale, saveLocale, translate, translatePlural, type Locale } from "./index";

const LocaleContext = createContext<Locale | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext) ?? getLocale();
}

/** `const { t, plural } = useT()` — те же `t` и `plural`, что в `@/lib/i18n`, но с языком страницы. */
export function useT() {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      dateLocale: dateLocale(locale),
      t: (ru: string, vars?: Record<string, string | number>, context?: string) => translate(locale, ru, vars, context),
      plural: (n: number, one: string, few: string, many: string) => translatePlural(locale, n, one, few, many),
    }),
    [locale],
  );
}

/**
 * Запоминает язык, пришедший в адресе страницы (`?lang=en` с английского лендинга). Нужен
 * страницам, куда NextAuth не пускает middleware: вход и регистрация. Без языка ничего не делает.
 */
export function RememberLocale({ locale }: { locale: Locale | null }) {
  useEffect(() => {
    if (locale) saveLocale(locale);
  }, [locale]);
  return null;
}
