"use client";

// Чужой профиль. Только то, что и так видно в рейтинге: имя пользователя, страна, баллы,
// место и рейтинг по предметам. Описание, дни и бейджи ученик видит только сам.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { initialsOf } from "@/components/shell/sidebar";
import { getLeaderboardUser, listGlobalLeaderboard, useMe } from "@/lib/contest-api";
import { ru } from "@/lib/contest-view";
import { buildBoard, countryName, grouped } from "@/lib/rating-view";
import { useResource } from "@/lib/resource-cache";
import "@/styles/timely/page-compete.css";

export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const known = Number.isInteger(id) && id > 0;
  const router = useRouter();
  const { me } = useMe();

  const player = useResource(known ? `compete:player:${id}` : null, () => getLeaderboardUser(id), { ttl: 60_000 });
  const board = useResource("compete:leaderboard", listGlobalLeaderboard, { ttl: 60_000 });

  // Своя строка в рейтинге ведёт в свой профиль, но адрес можно набрать и руками.
  useEffect(() => {
    if (me && me.id === id) router.replace("/dashboard/profile");
  }, [me, id, router]);

  const user = player.data;
  const row = user && board.data ? buildBoard(board.data, { subject: null, country: null }, user.id).find((item) => item.me) : null;

  return (
    <div className="content view">
      <Link className="back" href="/dashboard/leaderboard">
        Рейтинг
      </Link>
      {!known || (!user && player.error) ? (
        <section className="ct-note card" role="alert">
          <h2>Профиль не открылся</h2>
          <p>Такого ученика нет, или пропала связь.</p>
          {known ? (
            <button className="btn btn-line" type="button" onClick={player.reload}>
              Повторить
            </button>
          ) : null}
        </section>
      ) : !user ? (
        <p className="small-note" role="status">
          Загружаю профиль…
        </p>
      ) : (
        <>
          <header className="pf-head">
            <span className="avatar pf-av" aria-hidden="true">
              {initialsOf(user.username)}
            </span>
            <div>
              <h1 className="title">{user.username}</h1>
              {countryName(user.country_code) ? (
                <p className="pf-meta">
                  <span>{countryName(user.country_code)}</span>
                </p>
              ) : null}
            </div>
          </header>

          <div className="pf-stats pf-stats-auto pf-stats-plain" style={{ "--n": row ? 2 : 1 } as React.CSSProperties}>
            <div className="pf-stat">
              <b>{grouped(user.overall_elo)}</b>
              <span>{ru(user.overall_elo, "балл", "балла", "баллов")}</span>
            </div>
            {row ? (
              <div className="pf-stat">
                <b>#{grouped(row.place)}</b>
                <span>место в рейтинге</span>
              </div>
            ) : null}
          </div>

          {user.ratings.length ? (
            <section className="pf-sec">
              <div className="pf-sec-head">
                <h2 className="sec">Рейтинг по предметам</h2>
              </div>
              <ul className="pf-now">
                {user.ratings.map((rating) => (
                  <li key={rating.discipline_name}>
                    <div className="pf-course card pf-rating">
                      <span className="nm">
                        <b>{rating.discipline_name}</b>
                      </span>
                      <b className="pf-score">{grouped(rating.elo_score)}</b>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="small-note">Описание, дни занятий и бейджи ученик видит только сам.</p>
        </>
      )}
    </div>
  );
}
