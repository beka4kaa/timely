"use client";

// Слабые темы: колода на сегодня, кривая памяти и список, который заполняется сам.

import { useCallback, useEffect, useMemo, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { SubNav } from "@/components/shell/tab-bar";
import { useAskRail } from "@/contexts/ask-rail";
import { intervalLabel, plural } from "@/lib/mind-srs";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";
import { dueTopics, nearestTopic, type WeakTopic } from "@/lib/weak-topics";
import {
  WEAK_PAGE_SUBJECTS_KEY,
  WEAK_PAGE_TOPICS_KEY,
  fetchAllTopics,
  fetchSubjects,
  patchTopic,
  replaceTopic,
  reviewTopic,
  scheduleOf,
  type TopicSchedule,
} from "@/lib/weak-topics-api";
import type { ReviewRating } from "@/types/mind";

import { WeakDeck, WeakEmpty } from "./weak-deck";
import { WeakLearned } from "./weak-learned";
import { WeakList } from "./weak-list";
import { WeakNoteView, useWeakNote } from "./weak-note";


/** Сколько подсвечена только что добавленная тема. */
const FRESH_MS = 1500;

export function WeakPage() {
  const topicsResource = useResource(WEAK_PAGE_TOPICS_KEY, fetchAllTopics, { ttl: 60_000 });
  const subjectsResource = useResource(WEAK_PAGE_SUBJECTS_KEY, fetchSubjects, { ttl: 5 * 60_000 });
  const now = useNow(60_000);
  const { prompt } = useAskRail();
  const { note, notify, dismiss } = useWeakNote();

  // Оценённые за этот заход: у них уже новый срок, а в счётчике карточек они остаются.
  const [reviewed, setReviewed] = useState<string[]>([]);
  // «Повторить сейчас»: тема вне очереди, сверху колоды.
  const [pulled, setPulled] = useState<string[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  const topics = topicsResource.data;
  const subjects = useMemo(() => subjectsResource.data ?? [], [subjectsResource.data]);
  const dayKey = now?.toDateString();

  // Пришёл повторять: напоминание сделало своё дело.
  useEffect(() => {
    mascot.remindOff();
  }, []);

  const queue = useMemo(() => {
    if (!topics || !now) return [];
    const done = new Set(reviewed);
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    const first = pulled
      .map((id) => byId.get(id))
      .filter((topic): topic is WeakTopic => Boolean(topic && !topic.archived && !done.has(topic.id)));
    const taken = new Set(first.map((topic) => topic.id));
    return [...first, ...dueTopics(topics, now).filter((topic) => !done.has(topic.id) && !taken.has(topic.id))];
    // `now` меняется каждую минуту, а колода зависит только от дня.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topics, reviewed, pulled, dayKey]);

  const doneCount = useMemo(() => {
    const known = new Set((topics ?? []).map((topic) => topic.id));
    return reviewed.filter((id) => known.has(id)).length;
  }, [topics, reviewed]);

  const nearest = useMemo(
    () => (topics && now ? nearestTopic(topics, now) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topics, dayKey],
  );

  const mastered = useMemo(
    () => (topics ?? []).filter((topic) => !topic.archived && topic.status === "MASTERED").length,
    [topics],
  );

  const undoReview = useCallback(async (id: string, before: TopicSchedule) => {
    try {
      replaceTopic(await patchTopic(id, before));
      setReviewed((list) => list.filter((row) => row !== id));
    } catch {
      notify({ text: "Не получилось вернуть оценку", failed: true });
    }
  }, [notify]);

  const rate = useCallback(
    (topic: WeakTopic, rating: ReviewRating) => {
      const before = scheduleOf(topic);
      setReviewed((list) => (list.includes(topic.id) ? list : [...list, topic.id]));
      setPulled((list) => list.filter((id) => id !== topic.id));
      if (rating === "GOOD" || rating === "EASY") mascot.hop(0.7);
      reviewTopic(topic.id, rating)
        .then((updated) => {
          replaceTopic(updated);
          notify({
            text: `Повторим ${intervalLabel(updated.intervalDays ?? 1)}`,
            action: { label: "Вернуть", run: () => void undoReview(topic.id, before) },
          });
        })
        .catch(() => {
          // Карточка возвращается в колоду: оценка не записалась, терять её нельзя.
          setReviewed((list) => list.filter((id) => id !== topic.id));
          notify({ text: "Не получилось записать повторение. Попробуй ещё раз", failed: true });
        });
    },
    [notify, undoReview],
  );

  const pull = useCallback((topic: WeakTopic) => {
    setReviewed((list) => list.filter((id) => id !== topic.id));
    setPulled((list) => [topic.id, ...list.filter((id) => id !== topic.id)]);
    const smooth = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    document.querySelector(".main")?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const askAboutTopic = useCallback(
    (topic: WeakTopic) => {
      prompt({ target: "book", text: `Помоги разобраться с темой «${topic.name}»`, send: false });
    },
    [prompt],
  );

  const askQuestion = useCallback(
    (text: string) => {
      prompt({ target: "book", text, send: true });
    },
    [prompt],
  );

  const onAdded = useCallback((ids: string[]) => {
    setFreshIds(new Set(ids));
    window.setTimeout(() => setFreshIds(new Set()), FRESH_MS);
  }, []);

  const active = topics?.filter((topic) => !topic.archived) ?? [];
  const failed = !topics && topicsResource.error;
  const ready = Boolean(topics && now);

  return (
    <div className="content view">
      <SubNav group="study" />
      <header className="head">
        <h1 className="title">Слабые темы</h1>
        {mastered > 0 ? (
          <span className="head-note">
            {plural(mastered, "Усвоена", "Усвоено", "Усвоено")} {mastered} {plural(mastered, "тема", "темы", "тем")}
          </span>
        ) : null}
      </header>

      {failed ? (
        <div className="card weak-error" role="alert">
          <p>Не удалось загрузить темы. Проверь связь и попробуй ещё раз.</p>
          <button className="btn btn-line" type="button" onClick={topicsResource.reload}>
            Повторить
          </button>
        </div>
      ) : null}

      {!ready && !failed ? (
        <section className="rv is-solo" aria-label="Повторение">
          <div className="rv-deck" data-left="1">
            <div className="rv-card glass" role="status">
              <p className="q-status shine weak-loading">Собираю темы…</p>
            </div>
          </div>
        </section>
      ) : null}

      {ready && now && topics ? (
        active.length ? (
          <WeakDeck
            current={queue[0] ?? null}
            left={queue.length}
            done={doneCount}
            nearest={nearest}
            now={now}
            onRate={rate}
            onAsk={askAboutTopic}
          />
        ) : (
          <WeakEmpty />
        )
      ) : null}

      {failed ? null : (
        <WeakLearned
          subjects={subjects}
          topics={topics ?? []}
          ready={topics !== null && topics !== undefined}
          onAdded={onAdded}
          onAsk={askQuestion}
        />
      )}

      {ready && now && topics ? (
        <WeakList
          topics={topics}
          subjects={subjects}
          now={now}
          freshIds={freshIds}
          onAsk={askAboutTopic}
          onPull={pull}
          notify={notify}
        />
      ) : null}

      <WeakNoteView note={note} onClose={dismiss} />
    </div>
  );
}
