"use client";

// История занятий помодоро: список дней и разбор одного дня.
//
// Рассчитано на то, чтобы понять с первого взгляда: даты словами («Вчера»), время полными
// словами («2 часа 40 минут»), одна лента дня вместо графиков и крупные строки, по которым
// легко попасть пальцем.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/shell/icons";
import {
  blocksWord,
  buildDayDetail,
  buildHistoryDays,
  dayTitle,
  daysBack,
  durationWords,
  ribbonSpan,
  totalsByName,
  type DayDetail,
  type NameTotal,
} from "@/lib/focus-history";
import { fetchSessions } from "@/lib/pomodoro-api";
import { readSessionNames, sessionNameOf } from "@/lib/pomodoro-names";
import { useResource } from "@/lib/resource-cache";

import { useFocusUser } from "./use-focus-user";

const LIST_DAYS = 400;
const PAGE = 30;
/** Сколько названий видно сразу; остальные — по кнопке. */
const NAMES_SHOWN = 6;
const HISTORY_URL = "/dashboard/pomodoro/history";

export const dayUrl = (key: string) => `${HISTORY_URL}/${key}`;

/** `null` — подождать: окно дня считается от сегодняшней даты, а она есть только в браузере. */
function useSessions(days: number | null) {
  const email = useFocusUser();
  return useResource(email && days ? `pomodoro:history:${email}:${days}` : null, () => fetchSessions(days ?? 1), {
    ttl: 60_000,
  });
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card fp-error" role="alert">
      <p>История не загрузилась. Проверь интернет и попробуй ещё раз.</p>
      <button className="btn btn-line" type="button" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function FocusHistoryPage() {
  const sessions = useSessions(LIST_DAYS);
  const days = useMemo(() => buildHistoryDays(sessions.data ?? []), [sessions.data]);
  const [shown, setShown] = useState(PAGE);
  const [today, setToday] = useState<Date | null>(null);
  // Названия сессий живут в этом браузере, поэтому читаются после монтирования.
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    setToday(new Date());
    setNames(readSessionNames());
  }, []);
  const totals = useMemo(() => totalsByName(sessions.data ?? [], names), [sessions.data, names]);

  return (
    <div className="content view fh">
      <Link className="fh-back" href="/dashboard/pomodoro">
        <Icon name="chev-l" />
        Таймер
      </Link>
      <header className="head">
        <h1 className="title">История занятий</h1>
      </header>

      {sessions.error && !sessions.data ? (
        <LoadFailed onRetry={sessions.reload} />
      ) : !sessions.data || !today ? (
        <p className="small-note">Загружаю…</p>
      ) : !days.length ? (
        <div className="fh-empty">
          <p>Здесь будет каждый день с занятиями по таймеру.</p>
          <Link className="btn btn-main" href="/dashboard/pomodoro">
            Открыть таймер
          </Link>
        </div>
      ) : (
        <>
          <NameTotals totals={totals} />
          <h2 className="fh-h2">По дням</h2>
          <ul className="fh-days card">
            {days.slice(0, shown).map((day) => (
              <li key={day.key}>
                <Link className="fh-day" href={dayUrl(day.key)}>
                  <span className="fh-day-name">{dayTitle(day.key, today)}</span>
                  <span className="fh-day-total">{durationWords(day.focusSeconds)}</span>
                  <span className="fh-day-sub">
                    {blocksWord(day.blocks)}
                    {day.restSeconds ? `, отдых ${durationWords(day.restSeconds)}` : ""}
                  </span>
                  <Icon name="chev-r" className="fh-go" />
                </Link>
              </li>
            ))}
          </ul>
          {days.length > shown ? (
            <button className="btn btn-line fh-more" type="button" onClick={() => setShown((count) => count + PAGE)}>
              Показать ещё
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Сколько времени ушло на каждое название сессии. Одинаковые названия складываются в одну
 * строку; полоска — доля от самого долгого занятия. Без названий показывает подсказку.
 */
function NameTotals({ totals }: { totals: NameTotal[] }) {
  const [all, setAll] = useState(false);
  const named = totals.some((total) => total.key);
  const max = Math.max(1, ...totals.map((total) => total.seconds));
  const list = all ? totals : totals.slice(0, NAMES_SHOWN);
  return (
    <section className="fh-names-wrap" aria-label="На что ушло время">
      <h2 className="fh-h2">На что ушло время</h2>
      {named ? (
        <>
          <ul className="fh-names card">
            {list.map((total) => (
              <li key={total.key} className="fh-name" data-unnamed={total.key ? undefined : ""}>
                <span className="fh-name-t">{total.name || "Без названия"}</span>
                <span className="fh-name-v">{durationWords(total.seconds)}</span>
                <span className="tube" aria-hidden="true">
                  <i style={{ width: `${(total.seconds / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
          {totals.length > NAMES_SHOWN ? (
            <button className="btn btn-line fh-more" type="button" onClick={() => setAll((value) => !value)}>
              {all ? "Свернуть" : `Все названия (${totals.length})`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="fh-names-hint">
          Назови занятие на таймере, например «Физика». Здесь появится, сколько времени ушло на
          каждое, а одинаковые названия сложатся вместе.
        </p>
      )}
    </section>
  );
}

export function FocusDayPage({ dayKey }: { dayKey: string }) {
  const [today, setToday] = useState<Date | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    setToday(new Date());
    setNames(readSessionNames());
  }, []);

  const windowDays = today ? daysBack(dayKey, today) : null;
  const sessions = useSessions(windowDays);
  const day = useMemo(
    () => (sessions.data ? buildDayDetail(sessions.data, dayKey) : null),
    [sessions.data, dayKey],
  );

  return (
    <div className="content view fh">
      <Link className="fh-back" href={HISTORY_URL}>
        <Icon name="chev-l" />
        История занятий
      </Link>
      <header className="head">
        <h1 className="title">{today ? dayTitle(dayKey, today) : " "}</h1>
      </header>

      {sessions.error && !sessions.data ? (
        <LoadFailed onRetry={sessions.reload} />
      ) : !sessions.data || !today ? (
        <p className="small-note">Загружаю…</p>
      ) : !day ? (
        <div className="fh-empty">
          <p>В этот день занятий с таймером не было.</p>
          <Link className="btn btn-line" href={HISTORY_URL}>
            Все дни
          </Link>
        </div>
      ) : (
        <DayView day={day} names={names} />
      )}
    </div>
  );
}

function DayView({ day, names }: { day: DayDetail; names: Record<string, string> }) {
  const first = day.parts[0];
  const last = day.parts[day.parts.length - 1];
  const summary = `Учёба ${durationWords(day.focusSeconds)}, отдых ${durationWords(day.restSeconds)}, с ${first.start} до ${last.end}`;

  return (
    <>
      <section className="fh-sum" aria-label="Итог дня">
        <div className="fh-fig">
          <span className="fh-fig-label">Учёба</span>
          <span className="fh-fig-value">{durationWords(day.focusSeconds)}</span>
        </div>
        <div className="fh-fig">
          <span className="fh-fig-label">Отдых</span>
          <span className="fh-fig-value">{day.restSeconds ? durationWords(day.restSeconds) : "без отдыха"}</span>
        </div>
        <div className="fh-fig">
          <span className="fh-fig-label">Блоков учёбы</span>
          <span className="fh-fig-value">{day.blocks}</span>
        </div>
      </section>

      {/* Лента дня: с первой минуты до последней, учёба тёмная, отдых светлый, пустое — перерывы без таймера */}
      <figure className="fh-ribbon-wrap">
        <div className="fh-ribbon" role="img" aria-label={summary}>
          {day.parts.map((part) => {
            const { left, width } = ribbonSpan(part, day.from, day.to);
            return (
              <i
                key={part.id}
                data-kind={part.kind}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${part.kind === "focus" ? `Блок ${part.number}` : "Отдых"}: ${part.start}–${part.end}`}
              />
            );
          })}
        </div>
        <figcaption>
          <span>{first.start}</span>
          <span className="fh-legend">
            <span><i data-kind="focus" />учёба</span>
            <span><i data-kind="rest" />отдых</span>
          </span>
          <span>{last.end}</span>
        </figcaption>
      </figure>

      <h2 className="fh-h2">Как прошёл день</h2>
      <ol className="fh-parts card">
        {day.parts.map((part) =>
          part.kind === "focus" ? (
            <li key={part.id} className="fh-block">
              <span className="fh-num">Блок {part.number}</span>
              <span className="fh-what">
                {sessionNameOf(names, part.startedAt) || "Учёба"}
                {part.stoppedEarly ? <small>Остановлен раньше времени</small> : null}
              </span>
              <span className="fh-when">
                {part.start}–{part.end}
              </span>
              <span className="fh-len">{durationWords(part.seconds)}</span>
            </li>
          ) : (
            <li key={part.id} className="fh-rest">
              <span>{part.long ? "Длинный отдых" : "Отдых"}</span>
              <span className="fh-len">{durationWords(part.seconds)}</span>
            </li>
          ),
        )}
      </ol>
    </>
  );
}
