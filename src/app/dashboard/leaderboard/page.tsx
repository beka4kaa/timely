"use client";

// Рейтинг: тройка, таблица и всё, что рядом с твоим местом.
//
// Участники несовершеннолетние, поэтому строка показывает только имя пользователя и страну.
// В таблице только те, кто согласился показываться, и сам ученик: своё место он видит всегда.
// Город в таблицу и в фильтры не выходит: согласия на локальный рейтинг в модели пока нет.
// Лиг, сезонов и истории баллов на бэкенде нет, поэтому нет зон, стрелок и «быстрее всех».

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PrivateLeaderboards } from "@/components/leaderboard/PrivateLeaderboards";
import { mascot } from "@/components/shell/mascot/mascot";
import { initialsOf } from "@/components/shell/sidebar";
import {
  listGlobalLeaderboard,
  listMySubmissions,
  updateMe,
  useMe,
  type LeaderboardUser,
} from "@/lib/contest-api";
import { ownSubmissions } from "@/lib/contest-view";
import { plural, t } from "@/lib/i18n";
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

const FIRST_ROWS = 10;
const MORE_ROWS = 50;

/** Где смотреть: весь мир, моя страна или мои группы. */
type Where = "world" | "groups" | { country: string };

function profileHref(row: { id: number; me?: boolean }): string {
  return row.me ? "/dashboard/profile" : `/dashboard/profile/${row.id}`;
}

function nameOf(row: BoardRow): string {
  return row.me ? t("Ты") : row.name;
}

function initialsOfRow(row: BoardRow, myName: string): string {
  return initialsOf(row.me ? myName : row.name);
}

function pointsWord(value: number, subject: string | null): string {
  return subject ? plural(value, "очко", "очка", "очков") : plural(value, "балл", "балла", "баллов");
}

/** Подпись под именем. Скрытому ученику своя строка напоминает, что её никто больше не видит. */
function whereOf(row: BoardRow, hidden: boolean): string {
  return row.me && hidden ? t("видно только тебе") : countryName(row.countryCode);
}

function Podium({ rows, myName, hidden }: { rows: readonly BoardRow[]; myName: string; hidden: boolean }) {
  const first = rows.slice(0, 3);
  if (!first.length) return null;
  return (
    <section className="podium" aria-label={t("Первые трое")}>
      {first.map((row, index) => (
        <Link key={row.id} className={`pod r${index + 1}`} href={profileHref(row)}>
          <span className="pod-av" aria-hidden="true">
            {initialsOfRow(row, myName)}
          </span>
          <span className="pod-name">{nameOf(row)}</span>
          {whereOf(row, hidden) ? <span className="pod-where">{whereOf(row, hidden)}</span> : null}
          <span className="pod-pts">{grouped(row.points)}</span>
          <span className="pod-base" aria-hidden="true">
            {row.place}
          </span>
        </Link>
      ))}
    </section>
  );
}

function Row({ row, myName, hidden }: { row: BoardRow; myName: string; hidden: boolean }) {
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
          {whereOf(row, hidden) ? <small>{whereOf(row, hidden)}</small> : null}
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
  invite,
}: {
  rows: readonly BoardRow[];
  me: BoardRow;
  whereText: string;
  subject: string | null;
  gain: number;
  /** Приглашение показать себя: оно уточняет само место, поэтому стоит прямо под ним. */
  invite: ReactNode;
}) {
  const near = neighboursOf(rows, me);
  const share = shareToNext(me, near);
  const ahead = near.above ? near.above.points - me.points : 0;
  const behind = near.below ? me.points - near.below.points : 0;
  const unit = subject ? t("рейтинга") : pointsWord(me.points, null);

  return (
    <>
      <section className="me-card glass" aria-label={t("Твоё место")}>
        <p className="me-place">
          <b>#{grouped(me.place)}</b>
          <span>{whereText}</span>
        </p>
        <p className="me-sub">
          {grouped(me.points)} {unit}
          {!subject && gain > 0 ? t(", +{gain} за неделю", { gain: grouped(gain) }) : ""}
        </p>
        <p className="me-next">
          {near.above
            ? t("До {place}-го места {points} {unit}", {
                place: grouped(near.above.place),
                points: grouped(ahead),
                unit: pointsWord(ahead, subject),
              })
            : t("Ты на первом месте")}
        </p>
        {share !== null ? (
          <span className="tube rb-tube">
            <i style={{ width: `${share}%` }} />
          </span>
        ) : null}
        <Link className="btn btn-main" href="/dashboard/arena/solve">
          {t("К контестам")}
        </Link>
      </section>
      {invite}
      {near.above || near.below ? (
        <section className="rb-card card" aria-label={t("Рядом с тобой")}>
          <h2>{t("Рядом с тобой")}</h2>
          <ul>
            {near.above ? (
              <li>
                <Link href={profileHref(near.above)}>{near.above.name}</Link>
                <span className="m">{t("впереди на {n}", { n: grouped(ahead) })}</span>
              </li>
            ) : null}
            {near.below ? (
              <li>
                <Link href={profileHref(near.below)}>{near.below.name}</Link>
                <span className="m">{t("позади на {n}", { n: grouped(behind) })}</span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** Показ в рейтинге только по согласию, поэтому сначала видно, что именно увидят другие. */
function JoinBoard({ name, joining, onJoin }: { name: string; joining: boolean; onJoin: () => void }) {
  return (
    <section className="rb-card card rb-invite" aria-label={t("Показ в рейтинге")}>
      <h2>{t("Тебя видишь только ты")}</h2>
      <p className="rb-text">
        {t(
          "Если покажешь себя, другие ученики увидят «{name}», страну, баллы и рейтинг по предметам. Почту и описание никто не увидит. Выключить можно в",
          { name },
        )}{" "}
        <Link className="link" href="/dashboard/settings">
          {t("настройках")}
        </Link>
        .
      </p>
      <button className="btn btn-line" type="button" disabled={joining} onClick={onJoin}>
        {joining ? t("Сохраняю…") : t("Показать меня")}
      </button>
    </section>
  );
}

function Board({
  users,
  meId,
  meLoading,
  myUser,
  myName,
  hiddenAs,
  joining,
  onJoin,
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
  /** Имя, под которым ученика увидят другие. `null`, если он уже показан. */
  hiddenAs: string | null;
  joining: boolean;
  onJoin: () => void;
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
  const whereTitle = country ? countryName(country) : t("Все ученики");
  const whereText = country ? countryIn(country) : t("среди всех");
  const title = subject ? `${whereTitle}, ${subject.toLowerCase()}` : whereTitle;
  const hidden = hiddenAs !== null;
  // Без профиля (скажем, запрос не дошёл) говорить о месте нечего.
  const noPlace = subject
    ? t("По предмету «{subject}» у тебя ещё нет рейтинга.", { subject })
    : myUser
      ? t("В этой таблице тебя нет.")
      : null;
  const invite = hiddenAs !== null ? <JoinBoard name={hiddenAs} joining={joining} onJoin={onJoin} /> : null;

  return (
    <>
      {rows.length ? (
        <Podium rows={rows} myName={myName} hidden={hidden} />
      ) : (
        <section className="ct-note card ct-gap">
          <h2>{t("В этой таблице пока никого")}</h2>
          <p>{t("Выбери другой предмет или посмотри всех учеников.")}</p>
          <button className="btn btn-line" type="button" onClick={() => onSubject(null)}>
            {t("Все предметы")}
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
                  {grouped(rows.length)} {plural(rows.length, "участник", "участника", "участников")}
                </span>
              </div>
              <ol>
                {lines.map((line, index) =>
                  line.type === "row" ? (
                    <Row key={line.row.id} row={line.row} myName={myName} hidden={hidden} />
                  ) : (
                    <li key={`gap-${index}`} className="lr-gap">
                      <button className="rb-gap" type="button" onClick={() => setLimit((value) => value + MORE_ROWS)}>
                        {t("ещё {count} {people}", {
                          count: grouped(line.count),
                          people: plural(line.count, "человек", "человека", "человек"),
                        })}
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
            <MeCard rows={rows} me={me} whereText={whereText} subject={subject} gain={gain} invite={invite} />
          ) : (
            <>
              {meLoading || !noPlace ? null : (
                <section className="rb-card card" aria-label={t("Твоё место")}>
                  <h2>{t("Твоего места здесь пока нет")}</h2>
                  <p className="rb-text">{noPlace}</p>
                </section>
              )}
              {invite}
            </>
          )}
          <section className="rb-card card quiet" aria-label={t("Откуда берутся баллы")}>
            <h2>{t("Откуда берутся баллы")}</h2>
            <ul>
              <li>
                <span>{t("Старт у всех")}</span>
                <span className="m">{grouped(1200)}</span>
              </li>
              <li>
                <span>{t("Решение приняли")}</span>
                <span className="m">{t("+ баллы задачи")}</span>
              </li>
            </ul>
          </section>
          {myUser?.ratings.length ? (
            <section className="rb-card card quiet" aria-label={t("Твой рейтинг по предметам")}>
              <h2>{t("Твой рейтинг по предметам")}</h2>
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
  const { me, loading: meLoading, setMe } = useMe();
  const board = useResource("compete:leaderboard", listGlobalLeaderboard, { ttl: 60_000 });
  const submissions = useResource("compete:submissions", listMySubmissions, { ttl: 60_000 });
  const now = useNow(60_000);

  const [subject, setSubject] = useState<string | null>(null);
  const [where, setWhere] = useState<Where>("world");
  const [joining, setJoining] = useState(false);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    try {
      setMe(await updateMe({ show_in_leaderboard: true }));
      toast.success(t("Теперь другие видят тебя в рейтинге"));
      mascot.react("happy", 1);
    } catch {
      toast.error(t("Не сохранилось. Попробуй ещё раз."));
    } finally {
      setJoining(false);
    }
  };

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
      <header className="head">
        <h1 className="title">{t("Рейтинг")}</h1>
      </header>

      <div className="rb-filters">
        {subjects.length && !isGroups ? (
          <div className="tabs scroll" role="group" aria-label={t("Предмет")}>
            <button type="button" aria-pressed={subject === null} onClick={() => setSubject(null)}>
              {t("Все")}
            </button>
            {subjects.map((name) => (
              <button key={name} type="button" aria-pressed={subject === name} onClick={() => setSubject(name)}>
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="tabs scroll" role="group" aria-label={t("Где")}>
          <button type="button" aria-pressed={where === "world"} onClick={() => setWhere("world")}>
            {t("Все ученики")}
          </button>
          {myCountry ? (
            <button type="button" aria-pressed={isCountry} onClick={() => setWhere({ country: myCountry })}>
              {countryName(myCountry)}
            </button>
          ) : null}
          <button type="button" aria-pressed={isGroups} onClick={() => setWhere("groups")}>
            {t("Мои группы")}
          </button>
        </div>
      </div>

      {isGroups ? (
        <PrivateLeaderboards meId={meId} />
      ) : !users && board.error ? (
        <section className="ct-note card" role="alert">
          <h2>{t("Рейтинг не загрузился")}</h2>
          <p>{t("Проверь связь и попробуй ещё раз.")}</p>
          <button className="btn btn-line" type="button" onClick={board.reload}>
            {t("Повторить")}
          </button>
        </section>
      ) : !users ? (
        <p className="small-note" role="status">
          {t("Загружаю рейтинг…")}
        </p>
      ) : !users.length ? (
        <section className="ct-note card">
          <h2>{t("В рейтинге пока никого")}</h2>
          <p>{t("Баллы появятся, когда проверят первое решение. Следи за контестами.")}</p>
          <Link className="btn btn-line" href="/dashboard/arena/solve">
            {t("Контесты")}
          </Link>
        </section>
      ) : (
        <Board
          users={users}
          meId={meId}
          meLoading={meLoading}
          myUser={myUser}
          myName={me?.name ?? ""}
          hiddenAs={me?.show_in_leaderboard === false ? me.public_username : null}
          joining={joining}
          onJoin={() => void join()}
          where={where}
          subject={subject}
          gain={gain}
          onSubject={setSubject}
        />
      )}
    </div>
  );
}
