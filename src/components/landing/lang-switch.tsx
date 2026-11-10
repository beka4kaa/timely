"use client";

import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_MAX_AGE,
  LANDING_PATHS,
  type LandingLocale,
} from "@/lib/landing-locale";
import styles from "./lang-switch.module.css";

const LOCALES: LandingLocale[] = ["ru", "en"];

/**
 * Переключатель RU/EN в шапке лендинга. Выбор запоминается в куке, и middleware
 * больше не угадывает язык по браузеру. Переход — обычной ссылкой, без клиентской
 * навигации: так запрос с новой кукой точно дойдёт до middleware.
 */
export function LangSwitch({
  locale,
  label,
  names,
}: {
  locale: LandingLocale;
  label: string;
  names: Record<LandingLocale, string>;
}) {
  const remember = (next: LandingLocale) => {
    document.cookie = `${LANDING_LOCALE_COOKIE}=${next}; path=/; max-age=${LANDING_LOCALE_MAX_AGE}; samesite=lax`;
  };

  return (
    <div className={styles.switch} role="group" aria-label={label}>
      {LOCALES.map((code) => {
        const current = code === locale;
        return (
          <a
            key={code}
            href={LANDING_PATHS[code]}
            hrefLang={code}
            lang={code}
            title={names[code]}
            aria-label={names[code]}
            aria-current={current ? "page" : undefined}
            className={styles.item}
            onClick={() => remember(code)}
          >
            {code.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
