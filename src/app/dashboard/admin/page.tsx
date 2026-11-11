"use client";

// Админка: контесты в той же сетке, что у учеников, участники и решения.
// Задачи живут внутри контестов, ответы проверяются сами, поэтому отдельных вкладок
// «Задачи» и «Проверка» больше нет: ручное одобрение осталось в «Решениях».

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ADMIN_CONTESTS_KEY } from "@/components/arena/contest-editor";
import { ContestGrid, type GridItem } from "@/components/arena/contest-grid";
import {
  ContestApiError,
  approveSubmission,
  listAdminContests,
  listAdminUsers,
  listMySubmissions,
  rejectSubmission,
  updateAdminUserAccess,
  useMe,
  type AdminUser,
  type Submission,
} from "@/lib/contest-api";
import { adminBadge, plaqueOf } from "@/lib/contest-view";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";

type AdminTab = "contests" | "users" | "submissions";

const TABS: Array<{ tab: AdminTab; label: string }> = [
  { tab: "contests", label: "Контесты" },
  { tab: "users", label: "Участники" },
  { tab: "submissions", label: "Решения" },
];

function ContestsTab() {
  const contests = useResource(ADMIN_CONTESTS_KEY, listAdminContests, { ttl: 60_000 });
  const now = useNow(30_000);
  const list = contests.data;

  if (!list && contests.error) {
    return (
      <section className="ct-note card" role="alert">
        <h2>Контесты не загрузились</h2>
        <p>Проверь связь и попробуй ещё раз.</p>
        <button className="btn btn-line" type="button" onClick={contests.reload}>
          Повторить
        </button>
      </section>
    );
  }
  if (!list || !now) {
    return (
      <p className="small-note" role="status">
        Загружаю контесты…
      </p>
    );
  }
  if (!list.length) {
    return (
      <section className="ct-note card">
        <h2>Контестов пока нет</h2>
        <p>Выбери тир и рисунок, загрузи задачи в PDF и опубликуй: контест сам встанет в сетку.</p>
        <Link className="btn btn-main" href="/dashboard/admin/contests/new">
          Новый контест
        </Link>
      </section>
    );
  }

  const items: GridItem[] = list.map((contest) => ({
    plaque: plaqueOf(contest),
    href: `/dashboard/admin/contests/${contest.id}`,
    badge: adminBadge(contest, now),
    draft: !contest.is_published,
  }));
  return (
    <>
      <ContestGrid items={items} now={now} />
      <p className="small-note adm-note">
        Расставлять ничего не нужно: идущий или ближайший контест встаёт билетом наверху, следующие идут парами,
        прошедшие маленькими плашками. Ученики видят ту же сетку, только без черновиков.
      </p>
    </>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listAdminUsers(query)
      .then(setUsers)
      .catch((error: Error) => toast.error(`Участники не загрузились: ${error.message}`))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function toggle(user: AdminUser, field: "has_full_access" | "is_moderator" | "is_staff", value: boolean) {
    setBusy(`${user.id}:${field}`);
    try {
      const updated = await updateAdminUserAccess(user.id, { [field]: value });
      setUsers((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      toast.error(`Права не обновились: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const switches: Array<{ field: "has_full_access" | "is_moderator" | "is_staff"; label: string }> = [
    { field: "has_full_access", label: "Все страницы" },
    { field: "is_moderator", label: "Модератор" },
    { field: "is_staff", label: "Админ" },
  ];

  return (
    <section className="card adm-card" aria-label="Участники">
      <input
        className="ed-in adm-search"
        value={query}
        placeholder="Поиск по почте или имени"
        aria-label="Поиск участников"
        onChange={(event) => setQuery(event.target.value)}
      />
      {loading && !users.length ? (
        <p className="small-note" role="status">
          Загружаю участников…
        </p>
      ) : !users.length ? (
        <p className="small-note">Никого не нашлось.</p>
      ) : (
        <ul className="adm-list">
          {users.map((user) => (
            <li key={user.id} className="adm-user">
              <span className="who">
                <b>{user.name || user.username || user.email}</b>
                <small>{user.email}</small>
              </span>
              <span className="adm-num" title="Рейтинг">
                {user.overall_elo}
              </span>
              <span className="adm-num muted" title="Принято из всех ответов">
                {user.submissions_approved}/{user.submissions_total}
              </span>
              <span className="adm-switches">
                {switches.map((item) => (
                  <label key={item.field} className="adm-switch">
                    <span>{item.label}</span>
                    <button
                      className="switch"
                      type="button"
                      role="switch"
                      aria-checked={user[item.field]}
                      aria-label={`${item.label}: ${user.email}`}
                      disabled={busy !== null}
                      onClick={() => toggle(user, item.field, !user[item.field])}
                    />
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<Submission["status"], string> = {
  pending: "На проверке",
  approved: "Верно",
  rejected: "Неверно",
};

function SubmissionsTab() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    listMySubmissions()
      .then(setRows)
      .catch((error: Error) => toast.error(`Решения не загрузились: ${error.message}`))
      .finally(() => setLoading(false));
  }, []);

  async function decide(row: Submission, approve: boolean) {
    setBusy(row.id);
    try {
      const updated = approve ? await approveSubmission(row.id) : await rejectSubmission(row.id);
      setRows((items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      toast.success(approve ? `Засчитано, +${updated.task_points}` : "Отклонено");
    } catch (error) {
      toast.error(error instanceof ContestApiError || error instanceof Error ? error.message : "Не получилось.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card adm-card" aria-label="Решения">
      {loading ? (
        <p className="small-note" role="status">
          Загружаю решения…
        </p>
      ) : !rows.length ? (
        <p className="small-note">Решений пока нет.</p>
      ) : (
        <ul className="adm-list">
          {rows.map((row) => (
            <li key={row.id} className="adm-sub">
              <span className="who">
                <b>{row.student_name}</b>
                <small>{row.student_email}</small>
              </span>
              <span className="adm-task">
                <b>{row.task_title || `Задача ${row.task}`}</b>
                <small>{row.contest_title || "Вне контеста"}</small>
              </span>
              <code className="adm-answer">{row.file_url_or_code || row.student_solution_image || "Пусто"}</code>
              <span className={`adm-status is-${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
              <span className="adm-actions">
                {row.status !== "approved" ? (
                  <button className="btn btn-line" type="button" disabled={busy === row.id} onClick={() => decide(row, true)}>
                    Засчитать
                  </button>
                ) : null}
                {row.status !== "rejected" ? (
                  <button className="btn btn-text" type="button" disabled={busy === row.id} onClick={() => decide(row, false)}>
                    Отклонить
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { me, loading } = useMe();
  const [tab, setTab] = useState<AdminTab>("contests");

  useEffect(() => {
    if (!loading && !me?.is_admin) router.replace("/dashboard");
  }, [loading, me?.is_admin, router]);

  if (loading || !me?.is_admin) {
    return (
      <div className="content view">
        <p className="small-note" role="status">
          Загружаю…
        </p>
      </div>
    );
  }

  return (
    <div className="content view">
      <header className="head adm-head">
        <div className="adm-head-l">
          <h1 className="title">Админка</h1>
          <div className="tabs" role="group" aria-label="Разделы админки">
            {TABS.map((item) => (
              <button
                key={item.tab}
                type="button"
                aria-pressed={tab === item.tab}
                onClick={() => setTab(item.tab)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {tab === "contests" ? (
          <Link className="btn btn-main" href="/dashboard/admin/contests/new">
            Новый контест
          </Link>
        ) : null}
      </header>
      {tab === "contests" ? <ContestsTab /> : tab === "users" ? <UsersTab /> : <SubmissionsTab />}
    </div>
  );
}
