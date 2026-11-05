"use client";

// Рейтинг: тройка, таблица и всё, что рядом с твоим местом.
//
// Участники несовершеннолетние, поэтому строка показывает только имя пользователя и страну.
// Город в таблицу и в фильтры не выходит: согласия на локальный рейтинг в модели пока нет.
// Лиг, сезонов и истории баллов на бэкенде нет, поэтому нет зон, стрелок и «быстрее всех».

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PrivateLeaderboards } from "@/components/leaderboard/PrivateLeaderboards";
import { initialsOf } from "@/components/shell/sidebar";
import { SubNav } from "@/components/shell/tab-bar";
import {
  listGlobalLeaderboard,
  listMySubmissions,
  useMe,
  type LeaderboardUser,
} from "@/lib/contest-api";
import { ownSubmissions, ru } from "@/lib/contest-view";
import {
  buildBoard,
  countryIn,
  countryName,
  grouped,
  neighboursOf,
  shareToNext,
  subjectsOf,
  visibleLines,
  weeklyGain,
  type BoardRow,
} from "@/lib/rating-view";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";
import "@/styles/timely/page-compete.css";

const FIRST_ROWS = 10;
const MORE_ROWS = 50;

/** Где смотреть: весь мир, моя страна или мои группы. */
type Where = "world" | "groups" | { country: string };

function profileHref(row: { id: number; me?: boolean }): string {
  return row.me ? "/dashboard/profile" : `/dashboard/profile/${row.id}`;
}

function nameOf(row: BoardRow): string {
  return row.me ? "Ты" : row.name;
}

function initialsOfRow(row: BoardRow, myName: string): string {
  return initialsOf(row.me ? myName : row.name);
}

function pointsWord(value: number, subject: string | null): string {
  return subject ? ru(value, "очко", "очка", "очков") : ru(value, "балл", "балла", "баллов");
}

function Podium({ rows, myName }: { rows: readonly BoardRow[]; myName: string }) {
  const first = rows.slice(0, 3);
  if (!first.length) return null;
  return (
    <section className="podium" aria-label="Первые трое">
      {first.map((row, index) => (
        <Link key={row.id} className={`pod r${index + 1}`} href={profileHref(row)}>
          <span className="pod-av" aria-hidden="true">
            {initialsOfRow(row, myName)}
          </span>
          <span className="pod-name">{nameOf(row)}</span>
          {countryName(row.countryCode) ? <span className="pod-where">{countryName(row.countryCode)}</span> : null}
          <span className="pod-pts">{grouped(row.points)}</span>
          <span className="pod-base" aria-hidden="true">
            {row.place}
          </span>
        </Link>
      ))}
    </section>
  );
}

function Row({ row, myName }: { row: BoardRow; myName: string }) {
  return (
    <li>
      <Link
        className={row.me ? "lr rb-row is-me glass" : "lr rb-row"}
        href={profileHref(row)}
        aria-current={row.me ? "true" : undefined}
      >
        <span className="n">{grouped(row.place)}</span>
        <span className="av" aria-hidden="true">
          {initialsOfRow(row, myName)}
        </span>
        <span className="who">
          <b>{nameOf(row)}</b>
          {countryName(row.countryCode) ? <small>{countryName(row.countryCode)}</small> : null}
        </span>
        <span className="m tr">{row.tier ?? ""}</span>
        <span className="p">{grouped(row.points)}</span>
      </Link>
    </li>
  );
}

function MeCard({
  rows,
  me,
  whereText,
  subject,
  gain,
}: {
  rows: readonly BoardRow[];
  me: BoardRow;
  whereText: string;
  subject: string | null;
  gain: number;
}) {
  const near = neighboursOf(rows, me);
  const share = shareToNext(me, near);
  const ahead = near.above ? near.above.points - me.points : 0;
  const behind = near.below ? me.points - near.below.points : 0;
  const unit = subject ? "рейтинга" : pointsWord(me.points, null);

  return (
    <>
      <section className="me-card glass" aria-label="Твоё место">
        <p className="me-place">
          <b>#{grouped(me.place)}</b>
          <span>{whereText}</span>
        </p>
        <p className="me-sub">
          {grouped(me.points)} {unit}
          {!subject && gain > 0 ? `, +${grouped(gain)} за неделю` : ""}
        </p>
        <p className="me-next">
          {near.above
            ? `До ${grouped(near.above.place)}-го места ${grouped(ahead)} ${pointsWord(ahead, subject)}`
            : "Ты на первом месте"}
        </p>
        {share !== null ? (
          <span className="tube rb-tube">
            <i style={{ width: `${share}%` }} />
          </span>
        ) : null}
        <Link className="btn btn-main" href="/dashboard/arena/solve">
          К контестам
        </Link>
      </section>
      {near.above || near.below ? (
        <section className="rb-card card" aria-label="Рядом с тобой">
          <h2>Рядом с тобой</h2>
          <ul>
            {near.above ? (
              <li>
                <Link href={profileHref(near.above)}>{near.above.name}</Link>
                <span className="m">впереди на {grouped(ahead)}</span>
              </li>
            ) : null}
            {near.below ? (
              <li>
                <Link href={profileHref(near.below)}>{near.below.name}</Link>
                <span className="m">позади на {grouped(behind)}</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Board({
  users,
  meId,
  meLoading,
  myUser,
  myName,
  where,
  subject,
  gain,
  onSubject,
}: {
  users: readonly LeaderboardUser[];
  meId: number | null;
  meLoading: boolean;
  myUser: LeaderboardUser | null;
  myName: string;
  where: Exclude<Where, "groups">;
  subject: string | null;
  gain: number;
  onSubject: (subject: string | null) => void;
}) {
  const country = where === "world" ? null : where.country;
  const rows = useMemo(() => buildBoard(users, { subject, country }, meId), [users, subject, country, meId]);
  const [limit, setLimit] = useState(FIRST_ROWS);
  useEffect(() => setLimit(FIRST_ROWS), [subject, country]);

  const me = rows.find((row) => row.me) ?? null;
  const lines = visibleLines(rows, limit);
  const whereTitle = country ? countryName(country) : "Все ученики";
  const whereText = country ? countryIn(country) : "среди всех";
  const title = subject ? `${whereTitle}, ${subject.toLowerCase()}` : whereTitle;

  return (
    <>
      {rows.length ? (
        <Podium rows={rows} myName={myName} />
      ) : (
        <section className="ct-note card ct-gap">
          <h2>В этой таблице пока никого</h2>
          <p>Выбери другой предмет или посмотри всех учеников.</p>
          <button className="btn btn-line" type="button" onClick={() => onSubject(null)}>
            Все предметы
          </button>
        </section>
      )}

      <div className="lb">
        <div className="lb-main">
          {rows.length ? (
            <>
              <div className="lb-head">
                <h2>{title}</h2>
                <span>
                  {grouped(rows.length)} {ru(rows.length, "участник", "участника", "участников")}
                </span>
              </div>
              <ol>
                {lines.map((line, index) =>
                  line.type === "row" ? (
                    <Row key={line.row.id} row={line.row} myName={myName} />
                  ) : (
                    <li key={`gap-${index}`} className="lr-gap">
                      <button className="rb-gap" type="button" onClick={() => setLimit((value) => value + MORE_ROWS)}>
                        ещё {grouped(line.count)} {ru(line.count, "человек", "человека", "человек")}
                      </button>
                    </li>
                  ),
                )}
              </ol>
            </>
          ) : null}
        </div>

        <aside className="lb-side">
          {me ? (
            <MeCard rows={rows} me={me} whereText={whereText} subject={subject} gain={gain} />
          ) : meLoading ? null : (
            <section className="rb-card card" aria-label="Твоё место">
              <h2>Твоего места здесь пока нет</h2>
              <p className="rb-text">
                {subject
                  ? `По предмету «${subject}» у тебя ещё нет рейтинга.`
                  : myUser
                    ? "В этой таблице тебя нет."
                    : "Твой аккаунт пока не участвует в рейтинге."}
              </p>
            </section>
          )}
          <section className="rb-card card quiet" aria-label="Откуда берутся баллы">
            <h2>Откуда берутся баллы</h2>
            <ul>
              <li>
                <span>Старт у всех</span>
                <span className="m">{grouped(1200)}</span>
              </li>
              <li>
                <span>Решение приняли</span>
                <span className="m">+ баллы задачи</span>
              </li>
            </ul>
          </section>
          {myUser?.ratings.length ? (
            <section className="rb-card card quiet" aria-label="Твой рейтинг по предметам">
              <h2>Твой рейтинг по предметам</h2>
              <ul className="subj-rate">
                {myUser.ratings.map((rating) => (
                  <li key={rating.discipline_name}>
                    <button
                      className="subj-l rb-subj"
                      type="button"
                      aria-pressed={subject === rating.discipline_name}
                      onClick={() => onSubject(rating.discipline_name)}
                    >
                      <span>{rating.discipline_name}</span>
                      <b>{grouped(rating.elo_score)}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

export default function LeaderboardPage() {
  const { me, loading: meLoading } = useMe();
  const board = useResource("compete:leaderboard", listGlobalLeaderboard, { ttl: 60_000 });
  const submissions = useResource("compete:submissions", listMySubmissions, { ttl: 60_000 });
  const now = useNow(60_000);

  const [subject, setSubject] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>("world");

  const users = board.data ?? null;
  const meId = me?.id ?? null;
  const myUser = users?.find((user) => user.id === meId) ?? null;
  const myCountry = myUser?.country_code ?? null;
  const subjects = useMemo(() => (users ? subjectsOf(users) : []), [users]);
  const gain = now && submissions.data ? weeklyGain(ownSubmissions(submissions.data, meId), now) : 0;
  const isGroups = where === "groups";
  const isCountry = typeof where === "object";

  return (
    <div className="content view">
      <SubNav group="compete" />
      <header className="head">
        <h1 className="title">Рейтинг</h1>
      </header>

      <div className="rb-filters">
        {subjects.length && !isGroups ? (
          <div className="tabs scroll" role="group" aria-label="Предмет">
            <button type="button" aria-pressed={subject === null} onClick={() => setSubject(null)}>
              Все
            </button>
            {subjects.map((name) => (
              <button key={name} type="button" aria-pressed={subject === name} onClick={() => setSubject(name)}>
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="tabs scroll" role="group" aria-label="Где">
          <button type="button" aria-pressed={where === "world"} onClick={() => setWhere("world")}>
            Все ученики
          </button>
          {myCountry ? (
            <button type="button" aria-pressed={isCountry} onClick={() => setWhere({ country: myCountry })}>
              {countryName(myCountry)}
            </button>
          ) : null}
          <button type="button" aria-pressed={isGroups} onClick={() => setWhere("groups")}>
            Мои группы
          </button>
        </div>
      </div>

      {isGroups ? (
        <PrivateLeaderboards meId={meId} noAccount={!meLoading && !me} />
      ) : !users && board.error ? (
        <section className="ct-note card" role="alert">
          <h2>Рейтинг не загрузился</h2>
          <p>Проверь связь и попробуй ещё раз.</p>
          <button className="btn btn-line" type="button" onClick={board.reload}>
            Повторить
          </button>
        </section>
      ) : !users ? (
        <p className="small-note" role="status">
          Загружаю рейтинг…
        </p>
      ) : !users.length ? (
        <section className="ct-note card">
          <h2>В рейтинге пока никого</h2>
          <p>Баллы появятся, когда проверят первое решение. Следи за контестами.</p>
          <Link className="btn btn-line" href="/dashboard/arena/solve">
            Контесты
          </Link>
        </section>
      ) : (
        <Board
          users={users}
          meId={meId}
          meLoading={meLoading}
          myUser={myUser}
          myName={me?.name ?? ""}
          where={where}
          subject={subject}
          gain={gain}
          onSubject={setSubject}
        />
      )}
    </div>
  );
}
