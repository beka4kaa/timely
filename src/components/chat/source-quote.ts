"use client";

// Что написано на процитированной странице.
//
// В ссылке на книгу текста нет: только книга, раздел и страницы. Текст берём тем же
// поиском, что нашёл его для ответа: тот же вопрос, та же книга, тот же режим доступа
// (решения задач в него не попадают). Цитата это дополнение к ссылке, поэтому отказ
// поиска тихий: на бумажке останутся раздел и страница.

import { useEffect, useState } from "react";

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";

interface Fragment {
  page_start: number;
  page_end: number;
  excerpt: string;
}

const QUOTE_LIMIT = 340;

// Один поиск на вопрос: перелистывание страниц одного ответа новых запросов не делает.
const cache = new Map<string, Promise<Fragment[]>>();

function findFragments(documentId: string, question: string): Promise<Fragment[]> {
  const key = `${documentId}\n${question}`;
  const known = cache.get(key);
  if (known) return known;
  const request = authFetch(`${BACKEND_URL}/api/curriculum/search/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: question, document_ids: [documentId], limit: 10 }),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { results?: Fragment[] };
      return body.results ?? [];
    })
    .catch(() => {
      // Сбой не запоминаем: в следующий раз поиск может и получиться.
      cache.delete(key);
      return [];
    });
  cache.set(key, request);
  return request;
}

/** Обрезает по границе слова: цитата не должна кончаться половиной слова. */
function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= QUOTE_LIMIT) return flat;
  const cut = flat.slice(0, QUOTE_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > QUOTE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function useSourceQuote({
  documentId,
  question,
  pageStart,
  pageEnd,
  excerpt,
}: {
  /** Фрагмент из самого ответа. Новые разговоры приносят его сразу, и поиск не нужен. */
  excerpt?: string;
  documentId: string;
  /** Вопрос, на который отвечали этой страницей. Пусто: искать нечем. */
  question: string;
  pageStart: number;
  pageEnd: number;
}): string {
  const [quote, setQuote] = useState("");

  useEffect(() => {
    if (excerpt) {
      setQuote(clip(excerpt));
      return;
    }
    setQuote("");
    if (!question || !pageStart) return;
    let alive = true;
    void findFragments(documentId, question).then((fragments) => {
      if (!alive) return;
      const match = fragments.find(
        (fragment) => fragment.page_start <= pageEnd && fragment.page_end >= pageStart,
      );
      setQuote(match ? clip(match.excerpt) : "");
    });
    return () => {
      alive = false;
    };
  }, [documentId, question, pageStart, pageEnd, excerpt]);

  return quote;
}
