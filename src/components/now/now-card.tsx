"use client";

// Карточка шага: то, ради чего главная существует (CLAUDE.md §3.1). Что делать
// сейчас, когда это готово, где это в учебнике и одна кнопка, с которой начать.
// Единственный большой кусок стекла на странице.
//
// Кольцо показывает, сколько осталось от занятия, а когда идёт фокус-таймер,
// становится им: таймер один на всё приложение и живёт в сторе помодоро.

import Link from "next/link";
import { useEffect } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { BOARD_ENABLED } from "@/config/features";
import { useAskRail } from "@/contexts/ask-rail";
import { bookLabel } from "@/lib/book-label";
import type { CoursePlan, CurriculumDocument } from "@/lib/curriculum-api";
import { formatSource } from "@/lib/curriculum-progress";
import {
  attachLabel,
  criterionText,
  dayPhrase,
  nbsp,
  partLabel,
  pickPresetIndex,
  plural,
  splitBlockTitle,
  untilLabel,
  workspaceOf,
  type Hero,
} from "@/lib/now-feed";
import { PRESETS, clockOf, dayKey, presetAt } from "@/lib/pomodoro";
import type { CalendarLearningBlock } from "@/lib/studyplan-api";
import { formatMinutes, zonedDateKey, zonedMinutes } from "@/lib/studyplan-calendar";
import { activityLabel, durationLabel } from "@/lib/studyplan-visuals";
import {
  selectElapsed,
  selectHasStarted,
  selectPlanned,
  selectRemaining,
  usePomodoroStore,
} from "@/stores/pomodoro-store";

const POMODORO_HREF = "/dashboard/pomodoro";

/** Тот же ключ, что у мини-окна и страницы чата: «какой предмет открыт». */
const SUBJECT_KEY = "timely.ask.subject";

/** Чат откроется на книге этого занятия, а не на той, что выбирали в прошлый раз. */
function rememberSubject(goalId: string | null) {
  if (!goalId) return;
  try {
    window.localStorage.setItem(SUBJECT_KEY, goalId);
  } catch {
    // Хранилище недоступно: чат откроется на предмете по умолчанию.
  }
}

/** «§9, стр. 41–42» для темы блока, из программы курса. */
function citationOf(
  block: CalendarLearningBlock,
  plan: CoursePlan | undefined,
  documents: CurriculumDocument[],
): string {
  if (!plan || !block.topic) return "";
  for (const chapter of plan.modules ?? []) {
    const topic = chapter.topics?.find((item) => item.id === block.topic);
    if (!topic) continue;
    const source = topic.sources?.map(formatSource).find(Boolean) ?? "";
    if (!source) return "";
    const book = documents.find((document) => document.id === plan.document);
    return book ? `${bookLabel(book.title)}, ${source}` : source;
  }
  return "";
}

function criterionOf(block: CalendarLearningBlock): string {
  const payload = block.lesson_payload as { completion?: unknown } | undefined;
  const raw =
    block.mastery_criteria ||
    (typeof payload?.completion === "string" ? payload.completion : "");
  return raw ? criterionText(raw) : "";
}

/** Планировщик пишет критерий целым предложением, а здесь он идёт после двоеточия. */
function lowerFirst(text: string): string {
  // «СОР пройден» не должен стать «сОР пройден».
  if (text.length > 1 && text[1] !== text[1].toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function minutesWord(count: number): string {
  return `${count} ${plural(count, ["минута", "минуты", "минут"])}`;
}

export function NowCard({
  hero,
  dateKey,
  goalId,
  plan,
  documents,
  focusLogged,
}: {
  hero: Hero;
  dateKey: string;
  /** Предмет программы: тьютор будет отвечать по этой книге. */
  goalId: string | null;
  plan: CoursePlan | undefined;
  documents: CurriculumDocument[];
  focusLogged: number | null;
}) {
  const { prompt } = useAskRail();
  const { block } = hero;
  const { topic, detail } = splitBlockTitle(block.title);
  const course = block.course_plan_title?.trim() || "Занятие";
  const part = partLabel(detail);
  const criterion = criterionOf(block);
  const objective = block.objective?.trim() ?? "";
  const citation = citationOf(block, plan, documents);
  const action = workspaceOf(block, topic, BOARD_ENABLED);
  const draft = block.schedule_status === "proposed" || block.schedule_status === "draft";
  const live = hero.mode === "now";
  const sub = [
    course,
    block.review_step
      ? `${block.review_step}-е повторение`
      : activityLabel(block.activity_type).toLowerCase(),
    part,
    live ? "" : nbsp(untilLabel(hero.minutesUntil)),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <article
      className="now glass"
      aria-current={live ? "step" : undefined}
      aria-labelledby="now-title"
      data-attach={attachLabel(topic, dateKey, hero.start)}
    >
      <time>{formatMinutes(hero.start)}</time>
      <div>
        <h2 className="now-title" id="now-title" tabIndex={-1}>
          {topic}
        </h2>
        <p className="now-sub">{sub}</p>
        {criterion || objective || citation ? (
          <p className="now-crit">
            {criterion ? `Когда готово: ${lowerFirst(criterion)}.` : objective}
            {(criterion || objective) && citation ? " " : ""}
            {citation ? (
              <Link className="link" href={`/dashboard/curriculum/plan/${block.course_plan}`}>
                {citation}
              </Link>
            ) : null}
          </p>
        ) : null}
        {block.fixed ? (
          <p className="now-note">Закреплено: планировщик это время не двигает.</p>
        ) : null}
        {draft ? <p className="now-note">Это предложение плана, его ещё можно поменять.</p> : null}
        <div className="now-actions">
          <Link
            className="btn btn-main"
            href={action.href}
            onClick={() => rememberSubject(goalId)}
          >
            {action.label}
          </Link>
          <button
            type="button"
            className="btn btn-line"
            onClick={() =>
              prompt({
                target: "book",
                goalId: goalId ?? undefined,
                text: `Помоги с темой «${topic}»: `,
              })
            }
          >
            Нужна помощь
          </button>
          <FocusButtons hero={hero} />
          <FocusToday focusLogged={focusLogged} />
        </div>
      </div>
      <FocusRing hero={hero} />
    </article>
  );
}

/**
 * Сколько осталось: от занятия, а если идёт таймер, то от подхода.
 *
 * Отдельным компонентом, потому что таймер перерисовывает его каждую секунду, а
 * всей карточке это незачем. Без шага кольцо есть, только пока идёт таймер: занятие
 * могло кончиться раньше подхода, а больше нигде на странице отсчёта нет.
 */
function FocusRing({ hero }: { hero: Hero | null }) {
  const running = usePomodoroStore((state) => state.running);
  const phase = usePomodoroStore((state) => state.phase);
  const remaining = usePomodoroStore(selectRemaining);
  const planned = usePomodoroStore(selectPlanned);
  const started = usePomodoroStore(selectHasStarted);

  if (started) {
    const word = !running ? "пауза" : phase === "focus" ? "фокус" : "перерыв";
    const percent = planned ? Math.round((remaining / planned) * 100) : 0;
    return (
      <Link
        className="ring is-clock"
        href={POMODORO_HREF}
        style={{ "--p": percent } as React.CSSProperties}
        aria-label={`Таймер: ${word}, осталось ${clockOf(remaining)}, открыть таймер`}
      >
        <span className="ring-arc" />
        <span className="ring-head" />
        <span className="ring-v">
          {clockOf(remaining)}
          <small>{word}</small>
        </span>
      </Link>
    );
  }

  if (!hero) return null;

  const length = Math.max(1, hero.end - hero.start);
  // Занятие ещё не началось: впереди всё его время, кольцо полное.
  const left = hero.mode === "now" ? hero.minutesLeft : length;
  const percent = Math.round((left / length) * 100);
  return (
    <Link
      className="ring"
      href={POMODORO_HREF}
      style={{ "--p": percent } as React.CSSProperties}
      aria-label={
        hero.mode === "now"
          ? `Осталось ${minutesWord(left)} из ${length}, открыть таймер`
          : `Занятие на ${minutesWord(length)}, открыть таймер`
      }
    >
      <span className="ring-arc" />
      <span className="ring-head" />
      <span className="ring-v">
        {left}
        <small>мин</small>
      </span>
    </Link>
  );
}

/**
 * Управление таймером.
 *
 * До старта он предлагает подход по длине блока: на 23 оставшиеся минуты 25/5, а
 * не 50/10, иначе «43:00» спорило бы с временем занятия на той же карточке.
 */
function FocusButtons({ hero }: { hero: Hero | null }) {
  const running = usePomodoroStore((state) => state.running);
  const phase = usePomodoroStore((state) => state.phase);
  const presetIdx = usePomodoroStore((state) => state.presetIdx);
  const started = usePomodoroStore(selectHasStarted);
  const toggle = usePomodoroStore((state) => state.toggle);
  const reset = usePomodoroStore((state) => state.reset);
  const choosePreset = usePomodoroStore((state) => state.choosePreset);

  // Пока идёт сессия, маскот не отвлекает.
  useEffect(() => {
    mascot.focus(running);
    return () => mascot.focus(false);
  }, [running]);

  if (started) {
    return (
      <>
        <button type="button" className="btn btn-text" onClick={toggle}>
          {running ? "Пауза" : "Продолжить"}
        </button>
        <button type="button" className="btn btn-text" onClick={reset}>
          Сбросить
        </button>
      </>
    );
  }

  if (!hero) return null;

  const minutesForBlock = hero.mode === "now" ? hero.minutesLeft : hero.end - hero.start;
  const suggested = pickPresetIndex(minutesForBlock, PRESETS);
  const preset = presetAt(suggested);

  const start = () => {
    // Таймер, оставленный на перерыве, начал бы перерыв, а кнопка обещает фокус.
    // Выбор ритма заодно возвращает фазу фокуса.
    if (phase !== "focus" || presetIdx !== suggested) choosePreset(suggested);
    toggle();
  };

  return (
    <button
      type="button"
      className="btn btn-text"
      onClick={start}
      aria-label={`Начать фокус на ${minutesWord(preset.focus)}`}
    >
      Фокус на {preset.focus} мин
    </button>
  );
}

/** Записанное на сервере, законченное, но не отправленное, и идущее. */
function FocusToday({ focusLogged }: { focusLogged: number | null }) {
  const liveFocus = usePomodoroStore((state) => (state.phase === "focus" ? selectElapsed(state) : 0));
  const pending = usePomodoroStore((state) => state.pending);

  if (focusLogged === null) return null;
  const today = dayKey(new Date());
  const unsent = pending
    .filter((item) => item.kind === "focus" && dayKey(new Date(item.started_at)) === today)
    .reduce((total, item) => total + item.seconds, 0);
  const minutes = Math.floor((focusLogged + unsent + liveFocus) / 60);
  if (minutes < 1) return null;
  return <span className="now-focus">{nbsp(`сегодня в фокусе ${durationLabel(minutes)}`)}</span>;
}

export type QuietKind =
  | "loading"
  | "error"
  | "denied"
  | "done"
  | "no-plans"
  | "no-schedule"
  | "free-day";

/**
 * Карточка на месте шага, когда шага нет.
 *
 * Пустой экран зовёт к действию, а не передаёт настроение: каждое состояние
 * говорит, что случилось и что сделать (тот же принцип, что у ошибок).
 */
export function QuietCard({
  kind,
  nowLabel,
  onRetry,
  done,
  next,
  busyDay,
  hasTopics,
  timeZone,
  today,
}: {
  kind: QuietKind;
  /** Который час: шага нет, но место в дне у этой карточки есть. */
  nowLabel: string;
  onRetry?: () => void;
  /** Сколько занятий было сегодня: для «на сегодня всё». */
  done?: number;
  next?: CalendarLearningBlock | null;
  /** В дне есть уроки или занятое время: тогда он не «свободный». */
  busyDay?: boolean;
  /** Есть что повторить: можно предложить повторение. */
  hasTopics?: boolean;
  timeZone: string;
  today: string;
}) {
  if (kind === "loading") {
    return (
      <div className="now glass now-quiet is-loading" aria-busy="true" aria-label="Загружаем план">
        <span />
        <div aria-hidden="true">
          <span className="now-skel is-big" />
          <span className="now-skel is-line" />
          <span className="now-skel is-btn" />
        </div>
      </div>
    );
  }

  const content = quietContent(kind, { done, next, busyDay, hasTopics, timeZone, today });
  return (
    <article
      className="now glass now-quiet"
      aria-labelledby="now-title"
      role={kind === "error" ? "alert" : undefined}
    >
      <time>{nowLabel}</time>
      <div>
        <h2 className="now-title" id="now-title" tabIndex={-1}>
          {content.title}
        </h2>
        <p className="now-crit">{content.text}</p>
        <div className="now-actions">
          {kind === "error" ? (
            <button type="button" className="btn btn-main" onClick={onRetry}>
              Повторить
            </button>
          ) : (
            <Link className={`btn ${content.primary ? "btn-main" : "btn-line"}`} href={content.href}>
              {content.action}
            </Link>
          )}
          <FocusButtons hero={null} />
        </div>
      </div>
      <FocusRing hero={null} />
    </article>
  );
}

function nextText(next: CalendarLearningBlock, timeZone: string, today: string): string {
  const day = dayPhrase(zonedDateKey(next.start_at, timeZone), today);
  const time = formatMinutes(zonedMinutes(next.start_at, timeZone));
  return `${day} в ${time}: «${splitBlockTitle(next.title).topic}»`;
}

function quietContent(
  kind: Exclude<QuietKind, "loading">,
  {
    done = 0,
    next,
    busyDay = false,
    hasTopics = false,
    timeZone,
    today,
  }: {
    done?: number;
    next?: CalendarLearningBlock | null;
    busyDay?: boolean;
    hasTopics?: boolean;
    timeZone: string;
    today: string;
  },
): { title: string; text: string; action: string; href: string; primary: boolean } {
  switch (kind) {
    case "error":
      return {
        title: "План не загрузился",
        text: "Сервер плана сейчас не ответил. Уроки и задания из дневника на месте, а план подтянется, когда сервер ответит.",
        action: "",
        href: "",
        primary: true,
      };
    case "denied":
      return {
        title: "План для этого аккаунта закрыт",
        text: "Доступ к плану и темам включает администратор. Дневник и тьютор работают.",
        action: "Открыть дневник",
        href: "/dashboard/diary",
        primary: false,
      };
    case "done":
      return {
        title: "На сегодня всё",
        text: `${done} ${plural(done, ["занятие", "занятия", "занятий"])} по плану позади.${
          next ? ` Дальше ${nextText(next, timeZone, today)}.` : ""
        }`,
        action: "Открыть план",
        href: "/dashboard/plan",
        primary: false,
      };
    case "no-plans":
      return {
        title: "Начнём с учебника",
        text: "Загрузи учебник или добавь материал. Timely разложит его по темам и дням, и здесь появится первый шаг.",
        action: "Добавить учебник",
        href: "/dashboard/curriculum",
        primary: true,
      };
    case "no-schedule":
      return {
        title: "Осталось выбрать время",
        text: "Программа есть. Скажи, в какие часы можешь заниматься, она разложится по дням, и здесь будет видно, что делать сейчас.",
        action: "Разложить по дням",
        href: "/dashboard/plan",
        primary: true,
      };
    case "free-day":
    default: {
      const parts: string[] = [];
      if (!busyDay) parts.push("Сегодня свободный день.");
      if (next) parts.push(`Следующее занятие ${nextText(next, timeZone, today)}.`);
      if (hasTopics) parts.push("Если хочется, повтори тему из списка рядом.");
      return {
        title: "Занятий по плану нет",
        text: parts.join(" ") || "Если хочется, спроси тьютора о том, что непонятно.",
        action: "Открыть план",
        href: "/dashboard/plan",
        primary: false,
      };
    }
  }
}
