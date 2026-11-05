"use client";

// Боковая колонка главной: стопка карточек о том, что впереди. Показываем только
// то, что есть в данных; пустой всегда может быть лишь карточка повторений, потому
// что только она объясняет, как начать.

import Link from "next/link";
import { useRef, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { useAskRail } from "@/contexts/ask-rail";
import {
  dayHeading,
  dayMonthLabel,
  daysBetween,
  homeworkTitle,
  plural,
  type HomeworkItem,
  type NextContest,
  type UpcomingTest,
} from "@/lib/now-feed";
import { invalidateResources, type ResourceState } from "@/lib/resource-cache";
import { formatMinutes, zonedDateKey } from "@/lib/studyplan-calendar";
import type { Topic, TopicStatus } from "@/types/mind";

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
            text: `Помоги подготовиться: ${first.title}, ${dayMonthLabel(first.dateKey)}. Что повторить в первую очередь?`,
          })
        }
      >
        Подготовиться
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
      href="/dashboard/arena/solve"
      data-attach={`Контест: ${contest.title}`}
    >
      <h2>
        {contest.running
          ? "Идёт контест"
          : `${dayHeading(contest.dateKey, today)} в ${formatMinutes(contest.minutes)}`}
      </h2>
      <ul>
        <li>{contest.title}</li>
      </ul>
      <span className="go">{contest.running ? "Участвовать" : "Открыть"}</span>
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
    <Link className="tile card quiet" href="/dashboard/diary">
      <h2>{title}</h2>
      <ul>
        {homework.items.map((item) => (
          <li key={item.id} data-attach={`Задание: ${item.subject}, ${item.text}`.slice(0, 120)}>
            {item.subject}
            <small>{item.text}</small>
          </li>
        ))}
      </ul>
    </Link>
  );
}

// ─────────────────────────────── Повторения ──────────────────────────────────

/** Сколько дней тема ждёт повторения: 0 сегодня, больше нуля просрочена, `null` срока нет. */
function topicDue(topic: Topic, today: string, timeZone: string): number | null {
  if (!topic.nextReviewAt) return null;
  return daysBetween(zonedDateKey(topic.nextReviewAt, timeZone), today);
}

const STARTED: Record<TopicStatus, boolean> = {
  NOT_STARTED: false,
  MEDIUM: true,
  SUCCESS: true,
  MASTERED: true,
};

/** Просроченные сверху, потом сегодняшние, потом начатые, потом не начатые. */
function rankTopics(topics: Topic[], today: string, timeZone: string): Topic[] {
  const score = (topic: Topic) => {
    const late = topicDue(topic, today, timeZone);
    if (late !== null && late > 0) return 0;
    if (late === 0) return 1;
    return STARTED[topic.status] ? 2 : 3;
  };
  return [...topics]
    .filter((topic) => !topic.archived)
    .sort((left, right) => score(left) - score(right));
}

type Reviewed = "GOOD" | "AGAIN" | "busy";

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

  const ranked = rankTopics(topics.data ?? [], today, timeZone);
  const due = ranked.filter((topic) => (topicDue(topic, today, timeZone) ?? -1) >= 0);
  const shown = (due.length ? due : ranked).slice(0, 4);
  // Кнопки только у одной темы, как и всё на этой странице: один следующий шаг.
  // Ответил, и они переходят к следующей.
  const active = due.find((topic) => {
    const state = reviewed[topic.id];
    return state !== "GOOD" && state !== "AGAIN";
  });

  const review = async (topic: Topic, rating: "GOOD" | "AGAIN") => {
    setReviewed((current) => ({ ...current, [topic.id]: "busy" }));
    setFailed(null);
    try {
      await reviewTopic(topic.id, rating);
      focusDone.current = topic.id;
      setReviewed((current) => ({ ...current, [topic.id]: rating }));
      setAnnounce(`«${topic.name}»: записали.`);
      if (rating === "GOOD") mascot.hop(0.7);
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
        {due.length || !shown.length ? "Пора повторить" : "Что подтянуть"}
      </h2>

      {topics.data === undefined && topics.error ? (
        <p className="tile-text">Темы не загрузились. Попробуем ещё раз чуть позже.</p>
      ) : topics.data === undefined ? (
        <div aria-hidden="true">
          <span className="now-skel is-tile" />
          <span className="now-skel is-tile" />
        </div>
      ) : !shown.length ? (
        <p className="tile-text">Здесь появятся темы, которые пора повторить.</p>
      ) : (
        <ul>
          {shown.map((topic) => {
            const late = topicDue(topic, today, timeZone);
            const state = reviewed[topic.id];
            const answered = state === "GOOD" || state === "AGAIN";
            return (
              <li key={topic.id} id={`topic-${topic.id}`} data-attach={`Тема: ${topic.name}`}>
                {topic.name}
                {!answered && late !== null && late > 0 ? (
                  <small>
                    просрочено на {late} {plural(late, ["день", "дня", "дней"])}
                  </small>
                ) : null}
                {active?.id === topic.id ? (
                  <div className="tile-acts">
                    <button
                      type="button"
                      className="btn btn-line"
                      disabled={state === "busy"}
                      aria-label={`Помню: ${topic.name}`}
                      onClick={() => void review(topic, "GOOD")}
                    >
                      Помню
                    </button>
                    <button
                      type="button"
                      className="btn btn-text"
                      disabled={state === "busy"}
                      aria-label={`Не помню: ${topic.name}`}
                      onClick={() => void review(topic, "AGAIN")}
                    >
                      Не помню
                    </button>
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
                    {state === "GOOD"
                      ? "Записали, следующее повторение позже"
                      : "Записали, вернёмся завтра"}
                  </p>
                ) : null}
                {failed === topic.id ? (
                  <p className="tile-fail" role="alert">
                    Не получилось записать, попробуй ещё раз.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Link className="go" href="/dashboard/weaknesses">
        {shown.length ? "Все темы" : "Слабые темы"}
      </Link>
    </section>
  );
}
