"use client";

// Лента дня шагами: от начала дня до того, что идёт сейчас, и всё, что после.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { useAskRail } from "@/contexts/ask-rail";
import { msg, t } from "@/lib/i18n";
import {
  attachLabel,
  closedByRejecting,
  dayMonthLabel,
  lessonGrade,
  lessonTitle,
  nbsp,
  parseClock,
  plural,
  revisionRows,
  splitBlockTitle,
  type DayModel,
  type SchoolDay,
  type TimelineEntry,
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
import { durationLabel } from "@/lib/studyplan-visuals";
import type { DiaryLesson } from "@/types/diary";

import { invalidatePlan } from "./now-resources";

/**
 * Тексты отказов, которые сервер пишет по-русски с названиями занятий внутри
 * (`backend/studyplan/revisions.py`): точным ключом их не найти, поэтому узнаём по шаблону.
 */
const BACKEND_PATTERNS: Array<[RegExp, string]> = [
  [/^Блок «(.+)» закреплён и не переносится\.$/, msg("Блок «{a}» закреплён и не переносится.")], // i18n-skip
  [/^Блок «(.+)» отменён — перенос ничего не изменит\.$/, msg("Блок «{a}» отменён — перенос ничего не изменит.")], // i18n-skip
  [/^Блок «(.+)» уже в работе или завершён — перенос ничего не изменит\.$/, msg("Блок «{a}» уже в работе или завершён — перенос ничего не изменит.")], // i18n-skip
  [/^Блок «(.+)» нельзя ставить так рано\.$/, msg("Блок «{a}» нельзя ставить так рано.")], // i18n-skip
  [/^Блок «(.+)» нельзя ставить так поздно\.$/, msg("Блок «{a}» нельзя ставить так поздно.")], // i18n-skip
  [/^Блок «(.+)» нельзя ставить на этот день недели\.$/, msg("Блок «{a}» нельзя ставить на этот день недели.")], // i18n-skip
  [/^Занятие короче (\d+) минут не имеет смысла\.$/, msg("Занятие короче {a} минут не имеет смысла.")], // i18n-skip
  [/^«(.+)» и «(.+)» пересеклись бы по времени\.$/, msg("«{a}» и «{b}» пересеклись бы по времени.")], // i18n-skip
  [/^«(.+)» пересёкся бы с «(.+)» из другого курса\.$/, msg("«{a}» пересёкся бы с «{b}» из другого курса.")], // i18n-skip
];

/** Русский текст, пришедший с сервера, на языке интерфейса. Незнакомый остаётся как есть. */
function backendText(message: string): string {
  for (const [pattern, key] of BACKEND_PATTERNS) {
    const match = pattern.exec(message);
    if (match) return t(key, { a: match[1], b: match[2] ?? "" });
  }
  return t(message);
}

/** Ошибку сервера словами ученика, а не «Failed to fetch» или «Not found.». */
function humanError(
  error: unknown,
  staleText = t("Расписание уже изменилось, это предложение устарело."),
): string {
  if (error instanceof StudyplanApiError) {
    if (error.isStale) return staleText;
    if (/[а-яё]/i.test(error.message)) return backendText(error.message); // i18n-skip
  }
  if (error instanceof TypeError) return t("Нет связи с сервером, попробуй ещё раз.");
  return t("Не получилось, попробуй ещё раз.");
}

// ──────────────────────────────── Записи ─────────────────────────────────────

function entryKey(entry: TimelineEntry): string {
  if (entry.kind === "block") return `b-${entry.block.id}`;
  if (entry.kind === "busy") return `o-${entry.busy.id}`;
  if (entry.kind === "school") return "school";
  return `f-${entry.start}`;
}

function stepClass(entry: TimelineEntry): string {
  if (entry.kind === "free") return "is-free";
  if (entry.phase === "past") return "is-done";
  return entry.phase === "current" ? "is-live" : "";
}

function EntryStep({
  entry,
  dateKey,
  nowMinutes,
  toNow = false,
}: {
  entry: TimelineEntry;
  dateKey: string;
  nowMinutes: number;
  /** Линия от этого шага тянется к карточке шага, а она ниже обычной строки. */
  toNow?: boolean;
}) {
  return (
    <li className={`step ${stepClass(entry)}${toNow ? " to-now" : ""}`}>
      {entry.kind === "school" ? (
        <SchoolRow entry={entry} dateKey={dateKey} nowMinutes={nowMinutes} />
      ) : entry.kind === "block" ? (
        <BlockRow entry={entry} dateKey={dateKey} />
      ) : entry.kind === "busy" ? (
        <div className="row">
          <time>{formatMinutes(entry.start)}</time>
          <span className="t">
            {entry.busy.title}
            {entry.phase === "current" ? <small>{t("идёт")}</small> : null}
          </span>
          <span className="s">{t("занято")}</span>
          <span className="d">{formatMinutes(entry.end)}</span>
        </div>
      ) : (
        <div className="row row-free">
          <time>{formatMinutes(entry.start)}</time>
          <span className="t">{t("свободно {time}", { time: nbsp(durationLabel(entry.minutes)) })}</span>
        </div>
      )}
    </li>
  );
}

/**
 * Что известно о занятии сверх названия.
 *
 * Отметить блок выполненным пока негде (у результата нет API), поэтому для
 * прошедшего без отметки подписи нет: «готово» было бы выдумкой, а то, что время
 * прошло, видно по самой строке.
 */
function BlockNote({ entry }: { entry: Extract<TimelineEntry, { kind: "block" }> }) {
  const { block } = entry;
  if (block.status === "completed") {
    return (
      <>
        <Icon name="check" />
        <span className="sr-only"> {t("готово")}</span>
      </>
    );
  }
  if (block.status === "partially_completed") return <small>{t("частично")}</small>;
  if (block.status === "missed") return <small>{t("пропущено")}</small>;
  if (block.status === "skipped") return <small>{t("пропущено намеренно")}</small>;
  if (block.schedule_status === "proposed" || block.schedule_status === "draft") {
    return <small>{t("предложение")}</small>;
  }
  if (block.review_step) return <small>{t("{n}-е повторение", { n: block.review_step })}</small>;
  if (block.fixed) return <small>{t("закреплено")}</small>;
  return null;
}

function BlockRow({
  entry,
  dateKey,
}: {
  entry: Extract<TimelineEntry, { kind: "block" }>;
  dateKey: string;
}) {
  const { block } = entry;
  const { topic, detail } = splitBlockTitle(block.title);
  return (
    <Link className="row" href="/dashboard/plan" data-attach={attachLabel(topic, dateKey, entry.start)}>
      <time>{formatMinutes(entry.start)}</time>
      <span className="t">
        {detail ? `${topic}: ${detail}` : topic}
        <BlockNote entry={entry} />
      </span>
      <span className="s">{block.course_plan_title?.trim() || t("Занятие")}</span>
      <span className="d">{durationLabel(block.duration_minutes)}</span>
    </Link>
  );
}

function SchoolRow({
  entry,
  dateKey,
  nowMinutes,
}: {
  entry: Extract<TimelineEntry, { kind: "school" }>;
  dateKey: string;
  nowMinutes: number;
}) {
  const { school } = entry;
  const count = school.lessons.length;
  const current = school.lessons.find((lesson) => lesson.id === school.currentId);
  return (
    <details>
      <summary className="row">
        <time>{formatMinutes(entry.start)}</time>
        <span className="t">
          {t("Школа")}
          {current ? <small>{t("сейчас {title}", { title: lessonTitle(current) })}</small> : null}
        </span>
        <span className="s">
          {count} {plural(count, ["урок", "урока", "уроков"])}
        </span>
        <span className="d">{formatMinutes(entry.end)}</span>
      </summary>
      <ul className="school-list" aria-label={t("Уроки")}>
        {school.lessons.map((lesson) => (
          <SchoolLesson
            key={lesson.id}
            lesson={lesson}
            school={school}
            dateKey={dateKey}
            nowMinutes={nowMinutes}
          />
        ))}
        <li className="school-foot">
          <Link className="link" href="/dashboard/plan">
            {t("Открыть неделю")}
          </Link>
        </li>
      </ul>
    </details>
  );
}

function SchoolLesson({
  lesson,
  school,
  dateKey,
  nowMinutes,
}: {
  lesson: DiaryLesson;
  school: SchoolDay;
  dateKey: string;
  nowMinutes: number;
}) {
  const title = lessonTitle(lesson);
  const grade = lessonGrade(lesson);
  const start = parseClock(lesson.startTime);
  const past = (parseClock(lesson.endTime) ?? 0) <= nowMinutes;
  return (
    <li
      aria-current={lesson.id === school.currentId ? "time" : undefined}
      data-attach={attachLabel(title, dateKey, start ?? 0)}
    >
      {title}
      {grade !== null ? (
        <span className={`g g${Math.max(grade, 3)}`}>
          <span className="sr-only">{t("оценка")} </span>
          {grade}
        </span>
      ) : lesson.id === school.currentId ? (
        <span className="none is-now">{t("идёт")}</span>
      ) : past ? (
        <span className="none">{t("без оценки")}</span>
      ) : (
        <span className="none">{lesson.startTime}</span>
      )}
    </li>
  );
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

  // Ответ не прошёл, а в перечитанном списке предложения уже нет: например, на
  // него ответили в другой вкладке. Отвечать больше не на что.
  const gone = phase === "idle" && !applied && !open;
  const outdated = phase === "outdated" || gone;

  // Пока помеха на месте, «Применить» всё равно упало бы, поэтому причина видна до
  // нажатия. Сервер проверяет открытые предложения при каждом чтении: уйдёт
  // помеха, и карточка снова станет обычной.
  const reason = revision.blocked_reason ?? null;
  const blocked = applied || outdated ? null : reason;
  const blockedId = `${titleId}-blocked`;

  // Фокус на кнопку, которая пришла на смену: «Применить», на которой он стоял,
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
      announce(t("Изменение принято. Его можно вернуть."));
      mascot.hop(1);
      scheduleMoved();
    } catch (failure) {
      fail(failure);
    }
  };

  const reject = async () => {
    begin();
    try {
      await rejectRevision(revision.id);
      announce(t("Предложение отклонено."));
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
      announce(t("Вернули как было."));
      onDone(revision);
      scheduleMoved();
    } catch (failure) {
      fail(failure, t("После этого план уже менялся, вернуть как было нельзя."));
    }
  };

  const notice = gone ? t("Это предложение больше не действует.") : error;
  const subline = applied
    ? t("Готово, план обновлён.")
    : revision.reason?.trim() || (request ? t("Тогда предлагаю так:") : "");

  return (
    <li className="step is-rev">
      <div className="rev card quiet" role="group" aria-labelledby={titleId}>
        <span className="rev-mark" aria-hidden="true">
          <Icon name="pencil" />
        </span>
        <div>
          <p className="rev-title" id={titleId}>
            {request ? t("«{request}»", { request }) : t("Предлагаю поменять план")}
          </p>
          {subline ? <p className="rev-sub">{subline}</p> : null}
          {rows.length ? (
            <ul className="q-diff">
              {rows.map((row) => (
                <li key={row.id}>
                  <span className="nm">{splitBlockTitle(row.title).topic}</span>
                  <span className="chg">
                    {row.kind === "created" ? (
                      <>
                        <span className="sr-only">{t("добавится:")} </span>
                        <b>{nbsp(row.to)}</b>
                      </>
                    ) : row.kind === "removed" ? (
                      <>
                        <span className="sr-only">{t("было:")} </span>
                        {nbsp(row.from)}, <b>{t("уберём")}</b>
                      </>
                    ) : (
                      <>
                        <span className="sr-only">{t("было:")} </span>
                        {nbsp(row.from)}
                        <span aria-hidden="true"> → </span>
                        <span className="sr-only">{t(", станет:")} </span>
                        <b>{nbsp(row.to)}</b>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {notice ? (
            <p className="rev-notice" role="alert">
              {notice}
            </p>
          ) : null}
          {blocked ? (
            <p className="rev-blocked" id={blockedId}>
              {backendText(blocked)}
            </p>
          ) : null}
          <div className="q-acts">
            {outdated ? (
              <button
                ref={nextRef}
                type="button"
                className="btn btn-line"
                onClick={() => onDone(revision)}
              >
                {t("Понятно")}
              </button>
            ) : applied ? (
              <button
                ref={nextRef}
                type="button"
                className="btn btn-line"
                disabled={phase === "busy"}
                onClick={() => void undo()}
              >
                {t("Вернуть как было")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-main"
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
                  {t("Применить")}
                </button>
                <button
                  type="button"
                  className="btn btn-text"
                  aria-disabled={phase === "busy" ? true : undefined}
                  onClick={() => {
                    if (phase !== "busy") void reject();
                  }}
                >
                  {t("Не надо")}
                </button>
                {blocked ? null : <small>{t("Можно будет вернуть")}</small>}
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ───────────────────────────── Без отметки ───────────────────────────────────

const HIDDEN_KEY = "timely.now.hiddenUnmarked";

/** Скрытые учеником «без отметки»: только в этом браузере, как и положено удобству. */
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
    // Хранилище недоступно: строка просто вернётся при следующем заходе.
  }
}

/**
 * Прошедшие без отметки занятия одного расписания.
 *
 * Сделано ли занятие, Timely пока не знает: отметить блок выполненным негде.
 * Поэтому строка не говорит «не успели», а предлагает: не получилось, значит
 * перенести, получилось, значит скрыть.
 */
function UnmarkedLine({
  blocks,
  timeZone,
  onHide,
}: {
  blocks: CalendarLearningBlock[];
  timeZone: string;
  onHide: (ids: string[], title: string) => void;
}) {
  const router = useRouter();
  const { prompt } = useAskRail();
  const latest = blocks[0];
  const dateKey = zonedDateKey(latest.start_at, timeZone);
  const { topic } = splitBlockTitle(latest.title);
  const more = blocks.length - 1;

  const move = () => {
    const titles = blocks.map((block) => `«${block.title}»`).join(", ");
    router.push("/dashboard/plan");
    // Помощник по расписанию предложит, куда поставить, и покажет разницу до
    // того, как что-то поменяется (CLAUDE.md §9.3). Просьба к расписанию именно
    // этих занятий: помощник правит только выбранное.
    prompt({
      target: "schedule",
      scheduleId: latest.schedule,
      text: t("Я не сделал(а) эти занятия: {titles}. Перенеси их на ближайшие свободные окна.", { titles }),
      send: true,
    });
  };

  return (
    <div className="late-line" data-attach={`${topic}, ${dayMonthLabel(dateKey)}`}>
      <p>
        {t("Без отметки: {topic}, {date}", { topic, date: nbsp(dayMonthLabel(dateKey)) })}
        {more > 0
          ? ` ${t("и ещё {count}", {
              count: nbsp(`${more} ${plural(more, ["занятие", "занятия", "занятий"])}`),
            })}`
          : ""}
      </p>
      <span className="late-acts">
        <button type="button" className="btn btn-text" onClick={move}>
          {t("Перенести")}
        </button>
        <button
          type="button"
          className="btn btn-text"
          onClick={() => onHide(blocks.map((block) => block.id), topic)}
          aria-label={
            more > 0
              ? t("Скрыть «{topic}» и остальные: уже сделано", { topic })
              : t("Скрыть «{topic}»: уже сделано", { topic })
          }
        >
          {t("Скрыть")}
        </button>
      </span>
    </div>
  );
}

// ───────────────────────────────── Лента ─────────────────────────────────────

export function DayFeed({
  day,
  today,
  timeZone,
  hero,
  revisions,
  missed,
}: {
  day: DayModel | null;
  today: string;
  timeZone: string;
  /** Карточка шага или заглушка на её месте. */
  hero: React.ReactNode;
  revisions: ScheduleRevision[];
  missed: CalendarLearningBlock[];
}) {
  const before = day ? [...day.past, ...day.current, ...day.beforeHero] : [];
  const nowMinutes = day?.nowMinutes ?? 0;

  // Карточка, на которую начали отвечать, остаётся на экране, даже когда сервер
  // уже перестал считать её предложением: принятая ради «Вернуть как было»,
  // получившая отказ, чтобы было видно, что случилось.
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

  // Одна строка на расписание: просьба «перенеси» уходит помощнику одного
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
    // Хранится только то, что ещё может показаться: блоки старше недели в ленту
    // и так не попадают, и место под свежие скрытые не кончается.
    const present = new Set(missed.map((block) => block.id));
    const next = Array.from(new Set([...hidden.filter((id) => present.has(id)), ...ids]));
    setHidden(next);
    writeHidden(next);
    setMessage(t("Скрыто: «{title}».", { title }));
    // Кнопка, на которой был фокус, исчезла вместе со строкой.
    document.getElementById("now-title")?.focus();
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <ol className="day" aria-label={t("Расписание на день")}>
        {before.map((entry, index) => (
          <EntryStep
            key={entryKey(entry)}
            entry={entry}
            dateKey={today}
            nowMinutes={nowMinutes}
            toNow={index === before.length - 1}
          />
        ))}

        <li className="step is-now">{hero}</li>

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
              // Карточка исчезла вместе с кнопкой, на которой был фокус:
              // возвращаем его к шагу дня, а не в начало страницы.
              document.getElementById("now-title")?.focus();
            }}
          />
        ))}

        {day?.future.map((entry) => (
          <EntryStep key={entryKey(entry)} entry={entry} dateKey={today} nowMinutes={nowMinutes} />
        ))}
      </ol>

      {unmarked.map((blocks) => (
        <UnmarkedLine key={blocks[0].schedule} blocks={blocks} timeZone={timeZone} onHide={hide} />
      ))}
    </>
  );
}
