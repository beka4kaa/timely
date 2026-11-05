"use client";

// Контесты: ближайший билетом, дальше следующие и прошедшие. Цвет плашки это предмет.
//
// Записи на контест и экрана решения на бэкенде и в приложении нет, поэтому кнопок
// «Записаться» и «Решить» здесь нет.

import { useState } from "react";
import Link from "next/link";

import { CardArt, HeroArt, MiniArt } from "@/components/arena/contest-art";
import { SubNav } from "@/components/shell/tab-bar";
import { useAskRail } from "@/contexts/ask-rail";
import { listContests, listMySubmissions, useMe, type Contest, type Submission } from "@/lib/contest-api";
import {
  contestArt,
  contestDate,
  contestParts,
  contestResult,
  contestRules,
  contestTone,
  countdown,
  ownSubmissions,
  reviewPrompt,
  shortDate,
  splitContests,
} from "@/lib/contest-view";
import { useResource } from "@/lib/resource-cache";
import { useNow } from "@/lib/use-now";

const PAST_PAGE = 8;
/** Больше бусин в строку не помещается: дальше число. */
const MAX_BEADS = 8;

function Countdown({ to, now }: { to: string; now: Date }) {
  return (
    <p className="count">
      {countdown(to, now).map((part, index) => (
        <span key={part.unit}>
          {index > 0 ? " " : null}
          <b>{part.value}</b> {part.unit}
        </span>
      ))}
    </p>
  );
}

function time(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function Hero({ contest, now, running }: { contest: Contest; now: Date; running: boolean }) {
  const rules = contestRules(contest);
  return (
    <div className="plq-hero-wrap">
      <section
        className={`plq plq-hero ${contestTone(contest.title)}`}
        aria-label={running ? "Контест идёт" : "Ближайший контест"}
        data-attach={contest.title}
      >
        <HeroArt tasks={contest.tasks.length} />
        <div className="plq-main">
          <p className="plq-date">{running ? `Идёт до ${time(contest.end_time)}` : contestDate(contest.start_time)}</p>
          <h2 className="plq-name">{contest.title}</h2>
          {rules ? <p className="plq-rules">{rules}</p> : null}
          {contest.description ? <p className="plq-rules ct-desc">{contest.description}</p> : null}
        </div>
        <div className="plq-stub">
          <p className="ct-left">{running ? "Осталось" : "До начала"}</p>
          <Countdown to={running ? contest.end_time : contest.start_time} now={now} />
        </div>
      </section>
    </div>
  );
}

function NextCard({ contest, now }: { contest: Contest; now: Date }) {
  const tone = contestTone(contest.title);
  const started = new Date(contest.start_time).getTime() <= now.getTime();
  const when = started ? `Идёт до ${time(contest.end_time)}` : shortDate(contest.start_time);
  const rules = contestRules(contest);
  return (
    <article className={`plq plq-card ${tone}`} data-attach={contest.title}>
      <CardArt kind={contestArt(tone)} />
      <h2 className="plq-name">{contest.title}</h2>
      <p className="plq-rules">{[when, rules].filter(Boolean).join(", ")}</p>
    </article>
  );
}

function PastCard({ contest, submissions }: { contest: Contest; submissions: readonly Submission[] | null }) {
  const { prompt } = useAskRail();
  const tone = contestTone(contest.title);
  const { number, kind } = contestParts(contest.title);
  const result = contestResult(contest, submissions ?? []);
  const canReview = contest.task_details.length > 0;

  const label = result.pending
    ? `Решено ${result.solved} из ${result.total}, на проверке ${result.pending}`
    : `Решено ${result.solved} из ${result.total}`;

  const inner = (
    <>
      <MiniArt kind={contestArt(tone)} seed={contest.id} />
      <span className="plq-date">{shortDate(contest.start_time)}</span>
      {number ? <b className="plq-n">{number}</b> : null}
      <span className={number ? "plq-kind" : "plq-kind ct-kind-big"}>{kind}</span>
      <span className="plq-res">
        {result.tookPart ? (
          <>
            {result.total <= MAX_BEADS ? (
              <span className="beads" role="img" aria-label={label} title={label}>
                {Array.from({ length: result.total }, (_, index) => (
                  <i
                    key={index}
                    className={
                      index < result.solved ? "on" : index < result.solved + result.pending ? "ct-wait" : undefined
                    }
                  />
                ))}
              </span>
            ) : (
              <span title={label}>
                {result.solved} из {result.total}
              </span>
            )}
            {result.points > 0 ? <span className="plq-delta">+{result.points}</span> : null}
          </>
        ) : submissions ? (
          <span className="ct-none">Без участия</span>
        ) : null}
        {canReview ? <span className="more">Разбор</span> : null}
      </span>
    </>
  );

  if (!canReview) {
    return (
      <div className={`plq plq-mini ${tone}`} data-attach={contest.title}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`plq plq-mini ct-mini-btn ${tone}`}
      data-attach={contest.title}
      aria-label={`${contest.title}, ${shortDate(contest.start_time)}. ${result.tookPart ? `${label}. ` : ""}Разобрать с тьютором`}
      onClick={() => prompt({ target: "book", text: reviewPrompt(contest), send: true })}
    >
      {inner}
    </button>
  );
}

export default function ContestsPage() {
  const contests = useResource("compete:contests", listContests, { ttl: 60_000 });
  const submissions = useResource("compete:submissions", listMySubmissions, { ttl: 60_000 });
  const { me, loading: meLoading } = useMe();
  const now = useNow(30_000);
  const [pastShown, setPastShown] = useState(PAST_PAGE);

  const list = contests.data;
  const groups = list && now ? splitContests(list, now) : null;
  const hero = groups ? (groups.running[0] ?? groups.upcoming[0] ?? null) : null;
  const running = Boolean(groups?.running[0]);
  const next = groups ? [...groups.running, ...groups.upcoming].filter((row) => row !== hero) : [];
  const past = groups?.past ?? [];
  // Пока неизвестно, кто ты и что сдавал, про участие лучше промолчать.
  const mine = !meLoading && submissions.data ? ownSubmissions(submissions.data, me?.id) : null;

  return (
    <div className="content view">
      <SubNav group="compete" />
      <header className="head">
        <h1 className="title">Контесты</h1>
      </header>

      {!list && contests.error ? (
        <section className="ct-note card" role="alert">
          <h2>Контесты не загрузились</h2>
          <p>Проверь связь и попробуй ещё раз.</p>
          <button className="btn btn-line" type="button" onClick={contests.reload}>
            Повторить
          </button>
        </section>
      ) : !groups ? (
        <p className="small-note" role="status">
          Загружаю контесты…
        </p>
      ) : !list?.length ? (
        <section className="ct-note card">
          <h2>Контестов пока нет</h2>
          <p>Когда объявят первый, здесь появятся дата, задачи и время. А пока можно закрыть слабые темы.</p>
          <Link className="btn btn-line" href="/dashboard/weaknesses">
            Слабые темы
          </Link>
        </section>
      ) : (
        <>
          {hero && now ? (
            <Hero contest={hero} now={now} running={running} />
          ) : (
            <section className="ct-note card ct-gap">
              <h2>Следующий контест ещё не объявили</h2>
              <p>Как только появится дата, он будет здесь.</p>
            </section>
          )}
          {running ? <p className="small-note ct-solve-note">Решать контест прямо здесь пока нельзя: экрана задач ещё нет.</p> : null}

          {next.length && now ? (
            <div className="plq-row">
              {next.map((contest) => (
                <NextCard key={contest.id} contest={contest} now={now} />
              ))}
            </div>
          ) : null}

          {past.length ? (
            <>
              <h2 className="sec past-sec">Прошедшие</h2>
              <ul className="plq-past">
                {past.slice(0, pastShown).map((contest) => (
                  <li key={contest.id}>
                    <PastCard contest={contest} submissions={mine} />
                  </li>
                ))}
              </ul>
              {past.length > pastShown ? (
                <button className="btn btn-text ct-more" type="button" onClick={() => setPastShown((value) => value + PAST_PAGE)}>
                  Показать ещё
                </button>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
