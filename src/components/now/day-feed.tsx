"use client";

// Лента дня: прошлое свёрнуто в строку, линия «сейчас», шаг и всё, что после.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Pin,
  Repeat,
  School,
  Undo2,
} from "lucide-react";

import { useAskRail } from "@/contexts/ask-rail";
import {
  closedByRejecting,
  dayMonthLabel,
  dayPhrase,
  dayShortLabel,
  homeworkTitle,
  lessonGrade,
  lessonTitle,
  nbsp,
  plural,
  relativeDayLabel,
  revisionRows,
  splitBlockTitle,
  weekdayLabel,
  weekdayShortLabel,
  type DayModel,
  type HomeworkItem,
  type SchoolDay,
  type TimelineEntry,
  type UpcomingTest,
} from "@/lib/now-feed";
import {
  StudyplanApiError,
  confirmRevision,
  rejectRevision,
  undoRevision,
  type CalendarLearningBlock,
  type ScheduleRevision,
} from "@/lib/studyplan-api";
import { formatMinutes, zonedDateKey } from "@/lib/studyplan-calendar";
import { activityLabel, durationLabel } from "@/lib/studyplan-visuals";

import { invalidatePlan } from "./now-resources";
import styles from "./now.module.css";
import { SubjectTile } from "./subject-tile";

const NODE: Record<string, string> = {
  filled: styles.nodeFilled,
  bare: styles.nodeBare,
  diamond: styles.nodeDiamond,
  warn: styles.nodeWarn,
  draft: styles.nodeDraft,
  plain: "",
};

function Ev({
  time,
  until,
  node = "plain",
  nodeContent,
  past = false,
  className = "",
  label,
  children,
}: {
  time?: string;
  until?: string;
  node?: keyof typeof NODE;
  nodeContent?: React.ReactNode;
  past?: boolean;
  className?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <li className={`${styles.ev} ${past ? styles.isPast : ""} ${className}`} aria-label={label}>
      <div className={styles.evTime}>
        {time ? <b>{time}</b> : null}
        {until ? <span>{until}</span> : null}
      </div>
      <span className={`${styles.evNode} ${NODE[node]}`} aria-hidden="true">
        {nodeContent}
      </span>
      {children}
    </li>
  );
}

/** Ошибку сервера — словами ученика, а не «Failed to fetch» или «Not found.». */
function humanError(
  error: unknown,
  staleText = "Расписание уже изменилось — это предложение устарело.",
): string {
  if (error instanceof StudyplanApiError) {
    if (error.isStale) return staleText;
    if (/[а-яё]/i.test(error.message)) return error.message;
  }
  if (error instanceof TypeError) return "Нет связи с сервером — попробуй ещё раз.";
  return "Не получилось — попробуй ещё раз.";
}

// ─────────────────────────────── Прошлое ─────────────────────────────────────

function pastSummary(past: TimelineEntry[]): string {
  const parts: string[] = [];
  const school = past.find((entry) => entry.kind === "school");
  if (school?.kind === "school") {
    const lessons = school.school.lessons.length;
    let text = `школа, ${nbsp(`${lessons} ${plural(lessons, ["урок", "урока", "уроков"])}`)}`;
    if (school.school.graded) {
      const graded = school.school.graded;
      text += `, ${nbsp(`${graded} ${plural(graded, ["оценка", "оценки", "оценок"])}`)}`;
    }
    parts.push(text);
  }
  const blocks = past.filter((entry) => entry.kind === "block").length;
  if (blocks) parts.push(nbsp(`${blocks} ${plural(blocks, ["занятие", "занятия", "занятий"])}`));
  // Названия занятости — как их записал ученик: «Курсы IELTS» не становятся
  // «курсы ielts».
  for (const entry of past) {
    if (entry.kind === "busy") parts.push(entry.busy.title);
  }
  return parts.join(" · ");
}

function PastFold({
  past,
  tests,
  today,
}: {
  past: TimelineEntry[];
  tests: UpcomingTest[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  if (!past.length) return null;
  return (
    <>
      <Ev time={formatMinutes(past[0].start)} node="filled" past>
        <button
          type="button"
          className={styles.pastToggle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            Раньше сегодня: <b>{pastSummary(past)}</b>
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
      </Ev>
      {open &&
        past.map((entry) => (
          <EntryRow key={entryKey(entry)} entry={entry} tests={tests} today={today} />
        ))}
    </>
  );
}

// ──────────────────────────────── Записи ─────────────────────────────────────

function entryKey(entry: TimelineEntry): string {
  if (entry.kind === "block") return `b-${entry.block.id}`;
  if (entry.kind === "busy") return `o-${entry.busy.id}`;
  if (entry.kind === "school") return "school";
  return `f-${entry.start}`;
}

export function EntryRow({
  entry,
  tests,
  today,
}: {
  entry: TimelineEntry;
  tests: UpcomingTest[];
  today: string;
}) {
  const past = entry.kind !== "free" && entry.phase === "past";
  if (entry.kind === "free") {
    return (
      <Ev
        className={styles.evFree}
        until={formatMinutes(entry.start)}
        node="bare"
        label={`Свободно ${durationLabel(entry.minutes)}`}
      >
        <p className={styles.free}>свободно {nbsp(durationLabel(entry.minutes))}</p>
      </Ev>
    );
  }
  if (entry.kind === "school") {
    return (
      <Ev
        time={formatMinutes(entry.start)}
        until={formatMinutes(entry.end)}
        node="filled"
        past={past}
      >
        <SchoolCard school={entry.school} tests={tests} today={today} />
      </Ev>
    );
  }
  if (entry.kind === "busy") {
    return (
      <Ev time={formatMinutes(entry.start)} until={formatMinutes(entry.end)} node="filled" past={past}>
        <div className={styles.busy}>
          <b>{entry.busy.title}</b>
          <span>· занято</span>
        </div>
      </Ev>
    );
  }
  return past ? (
    <PastBlock entry={entry} />
  ) : (
    <FutureBlock block={entry.block} start={entry.start} end={entry.end} />
  );
}

function PastBlock({ entry }: { entry: Extract<TimelineEntry, { kind: "block" }> }) {
  const { block } = entry;
  const { topic } = splitBlockTitle(block.title);
  const done = block.status === "completed" || block.status === "partially_completed";
  const missed = block.status === "missed";
  const skipped = block.status === "skipped";
  return (
    <Ev
      time={formatMinutes(entry.start)}
      until={formatMinutes(entry.end)}
      node={done ? "bare" : "plain"}
      nodeContent={
        done ? (
          <span className={styles.doneMark}>
            <Check aria-hidden="true" />
          </span>
        ) : null
      }
      past
    >
      <div className={`${styles.row} ${done ? styles.rowStruck : styles.rowMuted}`}>
        <p className={styles.rowTitle}>{topic}</p>
        <p className={styles.rowMeta}>
          {block.course_plan_title} · {nbsp(durationLabel(block.duration_minutes))}
        </p>
        <p
          className={`${styles.rowState} ${done ? styles.stateDone : missed ? styles.stateMissed : ""}`}
        >
          {done ? (
            <>
              <Check aria-hidden="true" />
              {block.status === "partially_completed" ? "Частично" : "Готово"}
            </>
          ) : missed ? (
            "Пропущено"
          ) : skipped ? (
            "Пропущено намеренно"
          ) : (
            // Отметить блок выполненным пока негде (у результата нет API), и
            // «Готово» здесь было бы выдумкой. Время прошло — это всё, что известно.
            "время прошло"
          )}
        </p>
      </div>
    </Ev>
  );
}

function FutureBlock({ block, start, end }: { block: CalendarLearningBlock; start: number; end: number }) {
  const { topic } = splitBlockTitle(block.title);
  const course = block.course_plan_title?.trim() || "Занятие";
  const review = block.activity_type === "review" || block.review_step != null;
  const draft = block.schedule_status === "proposed" || block.schedule_status === "draft";
  return (
    <Ev
      time={formatMinutes(start)}
      until={formatMinutes(end)}
      node={draft ? "draft" : "plain"}
    >
      <Link
        href="/dashboard/plan"
        className={`${styles.blk} ${review ? styles.blkReview : ""} ${draft ? styles.blkDraft : ""}`}
      >
        <SubjectTile subject={course} />
        <div className={styles.blkMain}>
          <p className={styles.blkTitle}>{topic}</p>
          <p className={styles.blkMeta}>
            {course} · {activityLabel(block.activity_type).toLowerCase()} ·{" "}
            {nbsp(durationLabel(block.duration_minutes))}
          </p>
        </div>
        {draft ? (
          <span className={`${styles.tag} ${styles.tagDraft}`}>предложение</span>
        ) : block.review_step ? (
          <span className={styles.tag}>
            <Repeat aria-hidden="true" />
            {block.review_step}-е повторение
          </span>
        ) : block.fixed ? (
          <span className={styles.tag}>
            <Pin aria-hidden="true" />
            закреплено
          </span>
        ) : null}
      </Link>
    </Ev>
  );
}

function gradeClass(grade: number): string {
  if (grade >= 5) return styles.gr5;
  if (grade <= 2) return styles.gr2;
  return "";
}

function SchoolCard({
  school,
  tests,
  today,
}: {
  school: SchoolDay;
  tests: UpcomingTest[];
  today: string;
}) {
  const shown = school.lessons.filter(
    (lesson) => lessonGrade(lesson) !== null || lesson.id === school.currentId,
  );
  const rest = school.lessons.length - shown.length;
  const test = tests[0];
  const count = school.lessons.length;
  return (
    <div className={styles.school}>
      <div className={styles.schoolHead}>
        <span className={styles.schoolIco} aria-hidden="true">
          <School />
        </span>
        <p className={styles.schoolTitle}>Школа</p>
        <p className={styles.schoolMeta}>
          {nbsp(`${count} ${plural(count, ["урок", "урока", "уроков"])}`)}
          {school.graded
            ? ` · ${nbsp(`${school.graded} ${plural(school.graded, ["оценка", "оценки", "оценок"])}`)}`
            : ""}
        </p>
        {test ? (
          <p className={styles.note}>
            <Pin aria-hidden="true" />
            {capitalize(relativeDayLabel(test.dateKey, today))}: {test.title}
          </p>
        ) : null}
        <Link className={styles.link} href="/dashboard/diary">
          Дневник
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      {shown.length ? (
        <ul className={styles.lessons} aria-label="Уроки с оценками">
          {shown.map((lesson) => {
            const grade = lessonGrade(lesson);
            const current = lesson.id === school.currentId;
            return (
              <li
                key={lesson.id}
                className={`${styles.lesson} ${current ? styles.lessonNow : ""}`}
                aria-current={current ? "time" : undefined}
              >
                <SubjectTile subject={lesson.subjectName} size="sm" />
                {lessonTitle(lesson)}
                {current ? <span className={styles.lessonNowTag}>идёт</span> : null}
                {grade !== null ? (
                  <span className={`${styles.gr} ${gradeClass(grade)}`} aria-label={`оценка ${grade}`}>
                    {grade}
                  </span>
                ) : null}
              </li>
            );
          })}
          {rest > 0 ? (
            <li className={styles.lessonsMore}>
              и ещё {rest} без {plural(rest, ["оценки", "оценок", "оценок"])}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─────────────────────────── Изменения плана ─────────────────────────────────

type RevisionPhase = "idle" | "busy" | "outdated";

function RevisionCard({
  revision,
  open,
  today,
  timeZone,
  onKeep,
  onDone,
  announce,
}: {
  revision: ScheduleRevision;
  /** Предложение ещё в списке открытых. */
  open: boolean;
  today: string;
  timeZone: string;
  /** Карточка нужна, даже если предложение уйдёт из списка. */
  onKeep: (revision: ScheduleRevision) => void;
  /** Карточку можно убрать: отклонено, возвращено как было или отказ прочитан. */
  onDone: (revision: ScheduleRevision) => void;
  announce: (message: string) => void;
}) {
  const [phase, setPhase] = useState<RevisionPhase>("idle");
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const rows = revisionRows(revision, today, timeZone);
  const request = revision.request_text?.trim();
  const titleId = `rev-${revision.id}`;

  // Ответ не прошёл, а в перечитанном списке предложения уже нет — например, на
  // него ответили в другой вкладке. Отвечать больше не на что.
  const gone = phase === "idle" && !applied && !open;
  const outdated = phase === "outdated" || gone;

  // Пока помеха на месте, «Принять» всё равно упало бы, поэтому причина видна до
  // нажатия. Сервер проверяет открытые предложения при каждом чтении: уйдёт
  // помеха — карточка снова станет обычной.
  const reason = revision.blocked_reason ?? null;
  const blocked = applied || outdated ? null : reason;
  const blockedId = `${titleId}-blocked`;

  // Фокус — на кнопку, которая пришла на смену: «Принять», на которой он стоял,
  // исчезла, и иначе он упал бы в начало страницы.
  useEffect(() => {
    if (phase !== "busy" && (applied || outdated)) nextRef.current?.focus();
  }, [phase, applied, outdated]);

  // Та же причина могла прийти отказом на нажатие. Дальше за неё отвечает сервер,
  // иначе текст остался бы на экране и после того, как помеху убрали. Смотрим на
  // сам ответ сервера, а не на `blocked`: тот гаснет и у устаревшей карточки, чьё
  // объяснение стирать нельзя.
  useEffect(() => setError(null), [reason]);

  const begin = () => {
    setPhase("busy");
    setError(null);
    onKeep(revision);
  };

  // Расписание ушло вперёд, и ни одно известное предложение к нему уже не
  // применить. Иначе на миг открылось бы следующее по свежести, с живыми кнопками.
  const scheduleMoved = () => invalidatePlan((item) => item.schedule === revision.schedule);

  /** Сервер мог ответить отказом, потому что на экране уже не то, что у него. */
  const fail = (failure: unknown, staleText?: string) => {
    const stale = failure instanceof StudyplanApiError && failure.isStale;
    const closed = failure instanceof StudyplanApiError && failure.isClosed;
    setError(humanError(failure, staleText));
    setPhase(stale || closed ? "outdated" : "idle");
    if (stale) scheduleMoved();
    else invalidatePlan();
  };

  const accept = async () => {
    begin();
    try {
      await confirmRevision(revision.id);
      setApplied(true);
      setPhase("idle");
      announce("Изменение принято. Его можно вернуть.");
      scheduleMoved();
    } catch (failure) {
      fail(failure);
    }
  };

  const reject = async () => {
    begin();
    try {
      await rejectRevision(revision.id);
      announce("Предложение отклонено.");
      onDone(revision);
      invalidatePlan(closedByRejecting(revision));
    } catch (failure) {
      fail(failure);
    }
  };

  const undo = async () => {
    begin();
    try {
      await undoRevision(revision.id);
      announce("Вернули как было.");
      onDone(revision);
      scheduleMoved();
    } catch (failure) {
      fail(failure, "После этого план уже менялся — вернуть как было нельзя.");
    }
  };

  const notice = gone ? "Это предложение больше не действует." : error;

  return (
    <Ev node="bare" nodeContent={<span className={styles.nodeIcon}><Pencil /></span>}>
      <div className={styles.rev} role="group" aria-labelledby={titleId}>
        <div className={styles.revHead}>
          <span className={styles.revIco} aria-hidden="true">
            <Pencil />
          </span>
          <div>
            <p className={styles.revTitle} id={titleId}>
              {request ? `«${request}»` : "Предлагаю поменять план"}
            </p>
            <p className={styles.revSub}>
              {applied
                ? "Готово, план обновлён."
                : revision.reason?.trim() || "Тогда предлагаю так:"}
            </p>
          </div>
        </div>
        {rows.length ? (
          <ul className={styles.diff}>
            {rows.map((row) => (
              <li key={row.id}>
                <span className={styles.diffWhat}>{splitBlockTitle(row.title).topic}</span>
                <span className={styles.diffChange}>
                  {row.kind === "created" ? (
                    <>
                      <span className={styles.srOnly}>добавится: </span>
                      <b>+ {nbsp(row.to)}</b>
                    </>
                  ) : row.kind === "removed" ? (
                    <>
                      <span className={styles.srOnly}>было: </span>
                      <s>{nbsp(row.from)}</s> убрано
                    </>
                  ) : (
                    <>
                      <span className={styles.srOnly}>было: </span>
                      <s>{nbsp(row.from)}</s>
                      <ArrowRight aria-hidden="true" size={13} />
                      <span className={styles.srOnly}>, станет: </span>
                      <b>{nbsp(row.to)}</b>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {notice ? (
          <p className={styles.revError} role="alert">
            {notice}
          </p>
        ) : null}
        {blocked ? (
          <p className={styles.revBlocked} id={blockedId}>
            {blocked}
          </p>
        ) : null}
        <div className={styles.revFoot}>
          {outdated ? (
            <button
              ref={nextRef}
              type="button"
              className={`${styles.btn} ${styles.btnLight} ${styles.btnSm}`}
              onClick={() => onDone(revision)}
            >
              Понятно
            </button>
          ) : applied ? (
            <button
              ref={nextRef}
              type="button"
              className={`${styles.btn} ${styles.btnLight} ${styles.btnSm}`}
              disabled={phase === "busy"}
              onClick={() => void undo()}
            >
              <Undo2 aria-hidden="true" />
              Вернуть как было
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSoft} ${styles.btnSm}`}
                // Не `disabled`: кнопки гаснут прямо под фокусом, пока идёт ответ и
                // когда после отказа пришла причина, и фокус упал бы в начало страницы.
                aria-disabled={phase === "busy" || blocked ? true : undefined}
                aria-describedby={blocked ? blockedId : undefined}
                onClick={() => {
                  if (phase === "busy") return;
                  // Помеху могли убрать в другой вкладке, а опрос придёт только
                  // через пару минут. Отказ здесь знает сервер, а не эта копия.
                  if (blocked) invalidatePlan();
                  else void accept();
                }}
              >
                <Check aria-hidden="true" />
                Принять
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnText} ${styles.btnSm}`}
                aria-disabled={phase === "busy" ? true : undefined}
                onClick={() => {
                  if (phase !== "busy") void reject();
                }}
              >
                Отклонить
              </button>
              {blocked ? null : <small>Можно будет вернуть</small>}
            </>
          )}
        </div>
      </div>
    </Ev>
  );
}

// ────────────────────────────── Д/З и хвосты ─────────────────────────────────

function HomeworkCard({
  dateKey,
  items,
  today,
}: {
  dateKey: string;
  items: HomeworkItem[];
  today: string;
}) {
  return (
    <Ev time={weekdayShortLabel(dateKey)} until={dayShortLabel(dateKey)} node="diamond">
      <div className={styles.hw}>
        <div className={styles.hwHead}>
          <p className={styles.hwTitle}>{homeworkTitle(dateKey, today)}</p>
          <p className={styles.hwWhen}>
            {weekdayLabel(dateKey)}, {dayMonthLabel(dateKey)}
          </p>
          <Link className={styles.link} href="/dashboard/diary">
            Дневник
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
        <ul className={styles.hwList}>
          {items.map((item) => (
            <li key={item.id}>
              <SubjectTile subject={item.subject} size="sm" />
              <span className={styles.hwSubject}>{item.subject}</span>
              <span className={styles.hwText}>{item.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Ev>
  );
}

const HIDDEN_KEY = "timely.now.hiddenUnmarked";

/** Скрытые учеником «без отметки» — только в этом браузере, как и положено удобству. */
function readHidden(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Хранилище недоступно — карточка просто вернётся при следующем заходе.
  }
}

/**
 * Прошедшие без отметки занятия одного расписания.
 *
 * Сделано ли занятие, Timely пока не знает: отметить блок выполненным негде.
 * Поэтому карточка не говорит «не успели», а предлагает: не получилось —
 * перенести, получилось — скрыть.
 */
function UnmarkedCard({
  blocks,
  today,
  timeZone,
  onHide,
}: {
  blocks: CalendarLearningBlock[];
  today: string;
  timeZone: string;
  onHide: (ids: string[], title: string) => void;
}) {
  const router = useRouter();
  const { prompt } = useAskRail();
  const latest = blocks[0];
  const dateKey = zonedDateKey(latest.start_at, timeZone);
  const { topic, detail } = splitBlockTitle(latest.title);
  const more = blocks.length - 1;

  const move = () => {
    const titles = blocks.map((block) => `«${block.title}»`).join(", ");
    router.push("/dashboard/plan");
    // Помощник по расписанию предложит, куда поставить, и покажет разницу до
    // того, как что-то поменяется (CLAUDE.md §9.3). Просьба — к расписанию
    // именно этих занятий: помощник правит только выбранное.
    prompt({
      target: "schedule",
      scheduleId: latest.schedule,
      text: `Я не сделал(а) эти занятия: ${titles}. Перенеси их на ближайшие свободные окна.`,
      send: true,
    });
  };

  return (
    <Ev until={dayShortLabel(dateKey)} node="warn">
      <div className={styles.missed}>
        <p>
          <b>Прошло без отметки:</b> «{topic}
          {detail ? ` — ${detail}` : ""}»{" "}
          <span>
            · {latest.course_plan_title}, {dayPhrase(dateKey, today)}
            {more > 0
              ? ` и ещё ${nbsp(`${more} ${plural(more, ["занятие", "занятия", "занятий"])}`)}`
              : ""}
          </span>
        </p>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnLight} ${styles.btnSm}`}
          onClick={move}
        >
          Перенести
          <ArrowRight aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnText} ${styles.btnSm}`}
          onClick={() => onHide(blocks.map((block) => block.id), topic)}
          aria-label={`Скрыть «${topic}»${more > 0 ? " и остальные" : ""}: уже сделано`}
        >
          Скрыть
        </button>
      </div>
    </Ev>
  );
}

// ───────────────────────────────── Лента ─────────────────────────────────────

export function DayFeed({
  day,
  now,
  today,
  timeZone,
  hero,
  revisions,
  homework,
  missed,
  tests,
}: {
  day: DayModel | null;
  now: Date;
  today: string;
  timeZone: string;
  /** Карточка шага или заглушка на её месте. */
  hero: React.ReactNode;
  revisions: ScheduleRevision[];
  homework: { dateKey: string; items: HomeworkItem[] } | null;
  missed: CalendarLearningBlock[];
  tests: UpcomingTest[];
}) {
  const nowLabel = formatMinutes(day?.nowMinutes ?? now.getHours() * 60 + now.getMinutes());
  const before = day ? [...day.current, ...day.beforeHero] : [];

  // Карточка, на которую начали отвечать, остаётся на экране, даже когда сервер
  // уже перестал считать её предложением: принятая — ради «Вернуть как было»,
  // получившая отказ — чтобы было видно, что случилось.
  const [kept, setKept] = useState<Map<string, ScheduleRevision>>(() => new Map());
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => setHidden(readHidden()), []);

  const shown = [
    ...revisions.filter((revision) => !closed.has(revision.id)),
    ...Array.from(kept.values()).filter(
      (revision) => !closed.has(revision.id) && !revisions.some((item) => item.id === revision.id),
    ),
  ];

  // Одна карточка на расписание: просьба «перенеси» уходит помощнику одного
  // расписания, и смешивать в ней алгебру с физикой нельзя.
  const groups = new Map<string, CalendarLearningBlock[]>();
  for (const block of missed) {
    if (hidden.includes(block.id)) continue;
    const list = groups.get(block.schedule) ?? [];
    list.push(block);
    groups.set(block.schedule, list);
  }
  const unmarked = Array.from(groups.values()).slice(0, 2);

  const hide = (ids: string[], title: string) => {
    // Хранится только то, что ещё может показаться: блоки старше недели в
    // ленту и так не попадают, и место под свежие скрытые не кончается.
    const present = new Set(missed.map((block) => block.id));
    const next = Array.from(new Set([...hidden.filter((id) => present.has(id)), ...ids]));
    setHidden(next);
    writeHidden(next);
    setMessage(`Скрыто: «${title}».`);
    // Кнопка, на которой был фокус, исчезла вместе с карточкой.
    document.getElementById("now-title")?.focus();
  };

  return (
    <>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {message}
      </p>
      <ol className={styles.feed} aria-label="Лента дня">
        {day ? <PastFold past={day.past} tests={tests} today={today} /> : null}

        <li className={`${styles.ev} ${styles.evNow}`} aria-label={`Сейчас ${nowLabel}`}>
          <span className={styles.nowPill}>
            <time>{nowLabel}</time>
          </span>
          <span className={styles.nowNode} aria-hidden="true" />
          <span className={styles.nowRule} aria-hidden="true">
            <span className={styles.nowWord}>сейчас</span>
          </span>
        </li>

        {before.map((entry) => (
          <EntryRow key={entryKey(entry)} entry={entry} tests={tests} today={today} />
        ))}

        <li
          className={`${styles.ev} ${styles.evHero} ${before.length ? styles.heroSpacious : ""}`}
        >
          <div className={styles.evTime}>
            {day?.hero?.mode === "next" ? (
              <>
                <b>{formatMinutes(day.hero.start)}</b>
                <span>{formatMinutes(day.hero.end)}</span>
              </>
            ) : null}
          </div>
          <span className={`${styles.evNode} ${styles.nodeBare}`} aria-hidden="true" />
          {hero}
        </li>

        {shown.map((revision) => (
          <RevisionCard
            key={revision.id}
            revision={revision}
            open={revisions.some((item) => item.id === revision.id)}
            today={today}
            timeZone={timeZone}
            announce={setMessage}
            onKeep={(item) => setKept((current) => new Map(current).set(item.id, item))}
            onDone={(item) => {
              setClosed((current) => new Set(current).add(item.id));
              // Карточка исчезла вместе с кнопкой, на которой был фокус, —
              // возвращаем его к шагу дня, а не в начало страницы.
              document.getElementById("now-title")?.focus();
            }}
          />
        ))}

        {day?.future.map((entry) => (
          <EntryRow key={entryKey(entry)} entry={entry} tests={tests} today={today} />
        ))}

        {homework ? <HomeworkCard dateKey={homework.dateKey} items={homework.items} today={today} /> : null}

        {unmarked.map((blocks) => (
          <UnmarkedCard
            key={blocks[0].schedule}
            blocks={blocks}
            today={today}
            timeZone={timeZone}
            onHide={hide}
          />
        ))}
      </ol>
    </>
  );
}
