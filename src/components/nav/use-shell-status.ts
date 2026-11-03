"use client";

// Отметки рейла: идёт ли занятие, сколько тем пора повторить, читается ли книга.
//
// Это то, что ученику полезно видеть с любой страницы, не открывая главную.
// Данные — из того же кэша, что у главной: на ней отметки ничего не стоят, на
// остальных страницах загружаются с задержкой, чтобы не мешать самой странице.

import { useMemo } from "react";

import {
  DOCUMENTS_KEY,
  TTL,
  WEAK_TOPICS_KEY,
  blocksKey,
  fetchBlocks,
  fetchDocuments,
  fetchWeakTopics,
} from "@/components/now/now-resources";
import { isTerminal } from "@/lib/curriculum-progress";
import { buildDay } from "@/lib/now-feed";
import { useResource } from "@/lib/resource-cache";
import { zonedDateKey } from "@/lib/studyplan-calendar";
import { browserTimeZone, useNow } from "@/lib/use-now";
import { isDueToday } from "@/types/mind";

export interface ShellStatus {
  /** Сейчас идёт занятие из плана. */
  live: boolean;
  /** Тем, которые пора повторить сегодня (включая просроченные). */
  dueReviews: number;
  /** Какая-то книга ещё обрабатывается. */
  ingesting: boolean;
}

export function useShellStatus(enabled: boolean): ShellStatus {
  const now = useNow(60_000);
  const timeZone = useMemo(browserTimeZone, []);
  const today = now ? zonedDateKey(now, timeZone) : null;

  const options = { ttl: TTL.status, delay: 1500 };
  const blocks = useResource(
    enabled && today ? blocksKey(timeZone, today) : null,
    () => fetchBlocks(timeZone, today ?? ""),
    options,
  );
  const topics = useResource(enabled ? WEAK_TOPICS_KEY : null, fetchWeakTopics, options);
  const documents = useResource(enabled ? DOCUMENTS_KEY : null, fetchDocuments, options);

  return useMemo(() => {
    const live =
      now && blocks.data
        ? buildDay({ now, timeZone, lessons: [], blocks: blocks.data }).hero?.mode === "now"
        : false;
    const dueReviews = (topics.data ?? []).filter((topic) => isDueToday(topic.nextReviewAt)).length;
    const ingesting = (documents.data ?? []).some(
      (document) => !isTerminal(document.ingestion_status),
    );
    return { live, dueReviews, ingesting };
  }, [now, timeZone, blocks.data, topics.data, documents.data]);
}
