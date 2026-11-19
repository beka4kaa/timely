"use client";

// Боковая колонка главной: стопка карточек о том, что впереди. Показываем только
// то, что есть в данных; пустой всегда может быть лишь карточка повторений, потому
// что только она объясняет, как начать.

import Link from "next/link";
import { useRef, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { useAskRail } from "@/contexts/ask-rail";
import { t } from "@/lib/i18n";
import { REVIEW_RATES, intervalLabel } from "@/lib/mind-srs";
import {
  dayHeading,
  dayMonthLabel,
  homeworkTitle,
  plural,
  rankTopics,
  topicDue,
  type HomeworkItem,
  type NextContest,
  type UpcomingTest,
} from "@/lib/now-feed";
import { invalidateResources, type ResourceState } from "@/lib/resource-cache";
import { formatMinutes } from "@/lib/studyplan-calendar";
import type { ReviewRating, Topic } from "@/types/mind";

import { reviewTopic } from "./now-resources";

// ─────────────────────────────── Контрольная ─────────────────────────────────

export function TestTile({
  tests,
  topics,
  today,
}: {
  tests: UpcomingTest[];
  topics: Topic[];
  today: string;
}) {
  const { prompt } = useAskRail();
  const first = tests[0];
  if (!first) return null;
  const sameDay = tests.filter((test) => test.dateKey === first.dateKey);
  const shaky = first.subject
    ? topics.filter((topic) =>
        (topic.subjectName ?? "").toLowerCase().includes(first.subject.toLowerCase()),
      ).length
    : 0;
  return (
    <section
      className="tile card quiet soon"
      data-attach={`${first.title}, ${dayMonthLabel(first.dateKey)}`}
    >
      <h2>{dayHeading(first.dateKey, today)}</h2>
      <ul>
        {sameDay.map((test, index) => (
          <li key={`${test.title}-${index}`}>{test.title}</li>
        ))}
      </ul>
      {shaky ? (
        <small>
          {shaky} {plural(shaky, ["тема ещё не держится", "темы ещё не держатся", "тем ещё не держатся"])}
        </small>
      ) : null}
      <button
        type="button"
        className="go is-stretched"
        onClick={() =>
          prompt({
            target: "book",
            text: t("Помоги подготовиться: {title}, {date}. Что повторить в первую очередь?", {
              title: first.title,
              date: dayMonthLabel(first.dateKey),
            }),
          })
        }
      >
        {t("Подготовиться")}
      </button>
    </section>
  );
}

// ──────────────────────────────── Контест ────────────────────────────────────

export function ContestTile({ contest, today }: { contest: NextContest | null; today: string }) {
  if (!contest) return null;
  return (
    <Link
      className="tile card quiet soon"
      href={`/dashboard/arena/solve/${contest.id}`}
      data-attach={t("Контест: {title}", { title: contest.title })}
    >
      <h2>
        {contest.running
          ? t("Идёт контест")
          : t("{day} в {time}", {
              day: dayHeading(contest.dateKey, today),
              time: formatMinutes(contest.minutes),
            })}
      </h2>
      <ul>
        <li>{contest.title}</li>
      </ul>
      <span className="go">{contest.running ? t("Участвовать") : t("Открыть")}</span>
    </Link>
  );
}

// ──────────────────────────────── Задано ─────────────────────────────────────

export function HomeworkTile({
  homework,
  today,
}: {
  homework: { dateKey: string; items: HomeworkItem[] } | null;
  today: string;
}) {
  if (!homework) return null;
  const title = homeworkTitle(homework.dateKey, today);
  return (
    <Link className="tile card quiet" href="/dashboard/plan">
      <h2>{title}</h2>
      <ul>
        {homework.items.map((item) => (
          <li key={item.id} data-attach={t("Задание: {subject}, {text}", { subject: item.subject, text: item.text }).slice(0, 120)}>
            {item.subject}
            <small>{item.text}</small>
          </li>
        ))}
      </ul>
    </Link>
  );
}

// ─────────────────────────────── Повторения ──────────────────────────────────

/** Ответ записан: через сколько дней тема вернётся, если сервер это прислал. */
type Reviewed = "busy" | { days: number | null };

export function WeakTile({
  topics,
  today,
  timeZone,
}: {
  topics: ResourceState<Topic[]>;
  today: string;
  timeZone: string;
}) {
  const [reviewed, setReviewed] = useState<Record<string, Reviewed>>({});
  const [failed, setFailed] = useState<string | null>(null);
  /** Объявление для скринридера: регион есть с самого начала, меняется текст. */
  const [announce, setAnnounce] = useState("");
  const focusDone = useRef<string | null>(null);

  // Просроченные по шансу вспомнить, самый низкий первым: его считает сервер, а
  // ученику число не показываем, только порядок.
  const ranked = rankTopics(topics.data ?? [], today, timeZone);
  const due = ranked.filter((topic) => (topicDue(topic, today, timeZone) ?? -1) >= 0);
  const shown = (due.length ? due : ranked).slice(0, 4);
  // Кнопки только у одной темы, как и всё на этой странице: один следующий шаг.
  // Ответил, и они переходят к следующей.
  const active = due.find((topic) => typeof reviewed[topic.id] !== "object");

  const review = async (topic: Topic, rating: ReviewRating) => {
    setReviewed((current) => ({ ...current, [topic.id]: "busy" }));
    setFailed(null);
    try {
      const updated = await reviewTopic(topic.id, rating);
      const days = typeof updated?.intervalDays === "number" ? updated.intervalDays : null;
      focusDone.current = topic.id;
      setReviewed((current) => ({ ...current, [topic.id]: { days } }));
      setAnnounce(t("«{name}»: записали.", { name: topic.name }));
      if (rating === "GOOD" || rating === "EASY") mascot.hop(0.7);
      // Список и счётчик в панели обновятся, когда ученик успеет прочитать
      // «записали». Тема при этом может уйти из списка вместе с фокусом на
      // подтверждении: тогда переводим его на заголовок карточки.
      window.setTimeout(() => {
        const item = document.getElementById(`topic-${topic.id}`);
        if (item?.contains(document.activeElement)) {
          document.getElementById("weak-title")?.focus();
        }
        invalidateResources("now:topics:");
      }, 2500);
    } catch {
      setReviewed((current) => {
        const next = { ...current };
        delete next[topic.id];
        return next;
      });
      setFailed(topic.id);
    }
  };

  return (
    <section className="tile card quiet is-static" aria-labelledby="weak-title">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <h2 id="weak-title" tabIndex={-1}>
        {due.length || !shown.length ? t("Пора повторить") : t("Что подтянуть")}
      </h2>

      {topics.data === undefined && topics.error ? (
        <p className="tile-text">{t("Темы не загрузились. Попробуем ещё раз чуть позже.")}</p>
      ) : topics.data === undefined ? (
        <div aria-hidden="true">
          <span className="now-skel is-tile" />
          <span className="now-skel is-tile" />
        </div>
      ) : !shown.length ? (
        <p className="tile-text">{t("Здесь появятся темы, которые пора повторить.")}</p>
      ) : (
        <ul>
          {shown.map((topic) => {
            const late = topicDue(topic, today, timeZone);
            const state = reviewed[topic.id];
            const answered = typeof state === "object" ? state : null;
            return (
              <li key={topic.id} id={`topic-${topic.id}`} data-attach={t("Тема: {name}", { name: topic.name })}>
                {topic.name}
                {!answered && late !== null && late > 0 ? (
                  <small>
                    {t("просрочено на {days}", {
                      days: `${late} ${plural(late, ["день", "дня", "дней"])}`,
                    })}
                  </small>
                ) : null}
                {active?.id === topic.id ? (
                  <div className="tile-acts is-rates">
                    {REVIEW_RATES.map((row) => (
                      <button
                        key={row.rating}
                        type="button"
                        className="btn btn-line"
                        disabled={state === "busy"}
                        aria-label={`${row.label}: ${topic.name}`}
                        onClick={() => void review(topic, row.rating)}
                      >
                        {row.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {answered ? (
                  <p
                    className="tile-done"
                    tabIndex={-1}
                    ref={(node) => {
                      // Кнопки, на которых стоял фокус, исчезли: переводим его на
                      // подтверждение, а не в начало страницы.
                      if (node && focusDone.current === topic.id) {
                        focusDone.current = null;
                        node.focus();
                      }
                    }}
                  >
                    {answered.days === null
                      ? t("Записали")
                      : t("Записали, повторим {when}", { when: intervalLabel(answered.days) })}
                  </p>
                ) : null}
                {failed === topic.id ? (
                  <p className="tile-fail" role="alert">
                    {t("Не получилось записать, попробуй ещё раз.")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Link className="go" href="/dashboard/weaknesses">
        {shown.length ? t("Все темы") : t("Слабые темы")}
      </Link>
    </section>
  );
}
