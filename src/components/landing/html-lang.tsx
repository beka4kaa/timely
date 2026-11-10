"use client";

import { useEffect } from "react";

/**
 * Язык всего документа для версии лендинга не на русском.
 *
 * Корневой layout общий для всего сайта и всегда пишет `<html lang="ru">`, а сделать
 * его зависимым от адреса значит лишить статики все страницы. Поэтому язык меняется
 * здесь: строчка скрипта срабатывает ещё при разборе HTML, до первой отрисовки, а
 * эффект возвращает прежний язык, если со страницы уйти внутри приложения. Сам текст
 * страницы и так помечен своим `lang` на обёртке.
 */
export function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = lang;
    return () => {
      root.lang = before;
    };
  }, [lang]);

  return (
    <script
      // Значение — код языка из нашего же словаря, не ввод пользователя.
      dangerouslySetInnerHTML={{ __html: `document.documentElement.lang=${JSON.stringify(lang)}` }}
    />
  );
}
