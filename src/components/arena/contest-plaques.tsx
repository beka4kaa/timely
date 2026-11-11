"use client";

// Плашки контеста: билет ближайшего, карточка следующего и маленькая плашка прошедшего.
// Цвет задаёт тир, рисунок выбирает админ. У ученика и в админке плашки одни и те же,
// админке они ещё показывают метку состояния вместо имени тира.

import Link from "next/link";

import { tierMeta } from "@/lib/contest-tiers";
import {
  contestDate,
  contestParts,
  contestStateAt,
  countdown,
  plaqueRules,
  shortDate,
  type ContestResult,
  type Plaque,
} from "@/lib/contest-view";

import { ContestArt } from "./contest-art";
import { TierEmblem } from "./tier-emblem";

/** Больше бусин в строку не помещается: дальше число. */
const MAX_BEADS = 8;

function time(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

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

export function ContestHero({ plaque, now, href, badge, draft }: {
  plaque: Plaque;
  now: Date;
  href?: string;
  badge?: string;
  draft?: boolean;
}) {
  const tier = tierMeta(plaque.tier);
  const state = contestStateAt(plaque, now);
  const rules = plaqueRules(plaque);
  const when =
    state === "running"
      ? `Идёт до ${time(plaque.end_time)}`
      : state === "ended"
        ? `Прошёл ${shortDate(plaque.start_time)}`
        : contestDate(plaque.start_time);
  const ticket = (
    <section
      className={`plq plq-hero ${tier.className}${draft ? " is-draft" : ""}`}
      aria-label={state === "running" ? "Контест идёт" : "Ближайший контест"}
      data-attach={plaque.title}
    >
      <ContestArt art={plaque.art} size="hero" />
      <div className="plq-main">
        {badge ? <span className="admin-badge">{badge}</span> : null}
        <p className="plq-date">{when}</p>
        <h2 className="plq-name">{plaque.title}</h2>
        {rules ? <p className="plq-rules">{rules}</p> : null}
      </div>
      <div className="plq-stub">
        <span className="stub-tier">
          <TierEmblem tier={plaque.tier} />
          {tier.name}
        </span>
        {state === "ended" ? (
          <p className="ct-left">Завершён</p>
        ) : (
          <Countdown to={state === "running" ? plaque.end_time : plaque.start_time} now={now} />
        )}
      </div>
    </section>
  );
  return href ? (
    <Link className="plq-hero-wrap plq-link" href={href} aria-label={`${plaque.title}: открыть контест`}>
      {ticket}
    </Link>
  ) : (
    <div className="plq-hero-wrap">{ticket}</div>
  );
}

export function ContestCard({ plaque, now, href, wide, badge, draft }: {
  plaque: Plaque;
  now: Date;
  href: string;
  wide?: boolean;
  badge?: string;
  draft?: boolean;
}) {
  const tier = tierMeta(plaque.tier);
  const running = contestStateAt(plaque, now) === "running";
  const when = running ? `Идёт до ${time(plaque.end_time)}` : shortDate(plaque.start_time);
  const rules = plaqueRules(plaque, { duration: false });
  return (
    <Link
      href={href}
      className={`plq plq-card ${tier.className}${wide ? " plq-wide" : ""}${draft ? " is-draft" : ""}`}
      data-attach={plaque.title}
    >
      <span className="tier-pill">
        <TierEmblem tier={plaque.tier} />
        <span>{badge ?? tier.name}</span>
      </span>
      <ContestArt art={plaque.art} size="card" />
      <h2 className="plq-name">{plaque.title}</h2>
      <p className="plq-rules">{[when, rules].filter(Boolean).join(", ")}</p>
    </Link>
  );
}

export function ContestMini({ plaque, href, result, badge, draft }: {
  plaque: Plaque;
  href: string;
  /** `undefined`: участие ещё не известно, `null`: известно, что не участвовал. */
  result?: ContestResult | null;
  badge?: string;
  draft?: boolean;
}) {
  const tier = tierMeta(plaque.tier);
  const { number, kind } = contestParts(plaque.title);
  const label = result
    ? result.pending
      ? `Решено ${result.solved} из ${result.total}, на проверке ${result.pending}`
      : `Решено ${result.solved} из ${result.total}`
    : "";
  return (
    <Link
      href={href}
      className={`plq plq-mini ${tier.className}${draft ? " is-draft" : ""}`}
      data-attach={plaque.title}
      aria-label={`${plaque.title}, ${shortDate(plaque.start_time)}${label ? `. ${label}` : ""}`}
    >
      <ContestArt art={plaque.art} size="mini" />
      <span className="plq-date">{shortDate(plaque.start_time)}</span>
      {number ? <b className="plq-n">{number}</b> : null}
      <span className={number ? "plq-kind" : "plq-kind ct-kind-big"}>{kind}</span>
      <span className="plq-res">
        {badge ? (
          <span>{badge}</span>
        ) : result && result.tookPart ? (
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
        ) : result !== undefined ? (
          <span className="ct-none">Без участия</span>
        ) : null}
        <span className="tier-pill tier-pill-mini" title={tier.name}>
          <TierEmblem tier={plaque.tier} />
        </span>
      </span>
    </Link>
  );
}
