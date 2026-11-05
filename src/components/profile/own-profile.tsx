"use client";

// Свой профиль: кто я, сколько учусь, бейджи и что учу сейчас.
// Счётчик без данных не показывается: нуля и выдуманных чисел здесь нет.

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { BadgeList } from "@/components/profile/badge-list";
import { BioEditor } from "@/components/profile/bio-editor";
import { DaysDetail, HoursDetail, PlaceDetail, TasksDetail, type PlaceLine } from "@/components/profile/stat-detail";
import { useProfileData } from "@/components/profile/use-profile-data";
import { mascot } from "@/components/shell/mascot/mascot";
import { initialsOf } from "@/components/shell/sidebar";
import { updateMe, useMe } from "@/lib/contest-api";
import { ownSubmissions, ru } from "@/lib/contest-view";
import { coverClass } from "@/lib/curriculum-cover";
import { EMPTY_SUMMARY } from "@/lib/pomodoro";
import { computeBadges, hoursStat, mergeActivity, solvedTasks, streaksOf } from "@/lib/profile-view";
import { buildBoard, countryName, grouped } from "@/lib/rating-view";
import { useNow } from "@/lib/use-now";

type StatKey = "days" | "hours" | "tasks" | "place";

interface Stat {
  key: StatKey;
  value: string;
  label: string;
}

function Ring({ percent }: { percent: number }) {
  return (
    <span
      className="ring"
      style={{ "--p": percent } as React.CSSProperties}
      role="img"
      aria-label={`Пройдено ${percent} ${ru(percent, "процент", "процента", "процентов")}`}
    >
      <span className="ring-arc" />
      <span className="ring-head" />
      <span className="ring-v">{percent}</span>
    </span>
  );
}

export function OwnProfile() {
  const { data: session } = useSession();
  const { me, loading: meLoading, setMe } = useMe();
  const data = useProfileData();
  const now = useNow(60_000);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [openStat, setOpenStat] = useState<StatKey | null>(null);

  // Пока профиль не пришёл, имени нет: подпись «Ученик» мигала бы перед настоящим именем.
  const known = session?.user?.name || me?.name || null;
  const name = known ?? (meLoading ? "\u00a0" : "Ученик");
  const handle = me && !me.username.includes("@") ? me.username : null;
  const summary = data.summary.data ?? EMPTY_SUMMARY;

  const users = data.board.data;
  const myUser = users?.find((user) => user.id === me?.id) ?? null;
  const where = [myUser?.city, countryName(myUser?.country_code)].filter(Boolean).join(", ");

  const activity = useMemo(
    () => mergeActivity(data.summary.data?.daily ?? {}, data.habits.data ?? []),
    [data.summary.data, data.habits.data],
  );
  const streaks = useMemo(() => (now ? streaksOf(activity.keys(), now) : null), [activity, now]);
  const submissions = useMemo(
    () => ownSubmissions(data.submissions.data ?? [], me?.id),
    [data.submissions.data, me?.id],
  );
  const solved = useMemo(() => solvedTasks(submissions), [submissions]);
  const pending = useMemo(() => {
    const done = new Set(solved.map((row) => row.task));
    return new Set(submissions.filter((row) => row.status === "pending" && !done.has(row.task)).map((row) => row.task)).size;
  }, [submissions, solved]);

  const places = useMemo<PlaceLine[]>(() => {
    if (!users || !myUser) return [];
    const placeIn = (subject: string | null, country: string | null) =>
      buildBoard(users, { subject, country }, myUser.id).find((row) => row.me)?.place ?? null;
    const lines: PlaceLine[] = [];
    const push = (label: string, place: number | null) => {
      if (place) lines.push({ label, place });
    };
    push("Все ученики", placeIn(null, null));
    if (myUser.country_code) push(countryName(myUser.country_code), placeIn(null, myUser.country_code));
    for (const rating of myUser.ratings) push(rating.discipline_name, placeIn(rating.discipline_name, null));
    return lines;
  }, [users, myUser]);

  const stats: Stat[] = [];
  if (streaks?.total) {
    stats.push({ key: "days", value: grouped(streaks.total), label: `${ru(streaks.total, "день", "дня", "дней")} занятий` });
  }
  const hours = hoursStat(summary.total_seconds);
  if (hours) stats.push({ key: "hours", value: hours.value, label: hours.label });
  if (solved.length) {
    stats.push({
      key: "tasks",
      value: grouped(solved.length),
      label: ru(solved.length, "задача решена", "задачи решено", "задач решено"),
    });
  }
  if (places.length) stats.push({ key: "place", value: `#${grouped(places[0].place)}`, label: "место в рейтинге" });
  const activeStat = stats.find((stat) => stat.key === openStat)?.key ?? stats[0]?.key ?? null;

  const badges = useMemo(
    () =>
      computeBadges({
        activeDays: activity.keys(),
        daily: data.summary.data?.daily ?? {},
        submissions,
        contests: data.contests.data ?? [],
        topics: data.topics.data ?? [],
        materials: data.materials.data ?? [],
        courses: data.lessons.data ?? [],
      }),
    [
      activity,
      data.summary.data,
      submissions,
      data.contests.data,
      data.topics.data,
      data.materials.data,
      data.lessons.data,
    ],
  );
  const earned = badges.filter((badge) => badge.earned).length;

  const lost = (resource: { data: unknown; error: string | null }) =>
    Boolean(resource.error) && resource.data === undefined;
  const statSources = [data.summary, data.habits, data.submissions, data.board];
  const failed = [...statSources, data.contests, data.materials, data.topics].filter(lost);
  // «Счётчиков пока нет» можно сказать, только если данные и правда пришли.
  const statsFailed = statSources.some(lost);
  const waiting = (resource: { data: unknown; error: string | null }) =>
    resource.data === undefined && !resource.error;
  const firstLoad = !now || [data.summary, data.habits, data.submissions, data.board].some(waiting);
  const badgesReady =
    !firstLoad && ![data.contests, data.topics, data.materials, data.lessons].some(waiting);

  const startEdit = () => {
    setDraft(me?.bio ?? "");
    setEditing(true);
  };

  const saveBio = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateMe({ bio: draft.trim() });
      setMe(updated);
      setEditing(false);
      toast.success("Профиль сохранён");
      mascot.react("happy", 1);
    } catch {
      // Текст остаётся в поле: его можно сохранить ещё раз.
      toast.error("Не сохранилось. Попробуй ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  const moveStat = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step || !stats.length) return;
    event.preventDefault();
    const next = stats[(index + step + stats.length) % stats.length];
    setOpenStat(next.key);
    document.getElementById(`pf-stat-${next.key}`)?.focus();
  };

  return (
    <div className="content view">
      <header className="pf-head">
        <span className="avatar pf-av" aria-hidden="true">
          {known || !meLoading ? initialsOf(name) : null}
        </span>
        <div>
          <h1 className="title">{name}</h1>
          {handle || where ? (
            <p className="pf-meta">
              {handle ? <span>@{handle}</span> : null}
              {where ? <span>{where}</span> : null}
            </p>
          ) : null}
          {editing ? (
            <BioEditor value={draft} onChange={setDraft} onSave={saveBio} onCancel={() => setEditing(false)} />
          ) : me?.bio ? (
            <p className="pf-bio">{me.bio}</p>
          ) : me ? (
            <p className="pf-bio pf-bio-empty">Напиши пару слов о себе: что учишь и зачем.</p>
          ) : null}
        </div>
        <div className="pf-tools">
          {editing ? (
            <>
              <button className="btn btn-main" type="button" onClick={saveBio} disabled={saving}>
                {saving ? "Сохраняю…" : "Сохранить"}
              </button>
              <button className="btn btn-text" type="button" onClick={() => setEditing(false)} disabled={saving}>
                Отмена
              </button>
            </>
          ) : (
            <>
              {me ? (
                <button className="btn btn-line" type="button" onClick={startEdit}>
                  Изменить
                </button>
              ) : null}
              <Link className="btn btn-text" href="/dashboard/settings">
                Настройки
              </Link>
              <button className="btn btn-text" type="button" onClick={() => signOut({ callbackUrl: "/auth/signin" })}>
                Выйти
              </button>
            </>
          )}
        </div>
      </header>

      {!meLoading && !me ? (
        <p className="small-note pf-no-row">Описание и место в рейтинге появятся, когда аккаунт подключат к рейтингу.</p>
      ) : null}

      {stats.length ? (
        <>
          <div
            className="pf-stats pf-stats-auto"
            role="tablist"
            aria-label="Что показать"
            style={{ "--n": stats.length } as React.CSSProperties}
          >
            {stats.map((stat, index) => (
              <button
                key={stat.key}
                id={`pf-stat-${stat.key}`}
                className="pf-stat"
                type="button"
                role="tab"
                aria-selected={activeStat === stat.key}
                tabIndex={activeStat === stat.key ? 0 : -1}
                onClick={() => setOpenStat(stat.key)}
                onKeyDown={(event) => moveStat(event, index)}
              >
                <b>{stat.value}</b>
                <span>{stat.label}</span>
              </button>
            ))}
          </div>
          <section className="pf-detail card" role="tabpanel" aria-labelledby={activeStat ? `pf-stat-${activeStat}` : undefined}>
            {activeStat === "days" && streaks && now ? <DaysDetail activity={activity} streaks={streaks} now={now} /> : null}
            {activeStat === "hours" && now ? <HoursDetail summary={summary} now={now} /> : null}
            {activeStat === "tasks" ? <TasksDetail solved={solved} pending={pending} /> : null}
            {activeStat === "place" && myUser ? <PlaceDetail points={myUser.overall_elo} lines={places} /> : null}
          </section>
        </>
      ) : statsFailed ? null : firstLoad ? (
        <div className="pf-stats pf-stats-auto pf-stats-plain" aria-hidden="true" style={{ "--n": 4 } as React.CSSProperties}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="pf-stat pf-ghost">
              <b>&nbsp;</b>
              <span>&nbsp;</span>
            </div>
          ))}
        </div>
      ) : (
        <section className="ct-note card ct-gap">
          <h2>Счётчиков пока нет</h2>
          <p>Дни и часы появятся после первых занятий. Запусти помодоро или отметь привычку.</p>
          <Link className="btn btn-line" href="/dashboard/pomodoro">
            Помодоро
          </Link>
        </section>
      )}

      {failed.length ? (
        <div className="pf-failed" role="alert">
          <span className="small-note">Часть данных не загрузилась, поэтому здесь видно не всё.</span>
          <button className="btn btn-text" type="button" onClick={() => failed.forEach((resource) => resource.reload())}>
            Повторить
          </button>
        </div>
      ) : null}

      <section className="pf-sec">
        <div className="pf-sec-head">
          <h2 className="sec">Бейджи</h2>
          {badgesReady && !failed.length ? (
            <span className="head-note">
              {earned} из {badges.length}
            </span>
          ) : null}
        </div>
        <BadgeList badges={badges} />
      </section>

      <section className="pf-sec">
        <div className="pf-sec-head">
          <h2 className="sec">Сейчас учу</h2>
        </div>
        {data.lessons.data === undefined && data.lessons.error ? (
          <div className="pf-failed" role="alert">
            <span className="small-note">Курсы не загрузились.</span>
            <button className="btn btn-text" type="button" onClick={data.lessons.reload}>
              Повторить
            </button>
          </div>
        ) : data.lessons.data === undefined ? (
          <p className="small-note" role="status">
            Загружаю курсы…
          </p>
        ) : data.lessons.data.length ? (
          <ul className="pf-now">
            {data.lessons.data.map((lesson) => (
              <li key={lesson.id}>
                <Link className="pf-course card" href={lesson.href} data-attach={lesson.subject}>
                  <span className={`book mini ${coverClass(lesson.subject)}`} aria-hidden="true" />
                  <span className="nm">
                    <b>{lesson.subject}</b>
                    <small>{lesson.line}</small>
                  </span>
                  {lesson.percent !== null ? <Ring percent={lesson.percent} /> : <span />}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <section className="ct-note card">
            <h2>Курсов пока нет</h2>
            <p>Добавь предмет в библиотеке, и он появится здесь.</p>
            <Link className="btn btn-line" href="/dashboard/curriculum">
              Курсы и книги
            </Link>
          </section>
        )}
      </section>
    </div>
  );
}
