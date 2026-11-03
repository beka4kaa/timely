"use client";

// Правая колонка главной: тьютор, «Что подтянуть» и курсы.
//
// Тьютор здесь — вход, а не второй чат: вопрос уходит в панель справа, где
// живёт настоящий разговор с историей и ссылками на страницы. Две копии
// переписки на одном экране расходились бы на первом же ответе.

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUp, BookOpen, ChevronRight, Maximize2 } from "lucide-react";

import { SlimeGlyph } from "@/components/nav/slime-glyph";
import { useAskRail } from "@/contexts/ask-rail";
import { bookLabel } from "@/lib/book-label";
import type {
  CoursePlanSummary,
  CurriculumDocument,
  StudyMaterial,
  SubjectChatSummary,
} from "@/lib/curriculum-api";
import { PHASES, isTerminal, phaseIndexFor } from "@/lib/curriculum-progress";
import {
  dayMonthLabel,
  daysBetween,
  plural,
  relativeStamp,
  type UpcomingTest,
} from "@/lib/now-feed";
import { invalidateResources, type ResourceState } from "@/lib/resource-cache";
import { weekdayOf, zonedDateKey } from "@/lib/studyplan-calendar";
import { weekdayOnLabel } from "@/lib/studyplan-visuals";
import { getTopicStatusLabel, type Topic, type TopicStatus } from "@/types/mind";

import { reviewTopic } from "./now-resources";
import styles from "./now.module.css";
import { SubjectTile, tintClass } from "./subject-tile";

// ──────────────────────────────── Тьютор ─────────────────────────────────────

export function TutorCard({
  goalId,
  subject,
  topic,
  chats,
  subjects,
  now,
  timeZone,
}: {
  /** Предмет текущего шага или последнего разговора. */
  goalId: string | null;
  subject: string;
  /** Тема текущего шага — подсказки под полем спрашивают про неё. */
  topic: string | null;
  chats: SubjectChatSummary[];
  /**
   * Предметы ученика. Приглашение добавить первый учебник — только когда
   * список пришёл и он пуст: пока он грузится или не пришёл вовсе, звать
   * давнего ученика «добавить первую книгу» было бы неправдой.
   */
  subjects: { count: number; loaded: boolean };
  now: Date;
  timeZone: string;
}) {
  const { prompt } = useAskRail();
  const [text, setText] = useState("");
  const latest = [...chats]
    .filter((chat) => (goalId ? chat.goal === goalId : true))
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];

  const ask = (question: string) => {
    const clean = question.trim();
    if (!clean) return;
    prompt({ target: "book", goalId: goalId ?? undefined, text: clean, send: true });
    setText("");
  };

  const suggestions = topic
    ? [
        { label: "Объясни тему", text: `Объясни простыми словами: «${topic}».` },
        { label: "Дай задачу", text: `Дай мне одну задачу на «${topic}», решение пока не показывай.` },
        { label: "С чего начать", text: `С чего начать тему «${topic}»?` },
      ]
    : [];

  return (
    <section className={styles.panel} aria-labelledby="tutor-title">
      <div className={styles.panelHead}>
        <SlimeGlyph className={styles.tutorFace} />
        <h2 className={styles.panelTitle} id="tutor-title">
          Тьютор
        </h2>
        <Link className={styles.iconLink} href="/dashboard/chat" aria-label="Открыть тьютора целиком">
          <Maximize2 aria-hidden="true" />
        </Link>
      </div>

      {subjects.loaded && subjects.count === 0 ? (
        <p className={styles.panelEmpty}>
          Тьютор отвечает по твоим учебникам и ссылается на страницы.{" "}
          <Link href="/dashboard/curriculum">Добавь первый учебник</Link> — и спрашивай по
          нему.
        </p>
      ) : (
        <>
          <div className={styles.ctxRow}>
            <span className={styles.ctx}>
              <span>{subject || "Предмет на выбор"}</span>
            </span>
            {subject ? (
              <span className={styles.ctxSource}>
                <BookOpen aria-hidden="true" />
                По учебнику
              </span>
            ) : null}
          </div>

          {latest ? (
            <button
              type="button"
              className={styles.resume}
              onClick={() =>
                prompt({ target: "book", goalId: latest.goal ?? undefined, chatId: latest.id })
              }
            >
              <span className={styles.resumeLabel}>
                Продолжить · {relativeStamp(latest.updated_at, now, timeZone)}
                {latest.message_count
                  ? ` · ${latest.message_count} ${plural(latest.message_count, [
                      "сообщение",
                      "сообщения",
                      "сообщений",
                    ])}`
                  : ""}
              </span>
              <span className={styles.resumeTitle}>{latest.title || "Разговор без названия"}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          ) : null}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              ask(text);
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={topic ? "Что непонятно в теме?" : "Спроси по учебнику…"}
              aria-label="Вопрос тьютору"
              enterKeyHint="send"
            />
            <button type="submit" className={styles.send} disabled={!text.trim()} aria-label="Отправить">
              <ArrowUp aria-hidden="true" />
            </button>
          </form>

          <div className={styles.chips}>
            {suggestions.map((item) => (
              <button
                key={item.label}
                type="button"
                className={styles.chip}
                onClick={() => ask(item.text)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ───────────────────────────── Что подтянуть ─────────────────────────────────

/** «сегодня», «завтра», «в пятницу». */
function testWhen(test: UpcomingTest): string {
  if (test.inDays === 0) return "сегодня";
  if (test.inDays === 1) return "завтра";
  return weekdayOnLabel(weekdayOf(test.dateKey));
}

const STATUS_STEPS: Record<TopicStatus, number> = {
  NOT_STARTED: 0,
  MEDIUM: 1,
  SUCCESS: 2,
  MASTERED: 3,
};

function topicDue(topic: Topic, today: string, timeZone: string) {
  if (!topic.nextReviewAt) return null;
  const due = zonedDateKey(topic.nextReviewAt, timeZone);
  return daysBetween(due, today);
}

/** Просроченные сверху, потом сегодняшние, потом начатые, потом не начатые. */
function rankTopics(topics: Topic[], today: string, timeZone: string): Topic[] {
  const score = (topic: Topic) => {
    const late = topicDue(topic, today, timeZone);
    if (late !== null && late > 0) return 0;
    if (late === 0) return 1;
    if (topic.status !== "NOT_STARTED") return 2;
    return 3;
  };
  return [...topics]
    .filter((topic) => !topic.archived)
    .sort((left, right) => score(left) - score(right));
}

export function WeakTopicsCard({
  topics,
  tests,
  today,
  timeZone,
}: {
  topics: ResourceState<Topic[]>;
  tests: UpcomingTest[];
  today: string;
  timeZone: string;
}) {
  const { prompt } = useAskRail();
  const [reviewed, setReviewed] = useState<Record<string, "GOOD" | "AGAIN" | "busy">>({});
  const [failed, setFailed] = useState<string | null>(null);
  /** Объявление для скринридера: регион есть с самого начала, меняется текст. */
  const [announce, setAnnounce] = useState("");
  const focusDone = useRef<string | null>(null);
  const ranked = rankTopics(topics.data ?? [], today, timeZone).slice(0, 4);
  const test = tests[0];
  const testTopics = test?.subject
    ? (topics.data ?? []).filter((topic) =>
        (topic.subjectName ?? "").toLowerCase().includes(test.subject.toLowerCase()),
      ).length
    : 0;

  const review = async (topic: Topic, rating: "GOOD" | "AGAIN") => {
    setReviewed((current) => ({ ...current, [topic.id]: "busy" }));
    setFailed(null);
    try {
      await reviewTopic(topic.id, rating);
      focusDone.current = topic.id;
      setReviewed((current) => ({ ...current, [topic.id]: rating }));
      setAnnounce(`«${topic.name}»: записали.`);
      // Список и счётчик в рейле обновятся, когда ученик успеет прочитать
      // «записали». Тема при этом может уйти из списка вместе с фокусом на
      // подтверждении — тогда переводим его на заголовок карточки.
      window.setTimeout(() => {
        const item = document.getElementById(`topic-${topic.id}`)?.closest("li");
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
    <section className={styles.panel} aria-labelledby="weak-title">
      <p className={styles.srOnly} role="status" aria-live="polite">
        {announce}
      </p>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="weak-title" tabIndex={-1}>
          Что подтянуть
        </h2>
        <Link className={styles.link} href="/dashboard/weaknesses">
          Все темы
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>

      {test ? (
        <div className={styles.prep}>
          <p>
            <b>
              {test.title} {testWhen(test)}
            </b>
            {testTopics
              ? `${testTopics} ${plural(testTopics, ["тема", "темы", "тем"])} по предмету ещё не держатся`
              : "Самое время пройтись по слабым местам"}
          </p>
          <button
            type="button"
            className={styles.btn}
            onClick={() =>
              prompt({
                target: "book",
                text: `Помоги подготовиться: ${test.title}, ${dayMonthLabel(test.dateKey)}. Что повторить в первую очередь?`,
              })
            }
          >
            Подготовиться
          </button>
        </div>
      ) : null}

      {topics.loading ? (
        <div className={styles.topics} aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span key={index} className={styles.skel} style={{ height: 44, margin: "6px 10px" }} />
          ))}
        </div>
      ) : topics.error && topics.data === undefined ? (
        <p className={styles.panelEmpty}>Темы не загрузились — попробуем ещё раз чуть позже.</p>
      ) : ranked.length === 0 ? (
        <p className={styles.panelEmpty}>
          Здесь появятся темы, которые пора повторить. Отмечай их в разделе{" "}
          <Link href="/dashboard/weaknesses">«Слабые темы»</Link>.
        </p>
      ) : (
        <ul className={styles.topics}>
          {ranked.map((topic) => {
            const late = topicDue(topic, today, timeZone);
            const due = late !== null && late >= 0;
            const state = reviewed[topic.id];
            const steps = STATUS_STEPS[topic.status] ?? 0;
            return (
              <li key={topic.id} className={styles.topic}>
                <SubjectTile subject={topic.subjectName} />
                <p className={styles.topicName} id={`topic-${topic.id}`}>
                  {topic.name}
                </p>
                <span
                  className={styles.steps}
                  role="img"
                  aria-label={getTopicStatusLabel(topic.status)}
                >
                  {[0, 1, 2].map((index) => (
                    <i key={index} data-on={index < steps} />
                  ))}
                </span>
                <p className={styles.topicMeta}>
                  {getTopicStatusLabel(topic.status)}
                  {late !== null && late > 0 ? (
                    <>
                      {" · "}
                      <span className={styles.late}>
                        просрочено на {late} {plural(late, ["день", "дня", "дней"])}
                      </span>
                    </>
                  ) : late === 0 ? (
                    <>
                      {" · "}
                      <span className={styles.due}>повторить сегодня</span>
                    </>
                  ) : null}
                </p>
                {due && state !== "GOOD" && state !== "AGAIN" ? (
                  <div className={styles.topicActions}>
                    <button
                      type="button"
                      className={`${styles.topicBtn} ${styles.topicBtnGood}`}
                      disabled={state === "busy"}
                      aria-describedby={`topic-${topic.id}`}
                      onClick={() => void review(topic, "GOOD")}
                    >
                      Помню
                    </button>
                    <button
                      type="button"
                      className={styles.topicBtn}
                      disabled={state === "busy"}
                      aria-describedby={`topic-${topic.id}`}
                      onClick={() => void review(topic, "AGAIN")}
                    >
                      Не помню
                    </button>
                  </div>
                ) : null}
                {state === "GOOD" || state === "AGAIN" ? (
                  <p
                    className={styles.topicDone}
                    tabIndex={-1}
                    ref={(node) => {
                      // Кнопки, на которых стоял фокус, исчезли — переводим
                      // его на подтверждение, а не в начало страницы.
                      if (node && focusDone.current === topic.id) {
                        focusDone.current = null;
                        node.focus();
                      }
                    }}
                  >
                    {state === "GOOD"
                      ? "Записали — следующее повторение позже"
                      : "Записали — вернёмся к теме завтра"}
                  </p>
                ) : null}
                {failed === topic.id ? (
                  <p className={styles.revError} role="alert">
                    Не получилось записать — попробуй ещё раз.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────── Курсы ──────────────────────────────────────

const PLAN_STATUS: Record<string, string> = {
  draft: "собирается",
  reviewing: "проверяем программу",
  awaiting_approval: "ждёт подтверждения",
  active: "идёт",
  rejected: "отклонена",
  archived: "в архиве",
};

type CourseRow =
  | { kind: "plan"; plan: CoursePlanSummary }
  | { kind: "material"; material: StudyMaterial }
  | { kind: "document"; document: CurriculumDocument };

export function CoursesCard({
  plans,
  materials,
  documents,
  subjectOfGoal,
  today,
}: {
  plans: ResourceState<CoursePlanSummary[]>;
  materials: ResourceState<StudyMaterial[]>;
  documents: ResourceState<CurriculumDocument[]>;
  subjectOfGoal: (goalId: string | null) => string;
  today: string;
}) {
  const processing = (documents.data ?? []).filter(
    (document) => !isTerminal(document.ingestion_status),
  );
  const live = (plans.data ?? [])
    .filter((plan) => plan.status !== "archived" && plan.status !== "rejected")
    .sort((left, right) => (left.status === "active" ? -1 : 0) - (right.status === "active" ? -1 : 0));
  const tracked = (materials.data ?? []).filter((material) => material.total_units > 0);
  const sources = [plans, materials, documents];
  // «Курсов пока нет» — только если все три списка пришли и пусты. Упавший
  // запрос — это «не знаю», а не «нет».
  const failed = sources.some((source) => source.error && source.data === undefined);
  const settled = sources.every((source) => source.data !== undefined);

  const rows: CourseRow[] = [
    ...processing.map((document) => ({ kind: "document" as const, document })),
    ...live.map((plan) => ({ kind: "plan" as const, plan })),
    ...tracked.map((material) => ({ kind: "material" as const, material })),
  ].slice(0, 4);

  const loading = !settled && !failed;

  return (
    <section className={styles.panel} aria-labelledby="courses-title">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="courses-title">
          Курсы
        </h2>
        <Link className={styles.link} href="/dashboard/curriculum">
          Библиотека
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      {loading && !rows.length ? (
        <div className={styles.courses} aria-hidden="true">
          {[0, 1].map((index) => (
            <span key={index} className={styles.skel} style={{ height: 40, margin: "10px 0" }} />
          ))}
        </div>
      ) : !rows.length && failed ? (
        <p className={styles.panelEmpty} role="status">
          Курсы не загрузились. Они на месте — <Link href="/dashboard/curriculum">открой
          библиотеку</Link> или обнови страницу чуть позже.
        </p>
      ) : !rows.length ? (
        <p className={styles.panelEmpty}>
          Курсов пока нет. <Link href="/dashboard/curriculum">Добавь учебник</Link> — Timely
          соберёт программу по главам и разложит её по дням.
        </p>
      ) : (
        <ul className={styles.courses}>
          {rows.map((row) => {
            if (row.kind === "document") {
              const phase = PHASES[phaseIndexFor(row.document.ingestion_status)]?.label ?? "Обрабатываем";
              const title = bookLabel(row.document.title);
              return (
                <li key={`d-${row.document.id}`} className={`${styles.course} ${tintClass(title)}`}>
                  <SubjectTile subject={subjectOfGoal(row.document.goal) || title} />
                  <p className={styles.courseName}>{title}</p>
                  <span />
                  <p className={styles.courseSub}>
                    <span className={styles.spin} aria-hidden="true" />
                    {phase} — потом соберём программу
                  </p>
                </li>
              );
            }
            if (row.kind === "material") {
              const { material } = row;
              const percent = Math.round((material.completed_units / material.total_units) * 100);
              return (
                <li key={`m-${material.id}`} className={`${styles.course} ${tintClass(material.title)}`}>
                  <SubjectTile subject={subjectOfGoal(material.goal) || material.title} />
                  <p className={styles.courseName}>{material.title}</p>
                  <p className={styles.coursePct}>
                    {percent}&nbsp;%
                    <small>
                      {material.completed_units} из {material.total_units}
                    </small>
                  </p>
                  <p className={styles.courseSub}>{material.units_word || "Материал"}</p>
                  <div className={styles.meter} aria-hidden="true">
                    <i style={{ width: `${percent}%` }} />
                  </div>
                </li>
              );
            }
            const { plan } = row;
            const subject = subjectOfGoal(plan.goal) || plan.title;
            const finish = plan.forecast_finish_date;
            const finishLabel = finish
              ? `${dayMonthLabel(finish)}${finish.slice(0, 4) !== today.slice(0, 4) ? ` ${finish.slice(0, 4)}` : ""}`
              : "";
            return (
              <li key={`p-${plan.id}`} className={`${styles.course} ${tintClass(subject)}`}>
                <SubjectTile subject={subject} />
                <p className={styles.courseName}>
                  <Link href={`/dashboard/curriculum/plan/${plan.id}`}>{plan.title}</Link>
                </p>
                <span />
                <p className={styles.courseSub}>
                  {PLAN_STATUS[plan.status] ?? plan.status}
                  {finishLabel ? ` · финиш ${finishLabel}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
