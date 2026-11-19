"use client";

// Страница одного контеста: назад к списку, билет, описание и три вкладки со своими
// ссылками. Контест перечитывается раз в 15 секунд, пока идёт, и сразу на старте и в конце.

import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { msg, t } from "@/lib/i18n";
import { ContestApiError, getContest, type Contest } from "@/lib/contest-api";
import { contestStateAt, plaqueOf } from "@/lib/contest-view";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";

import { ContestHero } from "./contest-plaques";

export type ContestTab = "tasks" | "table" | "attempts";

const TABS: Array<{ tab: ContestTab; label: string; path: string }> = [
  { tab: "tasks", label: msg("Задачи"), path: "" },
  { tab: "table", label: msg("Таблица"), path: "/table" },
  { tab: "attempts", label: msg("Все решения"), path: "/attempts" },
];

/** Ключи кэша с косой чертой в конце: префикс «…:12/» не задевает контест 123. */
export function contestKey(id: number): string {
  return `compete:contest:${id}/`;
}

export function standingsKey(id: number): string {
  return `compete:standings:${id}/`;
}

export function attemptsKey(id: number, mine?: boolean): string {
  return `compete:attempts:${id}/${mine === undefined ? "" : mine ? "mine" : "all"}`;
}

async function loadContest(id: number): Promise<Contest | null> {
  try {
    return await getContest(id);
  } catch (error) {
    if (error instanceof ContestApiError && error.status === 404) return null;
    throw error;
  }
}

export function ContestShell({ id, tab, compact = false, children }: {
  id: number;
  tab: ContestTab;
  /** Страница задачи: без билета и вкладок, чтобы условие было сразу видно. */
  compact?: boolean;
  children: (contest: Contest, now: Date, reload: () => void) => ReactNode;
}) {
  const known = Number.isInteger(id) && id > 0;
  const now = useNow(15_000);
  // 404 становится null: контеста нет или он черновик, и это не ошибка связи.
  const contest = useResource<Contest | null>(known ? contestKey(id) : null, () => loadContest(id), { ttl: 15_000 });
  const data = contest.data ?? undefined;
  const browserState = data && now ? contestStateAt(data, now) : null;

  // Часы браузера дошли до начала или конца: условия и ответы появляются только с сервера.
  useEffect(() => {
    if (data && browserState && browserState !== data.state) contest.reload();
    // reload стабилен по ключу, а перечитывать нужно только при смене состояния.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserState, data?.state]);

  const missing = !known || contest.data === null;

  return (
    <div className={`content view${compact ? " cx-task-view" : ""}`}>
      {compact ? (
        <Link className="back" href={`/dashboard/arena/solve/${id}`}>
          {data?.title ?? t("Контест")}
        </Link>
      ) : (
        <Link className="back" href="/dashboard/arena/solve">
          {t("Контесты")}
        </Link>
      )}
      {missing ? (
        <section className="ct-note card" role="alert">
          <h2>{t("Такого контеста нет")}</h2>
          <p>{t("Возможно, его убрали. Остальные контесты в списке.")}</p>
        </section>
      ) : !data && contest.error ? (
        <section className="ct-note card" role="alert">
          <h2>{t("Контест не загрузился")}</h2>
          <p>{t("Проверь связь и попробуй ещё раз.")}</p>
          <button className="btn btn-line" type="button" onClick={contest.reload}>
            {t("Повторить")}
          </button>
        </section>
      ) : !data || !now ? (
        <p className="small-note" role="status">
          {t("Загружаю контест…")}
        </p>
      ) : compact ? (
        children(data, now, contest.reload)
      ) : (
        <>
          <ContestHero plaque={plaqueOf(data)} now={now} />
          {data.description ? <p className="cx-about">{data.description}</p> : null}
          <nav className="tabs cx-tabs" aria-label={t("Разделы контеста")}>
            {TABS.map((item) => (
              <Link
                key={item.tab}
                href={`/dashboard/arena/solve/${id}${item.path}`}
                aria-current={item.tab === tab ? "page" : undefined}
              >
                {t(item.label)}
              </Link>
            ))}
          </nav>
          {children(data, now, contest.reload)}
        </>
      )}
    </div>
  );
}
