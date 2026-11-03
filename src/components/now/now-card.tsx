"use client";

// Карточка шага — то, ради чего главная существует (CLAUDE.md §3.1): что
// делать сейчас, когда это готово, где это в учебнике и одна кнопка, с которой
// начать. Таймер фокуса живёт здесь же, пока карточка на экране.

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Pause,
  Pin,
  Play,
  Repeat,
  RotateCcw,
  Target,
} from "lucide-react";

import { Slime } from "@/components/landing/slime";
import { SlimeGlyph } from "@/components/nav/slime-glyph";
import { useAskRail } from "@/contexts/ask-rail";
import { bookLabel } from "@/lib/book-label";
import type { CoursePlan, CurriculumDocument } from "@/lib/curriculum-api";
import { formatSource } from "@/lib/curriculum-progress";
import {
  criterionText,
  dayPhrase,
  nbsp,
  partLabel,
  pickPresetIndex,
  plural,
  splitBlockTitle,
  untilLabel,
  type Hero,
} from "@/lib/now-feed";
import { PRESETS, clockOf, dayKey, presetAt } from "@/lib/pomodoro";
import type { CalendarLearningBlock } from "@/lib/studyplan-api";
import { formatMinutes, zonedDateKey, zonedMinutes } from "@/lib/studyplan-calendar";
import { activityLabel, durationLabel } from "@/lib/studyplan-visuals";
import { useFocusDock } from "@/stores/focus-dock-store";
import {
  selectElapsed,
  selectHasStarted,
  selectPlanned,
  selectRemaining,
  usePomodoroStore,
} from "@/stores/pomodoro-store";

import styles from "./now.module.css";
import { SubjectTile } from "./subject-tile";

/** Куда ведёт главная кнопка: в ту среду, где занятие и проходит. */
export function workspaceOf(block: CalendarLearningBlock, topic: string) {
  const plan = `/dashboard/curriculum/plan/${block.course_plan}`;
  switch (block.workspace_type) {
    case "smart_board":
      return { label: "Открыть доску", href: "/dashboard/whiteboard" };
    case "tutor_chat":
      return {
        label: "Начать с тьютором",
        href: `/dashboard/chat?q=${encodeURIComponent(`Давай разберём «${topic}».`)}`,
      };
    case "book_reader":
      return { label: "Открыть книгу", href: plan };
    default:
      return { label: "Открыть программу", href: plan };
  }
}

/** «§9, стр. 41–42» для темы блока — из программы курса. */
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

export function NowCard({
  hero,
  goalId,
  plan,
  documents,
  focusLogged,
}: {
  hero: Hero;
  /** Предмет программы — тьютор будет отвечать по этой книге. */
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
  const citation = citationOf(block, plan, documents);
  const action = workspaceOf(block, topic);
  const draft = block.schedule_status === "proposed" || block.schedule_status === "draft";
  const now = hero.mode === "now";

  return (
    <div className={styles.heroSlot}>
      <div className={styles.perch}>
        <Slime interactive label="Слайм Timely" />
      </div>
      <article className={styles.card} aria-labelledby="now-title">
        <div className={styles.cardTop}>
          <SubjectTile subject={course} />
          <p className={styles.eyebrow}>
            <b>{course}</b> · {activityLabel(block.activity_type)}
            {part ? ` · ${part}` : ""}
          </p>
          <p className={styles.cardTime}>
            <time>
              {formatMinutes(hero.start)}–{formatMinutes(hero.end)}
            </time>
            {now ? (
              <>
                <span className={styles.bar} aria-hidden="true">
                  <i style={{ width: `${Math.round(hero.progress * 100)}%` }} />
                </span>
                <b>ещё {nbsp(durationLabel(hero.minutesLeft))}</b>
              </>
            ) : (
              <b>{nbsp(untilLabel(hero.minutesUntil))}</b>
            )}
          </p>
        </div>

        <div className={styles.cardBody}>
          <div>
            <h2 className={styles.title} id="now-title" tabIndex={-1}>
              {topic}
            </h2>
            {block.objective ? <p className={styles.goal}>{block.objective}</p> : null}
            {criterion || citation || block.review_step || block.fixed || draft ? (
              <ul className={styles.facts}>
                {criterion ? (
                  <li>
                    <Target aria-hidden="true" />
                    <span>
                      <b>Критерий:</b> {criterion}
                    </span>
                  </li>
                ) : null}
                {citation ? (
                  <li>
                    <BookOpen aria-hidden="true" />
                    <Link
                      className={styles.cite}
                      href={`/dashboard/curriculum/plan/${block.course_plan}`}
                    >
                      {citation}
                    </Link>
                  </li>
                ) : null}
                {block.review_step ? (
                  <li>
                    <Repeat aria-hidden="true" />
                    <span>{block.review_step}-е повторение темы</span>
                  </li>
                ) : null}
                {block.fixed ? (
                  <li>
                    <Pin aria-hidden="true" />
                    <span>Закреплено — планировщик это время не двигает</span>
                  </li>
                ) : null}
                {draft ? (
                  <li>
                    <Pin aria-hidden="true" />
                    <span>Это предложение плана — его ещё можно поменять</span>
                  </li>
                ) : null}
              </ul>
            ) : null}
            <div className={styles.actions}>
              <Link className={`${styles.btn} ${styles.btnPrimary}`} href={action.href}>
                {action.label}
                <ArrowUpRight aria-hidden="true" />
              </Link>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnLight}`}
                onClick={() =>
                  prompt({
                    target: "book",
                    goalId: goalId ?? undefined,
                    text: `Помоги с темой «${topic}»: `,
                  })
                }
              >
                <SlimeGlyph className={styles.btnSlime} />
                Нужна помощь
              </button>
            </div>
          </div>

          <FocusPanel hero={hero} focusLogged={focusLogged} />
        </div>
      </article>
    </div>
  );
}

const RING_LENGTH = 2 * Math.PI * 56;

/**
 * Таймер фокуса, привязанный к блоку.
 *
 * До старта он предлагает подход по длине блока: на 23 оставшиеся минуты —
 * 25/5, а не 50/10, иначе «43:00 до перерыва» спорили бы с «ещё 23 мин» на
 * той же карточке. Запущенный — тот же общий таймер, что в шапке.
 */
function FocusPanel({ hero, focusLogged }: { hero: Hero; focusLogged: number | null }) {
  const running = usePomodoroStore((state) => state.running);
  const phase = usePomodoroStore((state) => state.phase);
  const presetIdx = usePomodoroStore((state) => state.presetIdx);
  const remaining = usePomodoroStore(selectRemaining);
  const planned = usePomodoroStore(selectPlanned);
  const started = usePomodoroStore(selectHasStarted);
  const liveFocus = usePomodoroStore((state) => (state.phase === "focus" ? selectElapsed(state) : 0));
  const pending = usePomodoroStore((state) => state.pending);
  const toggle = usePomodoroStore((state) => state.toggle);
  const reset = usePomodoroStore((state) => state.reset);
  const choosePreset = usePomodoroStore((state) => state.choosePreset);
  const setDocked = useFocusDock((state) => state.setDocked);
  const ref = useRef<HTMLDivElement>(null);

  // Пока панель видна, пилюля в шапке молчит; ушла из вида — пилюля
  // возвращается, и таймер не теряется при прокрутке.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setDocked(entry.isIntersecting),
      { rootMargin: "-56px 0px 0px 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      setDocked(false);
    };
  }, [setDocked]);

  const minutesForBlock = hero.mode === "now" ? hero.minutesLeft : hero.end - hero.start;
  const suggested = pickPresetIndex(minutesForBlock, PRESETS);
  const preset = presetAt(started ? presetIdx : suggested);
  const shown = started ? remaining : preset.focus * 60;
  const fraction = started && planned ? remaining / planned : 1;
  const sub = !started ? "один подход" : phase === "focus" ? "до перерыва" : "перерыв";

  // Записанное на сервере + законченное, но ещё не отправленное + идущее.
  const today = dayKey(new Date());
  const unsent = pending
    .filter((item) => item.kind === "focus" && dayKey(new Date(item.started_at)) === today)
    .reduce((total, item) => total + item.seconds, 0);
  const focusToday = focusLogged === null ? null : focusLogged + unsent + liveFocus;

  const start = () => {
    // Таймер, оставленный на перерыве, по «Начать» начал бы перерыв, а
    // карточка обещает фокус. Выбор ритма заодно возвращает фазу фокуса.
    if (!started && (phase !== "focus" || presetIdx !== suggested)) choosePreset(suggested);
    toggle();
  };

  return (
    <div className={styles.focus} ref={ref} role="group" aria-label="Таймер фокуса">
      <p className={styles.focusLabel}>
        <i data-on={running} aria-hidden="true" />
        {phase === "break" && started ? "Перерыв" : "Фокус"}{" "}
        <span>
          · {preset.focus}/{preset.brk}
        </span>
      </p>
      <div className={`${styles.ring} ${started ? "" : styles.ringIdle}`} aria-hidden="true">
        <svg viewBox="0 0 126 126">
          <circle className={styles.ringTrack} cx="63" cy="63" r="56" />
          <circle
            className={styles.ringValue}
            cx="63"
            cy="63"
            r="56"
            strokeDasharray={`${(fraction * RING_LENGTH).toFixed(1)} ${RING_LENGTH.toFixed(1)}`}
          />
        </svg>
        <div className={styles.ringIn}>
          <span className={styles.ringTime}>{clockOf(shown)}</span>
          <span className={styles.ringSub}>{sub}</span>
        </div>
      </div>
      <div className={styles.ringRow} aria-hidden="true">
        <span className={styles.ringTime}>{clockOf(shown)}</span>
        <span className={styles.ringSub}>{sub}</span>
      </div>
      {/* Одна копия для скринридера — у широкой и узкой раскладки свои
          видимые цифры, и спрятать из двух нужно обе. */}
      <span className={styles.srOnly} role="timer" aria-live="off">
        {clockOf(shown)}, {sub}
      </span>
      <div className={styles.focusCtrl}>
        {started ? (
          <>
            <button
              type="button"
              className={styles.round}
              onClick={toggle}
              aria-label={running ? "Пауза" : "Продолжить"}
            >
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <button type="button" className={styles.round} onClick={reset} aria-label="Сбросить">
              <RotateCcw aria-hidden="true" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`${styles.round} ${styles.roundStart}`}
            onClick={start}
            aria-label={`Начать фокус на ${preset.focus} минут`}
          >
            <Play aria-hidden="true" />
            Начать
          </button>
        )}
      </div>
      {focusToday !== null ? (
        <p className={styles.focusDay}>
          <span>Сегодня в фокусе</span>
          <b>{nbsp(durationLabel(Math.floor(focusToday / 60)))}</b>
        </p>
      ) : null}
    </div>
  );
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
 * Пустой экран — приглашение к действию, а не настроение: каждое состояние
 * говорит, что случилось и что сделать (тот же принцип, что у ошибок).
 */
export function QuietCard({
  kind,
  onRetry,
  done,
  next,
  busyDay,
  hasTopics,
  timeZone,
  today,
}: {
  kind: QuietKind;
  onRetry?: () => void;
  /** Сколько занятий было сегодня — для «на сегодня всё». */
  done?: number;
  next?: CalendarLearningBlock | null;
  /** В дне есть уроки или занятое время — тогда он не «свободный». */
  busyDay?: boolean;
  /** Есть что повторить — можно предложить «Что подтянуть». */
  hasTopics?: boolean;
  timeZone: string;
  today: string;
}) {
  if (kind === "loading") {
    return (
      <div className={styles.heroSlot}>
        <div className={`${styles.card} ${styles.cardQuiet}`} aria-busy="true" aria-label="Загружаем план">
          <span className={styles.skel} style={{ width: "42%", height: 16 }} />
          <span className={styles.skel} style={{ width: "72%", height: 34, marginTop: 22 }} />
          <span className={styles.skel} style={{ width: "54%", height: 16, marginTop: 14 }} />
          <span className={styles.skel} style={{ width: 168, height: 44, marginTop: 26, borderRadius: 999 }} />
        </div>
      </div>
    );
  }

  const content = quietContent(kind, { done, next, busyDay, hasTopics, timeZone, today });
  return (
    <div className={styles.heroSlot}>
      {kind !== "error" ? (
        <div className={styles.perch}>
          <Slime interactive label="Слайм Timely" />
        </div>
      ) : null}
      <article
        className={`${styles.card} ${styles.cardQuiet}`}
        aria-labelledby="now-title"
        role={kind === "error" ? "alert" : undefined}
      >
        <h2 className={styles.title} id="now-title" tabIndex={-1}>
          {content.title}
        </h2>
        <p className={styles.quietText}>{content.text}</p>
        <div className={styles.actions}>
          {kind === "error" ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onRetry}
            >
              Повторить
            </button>
          ) : (
            <Link
              className={`${styles.btn} ${content.primary ? styles.btnPrimary : styles.btnLight}`}
              href={content.href}
            >
              {content.action}
              {content.primary ? <ArrowUpRight aria-hidden="true" /> : null}
            </Link>
          )}
        </div>
      </article>
    </div>
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
        text: "Сервер плана сейчас не ответил. Уроки и домашнее задание из дневника — ниже, а план подтянется, когда сервер ответит.",
        action: "",
        href: "",
        primary: true,
      };
    case "denied":
      return {
        title: "План для этого аккаунта закрыт",
        text: "Доступ к плану, темам и курсам включает администратор. Дневник и тьютор работают.",
        action: "Открыть дневник",
        href: "/dashboard/diary",
        primary: false,
      };
    case "done":
      return {
        title: "На сегодня всё",
        text: `${done} ${plural(done, ["занятие", "занятия", "занятий"])} по плану позади.${
          next ? ` Дальше — ${nextText(next, timeZone, today)}.` : ""
        }`,
        action: "План недели",
        href: "/dashboard/plan",
        primary: false,
      };
    case "no-plans":
      return {
        title: "Начнём с учебника",
        text: "Загрузи учебник или добавь материал — Timely разложит его по темам и дням, и здесь появится первый шаг.",
        action: "Добавить учебник",
        href: "/dashboard/curriculum",
        primary: true,
      };
    case "no-schedule":
      return {
        title: "Программа есть — осталось выбрать время",
        text: "Скажи, в какие часы можешь заниматься, — программа разложится по дням, и здесь будет видно, что делать сейчас.",
        action: "Разложить по дням",
        href: "/dashboard/plan",
        primary: true,
      };
    case "free-day":
    default: {
      const parts: string[] = [];
      if (!busyDay) parts.push("Свободный день.");
      if (next) parts.push(`Следующее занятие — ${nextText(next, timeZone, today)}.`);
      if (hasTopics) parts.push("Если хочется, повтори тему из «Что подтянуть».");
      return {
        title: "Занятий по плану сегодня нет",
        text: parts.join(" ") || "Если хочется, спроси тьютора о том, что непонятно.",
        action: "План недели",
        href: "/dashboard/plan",
        primary: false,
      };
    }
  }
}
