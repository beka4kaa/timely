"use client";

// Вкладки «Таблица» и «Все решения». Пока контест идёт, обе обновляются сами раз в
// 15 секунд. Ответов чужих людей здесь нет: только место, баллы и вердикты.

import { useState } from "react";

import { initialsOf } from "@/components/shell/sidebar";
import { getAttempts, getStandings, type Contest, type StandingRow } from "@/lib/contest-api";
import { attemptClock } from "@/lib/contest-view";
import { useResource } from "@/lib/resource-cache";

import { attemptsKey, standingsKey } from "./contest-shell";

const HIDDEN = "Участник";

function Avatar({ name, me }: { name: string; me: boolean }) {
  return <span className="av">{me ? "Я" : name === HIDDEN ? "?" : initialsOf(name)}</span>;
}

function Marks({ marks }: { marks: StandingRow["marks"] }) {
  const solved = marks.filter((mark) => mark === "solved").length;
  return (
    <small className="cx-marks" role="img" aria-label={`Решено ${solved} из ${marks.length}`}>
      {marks.map((mark, index) => (
        <i key={index} className={mark === "solved" ? "on" : mark === "tried" ? "try" : undefined} />
      ))}
    </small>
  );
}

function Waiting({ what }: { what: string }) {
  return (
    <section className="ct-note card">
      <h2>{what} появится в начале контеста</h2>
      <p>До старта здесь пусто.</p>
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
  if (contest.state === "upcoming") return <Waiting what="Таблица" />;
  const rows = table.data;
  return (
    <section className="card cx-table" aria-label="Таблица контеста">
      {!rows && table.error ? (
        <p className="small-note" role="alert">
          Таблица не загрузилась.{" "}
          <button className="link" type="button" onClick={table.reload}>
            Повторить
          </button>
        </p>
      ) : !rows ? (
        <p className="small-note" role="status">
          Загружаю таблицу…
        </p>
      ) : !rows.length ? (
        <p className="small-note">Пока никто не отвечал.</p>
      ) : (
        <ol>
          {rows.map((row, index) => (
            <li key={`${row.place}-${index}`} className={`lr cx-row${row.me ? " is-me" : ""}`}>
              <span className="n">{row.place}</span>
              <Avatar name={row.name} me={row.me} />
              <span className="who">
                <b className={!row.me && row.name === HIDDEN ? "anon" : undefined}>{row.me ? "Ты" : row.name}</b>
                <Marks marks={row.marks} />
              </span>
              <span className="p">{row.points}</span>
            </li>
          ))}
        </ol>
      )}
      {running && rows?.length ? <p className="lb-note">Таблица обновляется сама.</p> : null}
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
  if (contest.state === "upcoming") return <Waiting what="Лента решений" />;
  const rows = feed.data;
  const numbers = new Map(contest.task_details.map((task) => [task.number, task.title || `Задача ${task.number}`]));
  return (
    <section className="card cx-feed" aria-label="Все решения">
      <div className="cx-feed-head">
        <div className="tabs" role="group" aria-label="Чьи решения">
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
            Все
          </button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
            Мои
          </button>
        </div>
        <span className="head-note">Видно вердикт, сам ответ никому не показываем</span>
      </div>
      {!rows && feed.error ? (
        <p className="small-note" role="alert">
          Лента не загрузилась.{" "}
          <button className="link" type="button" onClick={feed.reload}>
            Повторить
          </button>
        </p>
      ) : !rows ? (
        <p className="small-note" role="status">
          Загружаю решения…
        </p>
      ) : !rows.length ? (
        <p className="small-note">{mine ? "У тебя пока нет попыток." : "Попыток пока нет."}</p>
      ) : (
        <ol>
          {rows.map((row) => (
            <li key={row.id} className="fd">
              <span className="t" title="Время от начала контеста">
                {attemptClock(row.at)}
              </span>
              <Avatar name={row.name} me={row.me} />
              <b className={row.me ? "me" : row.name === HIDDEN ? "anon" : undefined}>{row.me ? "Ты" : row.name}</b>
              <span className="tk">{numbers.get(row.task) ?? `Задача ${row.task}`}</span>
              <span className={`vd ${row.correct ? "ok" : "bad"}`}>{row.correct ? "Верно" : "Неверно"}</span>
            </li>
          ))}
        </ol>
      )}
      {rows?.length ? <p className="lb-note">Время считается от начала контеста.</p> : null}
    </section>
  );
}
