"use client";

// Контесты: сетка раскладывается сама. Ближайший или идущий контест стоит билетом,
// следующие идут парами, прошедшие маленькими плашками с результатом. Цвет задаёт тир.

import Link from "next/link";

import { ContestGrid, type GridItem } from "@/components/arena/contest-grid";
import { listContests, listMySubmissions, useMe } from "@/lib/contest-api";
import { t } from "@/lib/i18n";
import { contestResult, ownSubmissions, plaqueOf } from "@/lib/contest-view";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";

export default function ContestsPage() {
  const contests = useResource("compete:contests", listContests, { ttl: 60_000 });
  const submissions = useResource("compete:submissions", listMySubmissions, { ttl: 60_000 });
  const { me, loading: meLoading } = useMe();
  const now = useNow(30_000);

  const list = contests.data;
  // Пока неизвестно, кто ты и что сдавал, про участие лучше промолчать.
  const mine = !meLoading && submissions.data ? ownSubmissions(submissions.data, me?.id) : null;
  const items: GridItem[] = (list ?? []).map((contest) => ({
    plaque: plaqueOf(contest),
    href: `/dashboard/arena/solve/${contest.id}`,
    result: mine ? contestResult(contest, mine) : undefined,
  }));

  return (
    <div className="content view">
      <header className="head">
        <h1 className="title">{t("Контесты")}</h1>
      </header>

      {!list && contests.error ? (
        <section className="ct-note card" role="alert">
          <h2>{t("Контесты не загрузились")}</h2>
          <p>{t("Проверь связь и попробуй ещё раз.")}</p>
          <button className="btn btn-line" type="button" onClick={contests.reload}>
            {t("Повторить")}
          </button>
        </section>
      ) : !list || !now ? (
        <p className="small-note" role="status">
          {t("Загружаю контесты…")}
        </p>
      ) : !list.length ? (
        <section className="ct-note card">
          <h2>{t("Контестов пока нет")}</h2>
          <p>{t("Когда объявят первый, здесь появятся дата, задачи и время. А пока можно закрыть слабые темы.")}</p>
          <Link className="btn btn-line" href="/dashboard/weaknesses">
            {t("Слабые темы")}
          </Link>
        </section>
      ) : (
        <ContestGrid
          items={items}
          now={now}
          aheadEmpty={
            <section className="ct-note card ct-gap">
              <h2>{t("Следующий контест ещё не объявили")}</h2>
              <p>{t("Как только появится дата, он будет здесь.")}</p>
            </section>
          }
        />
      )}
    </div>
  );
}
