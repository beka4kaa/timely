"use client";

// Умная сетка контестов: билет, пары карточек и маленькие прошедшие плашки.
// Раскладку решает `layoutContests`, здесь только отрисовка.

import { useState, type ReactNode } from "react";

import { layoutContests } from "@/lib/contest-layout";
import type { ContestResult, Plaque } from "@/lib/contest-view";

import { ContestCard, ContestHero, ContestMini } from "./contest-plaques";

const PAST_PAGE = 8;

export interface GridItem {
  plaque: Plaque;
  href: string;
  /** Метка админки: «Черновик», «Через 5 дней», «Идёт, 38 участников». */
  badge?: string;
  draft?: boolean;
  /** Результат ученика на прошедшем контесте; `undefined`, пока не известно. */
  result?: ContestResult | null;
}

export function ContestGrid({ items, now, aheadEmpty }: {
  items: readonly GridItem[];
  now: Date;
  /** Что показать на месте билета, если впереди ничего нет, а прошедшие есть. */
  aheadEmpty?: ReactNode;
}) {
  const [pastShown, setPastShown] = useState(PAST_PAGE);
  const rows = items.map((item) => ({ ...item, start_time: item.plaque.start_time, end_time: item.plaque.end_time }));
  const layout = layoutContests(rows, now);

  return (
    <>
      {layout.hero ? (
        <ContestHero
          plaque={layout.hero.plaque}
          now={now}
          href={layout.hero.href}
          badge={layout.hero.badge}
          draft={layout.hero.draft}
        />
      ) : (
        aheadEmpty ?? null
      )}

      {layout.next.length ? (
        <div className="plq-row">
          {layout.next.map(({ contest, size }) => (
            <ContestCard
              key={contest.plaque.id}
              plaque={contest.plaque}
              now={now}
              href={contest.href}
              wide={size === "wide"}
              badge={contest.badge}
              draft={contest.draft}
            />
          ))}
        </div>
      ) : null}

      {layout.past.length ? (
        <>
          <h2 className="sec past-sec">Прошедшие</h2>
          <ul className="plq-past">
            {layout.past.slice(0, pastShown).map((item) => (
              <li key={item.plaque.id}>
                <ContestMini
                  plaque={item.plaque}
                  href={item.href}
                  result={item.result}
                  badge={item.badge}
                  draft={item.draft}
                />
              </li>
            ))}
          </ul>
          {layout.past.length > pastShown ? (
            <button className="btn btn-text ct-more" type="button" onClick={() => setPastShown((value) => value + PAST_PAGE)}>
              Показать ещё
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}
