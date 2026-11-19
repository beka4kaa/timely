// Цвет акцента, который ученик выбирает в настройках.
//
// Сами цвета живут в tokens.css (`--acc-*` для светлой и тёмной темы); здесь только список
// и выбор. Синий — по умолчанию и без атрибута, остальные ставят `data-accent` на <html>.
// Выбор живёт в этом браузере, как тема.

import { msg } from "./i18n";

export type AccentKey = "blue" | "violet" | "green" | "orange" | "pink" | "mono";

export const ACCENTS: { key: AccentKey; name: string }[] = [
  { key: "blue", name: msg("Синий") },
  { key: "violet", name: msg("Фиолетовый") },
  { key: "green", name: msg("Зелёный") },
  { key: "orange", name: msg("Оранжевый") },
  { key: "pink", name: msg("Розовый") },
  { key: "mono", name: msg("Без цвета") },
];

export const DEFAULT_ACCENT: AccentKey = "blue";
export const ACCENT_KEY = "timely-accent";

export function accentOf(raw: unknown): AccentKey {
  return ACCENTS.find((accent) => accent.key === raw)?.key ?? DEFAULT_ACCENT;
}

/**
 * Скрипт в <head>: ставит выбранный цвет до первой отрисовки, чтобы страница не мигнула
 * синим. Принимает только известные ключи, закрытое хранилище оставляет синий.
 */
export function accentBootScript(): string {
  const others = ACCENTS.filter((accent) => accent.key !== DEFAULT_ACCENT).map((accent) => accent.key);
  return `try{var a=localStorage.getItem(${JSON.stringify(ACCENT_KEY)});if(${JSON.stringify(others)}.indexOf(a)>-1)document.documentElement.setAttribute("data-accent",a)}catch(e){}`;
}

export function readAccent(): AccentKey {
  try {
    return accentOf(window.localStorage.getItem(ACCENT_KEY));
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Меняет цвет сразу на всей странице и запоминает его. */
export function applyAccent(key: AccentKey): void {
  const root = document.documentElement;
  if (key === DEFAULT_ACCENT) root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", key);
  try {
    window.localStorage.setItem(ACCENT_KEY, key);
  } catch {
    // Приватный режим: цвет проживёт до перезагрузки.
  }
}
