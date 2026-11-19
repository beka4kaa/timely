"use client";

// Вкладки «Таблица» и «Все решения». Пока контест идёт, обе обновляются сами раз в
// 15 секунд. Ответов чужих людей здесь нет: только место, баллы и вердикты.

import { useState } from "react";

import { initialsOf } from "@/components/shell/sidebar";
import { t } from "@/lib/i18n";
import { getAttempts, getStandings, type Contest, type StandingRow } from "@/lib/contest-api";
import { attemptClock } from "@/lib/contest-view";
import { useResource } from "@/lib/resource-cache";

import { attemptsKey, standingsKey } from "./contest-shell";

const HIDDEN = "Участник"; // i18n-skip: имя скрытого участника приходит с сервера

function Avatar({ name, me }: { name: string; me: boolean }) {
  return <span className="av">{me ? t("Я") : name === HIDDEN ? "?" : initialsOf(name)}</span>;
}

function displayName(name: string): string {
  return name === HIDDEN ? t("Участник") : name;
}

function Marks({ marks }: { marks: StandingRow["marks"] }) {
  const solved = marks.filter((mark) => mark === "solved").length;
  return (
    <small className="cx-marks" role="img" aria-label={t("Решено {solved} из {total}", { solved, total: marks.length })}>
      {marks.map((mark, index) => (
        <i key={index} className={mark === "solved" ? "on" : mark === "tried" ? "try" : undefined} />
      ))}
    </small>
  );
}

function Waiting({ title }: { title: string }) {
  return (
    <section className="ct-note card">
      <h2>{title}</h2>
      <p>{t("До старта здесь пусто.")}</p>
    </section>
  );
}

export function ContestStandings({ contest }: { contest: Contest }) {
  const running = contest.state === "running";
  const table = useResource(
    contest.state === "upcoming" ? null : standingsKey(contest.id),
    () => getStandings(contest.id),
    { ttl: running ? 15_000 : 300_000 },
  );
  if (contest.state === "upcoming") return <Waiting title={t("Таблица появится в начале контеста")} />;
  const rows = table.data;
  return (
    <section className="card cx-table" aria-label={t("Таблица контеста")}>
      {!rows && table.error ? (
        <p className="small-note" role="alert">
          {t("Таблица не загрузилась.")}{" "}
          <button className="link" type="button" onClick={table.reload}>
            {t("Повторить")}
          </button>
        </p>
      ) : !rows ? (
        <p className="small-note" role="status">
          {t("Загружаю таблицу…")}
        </p>
      ) : !rows.length ? (
        <p className="small-note">{t("Пока никто не отвечал.")}</p>
      ) : (
        <ol>
          {rows.map((row, index) => (
            <li key={`${row.place}-${index}`} className={`lr cx-row${row.me ? " is-me" : ""}`}>
              <span className="n">{row.place}</span>
              <Avatar name={row.name} me={row.me} />
              <span className="who">
                <b className={!row.me && row.name === HIDDEN ? "anon" : undefined}>{row.me ? t("Ты") : displayName(row.name)}</b>
                <Marks marks={row.marks} />
              </span>
              <span className="p">{row.points}</span>
            </li>
          ))}
        </ol>
      )}
      {running && rows?.length ? <p className="lb-note">{t("Таблица обновляется сама.")}</p> : null}
    </section>
  );
}

export function ContestAttempts({ contest }: { contest: Contest }) {
  const [mine, setMine] = useState(false);
  const running = contest.state === "running";
  const feed = useResource(
    contest.state === "upcoming" ? null : attemptsKey(contest.id, mine),
    () => getAttempts(contest.id, mine),
    { ttl: running ? 15_000 : 300_000 },
  );
  if (contest.state === "upcoming") return <Waiting title={t("Лента решений появится в начале контеста")} />;
  const rows = feed.data;
  const numbers = new Map(contest.task_details.map((task) => [task.number, task.title || t("Задача {number}", { number: task.number })]));
  return (
    <section className="card cx-feed" aria-label={t("Все решения")}>
      <div className="cx-feed-head">
        <div className="tabs" role="group" aria-label={t("Чьи решения")}>
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
            {t("Все")}
          </button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
            {t("Мои")}
          </button>
        </div>
        <span className="head-note">{t("Видно вердикт, сам ответ никому не показываем")}</span>
      </div>
      {!rows && feed.error ? (
        <p className="small-note" role="alert">
          {t("Лента не загрузилась.")}{" "}
          <button className="link" type="button" onClick={feed.reload}>
            {t("Повторить")}
          </button>
        </p>
      ) : !rows ? (
        <p className="small-note" role="status">
          {t("Загружаю решения…")}
        </p>
      ) : !rows.length ? (
        <p className="small-note">{mine ? t("У тебя пока нет попыток.") : t("Попыток пока нет.")}</p>
      ) : (
        <ol>
          {rows.map((row) => (
            <li key={row.id} className="fd">
              <span className="t" title={t("Время от начала контеста")}>
                {attemptClock(row.at)}
              </span>
              <Avatar name={row.name} me={row.me} />
              <b className={row.me ? "me" : row.name === HIDDEN ? "anon" : undefined}>{row.me ? t("Ты") : displayName(row.name)}</b>
              <span className="tk">{numbers.get(row.task) ?? t("Задача {number}", { number: row.task })}</span>
              <span className={`vd ${row.correct ? "ok" : "bad"}`}>{row.correct ? t("Верно") : t("Неверно")}</span>
            </li>
          ))}
        </ol>
      )}
      {rows?.length ? <p className="lb-note">{t("Время считается от начала контеста.")}</p> : null}
    </section>
  );
}
