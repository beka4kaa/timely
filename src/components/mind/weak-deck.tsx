"use client";

// Колода на сегодня и панель памяти рядом.
//
// На карточке нет готового ответа: у темы в базе только название и подтемы. Поэтому это
// попытка вспомнить и честная оценка себя (CLAUDE.md §6.5), а подтемы, если они есть,
// служат проверкой на обороте.

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { REMIND_MASCOT_KEY, REMIND_PUSH_KEY } from "@/components/shell/view-tracker";
import { intervalLabel, nextReview } from "@/lib/mind-srs";
import {
  coverOf,
  dayDiff,
  lastTimeLabel,
  memoryCurve,
  memoryPercent,
  whenLabel,
  type WeakTopic,
} from "@/lib/weak-topics";
import { cn } from "@/lib/utils";
import type { ReviewRating } from "@/types/mind";

const RATES: Array<{ rating: ReviewRating; label: string }> = [
  { rating: "AGAIN", label: "Не вспомнил" },
  { rating: "HARD", label: "Трудно" },
  { rating: "GOOD", label: "Хорошо" },
  { rating: "EASY", label: "Легко" },
];

/** Сколько отметок помещается в шапке карточки. Дальше считаем числами. */
const MAX_PIPS = 8;
const FLY_MS = 300;

function intervalFor(topic: WeakTopic, rating: ReviewRating): number {
  return nextReview({
    rating,
    status: topic.status,
    intervalDays: topic.intervalDays,
    easeFactor: topic.easeFactor,
  }).intervalDays;
}

function questionOf(topic: WeakTopic): string {
  return `Что ты помнишь про тему «${topic.name}»?`;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

/** Как сейчас напоминаем. Настройки на странице настроек, здесь только подпись. */
function useReminderLabel(): { label: string; mascot: boolean } {
  const [state, setState] = useState({ mascot: true, push: false });
  useEffect(() => {
    setState({ mascot: readFlag(REMIND_MASCOT_KEY, true), push: readFlag(REMIND_PUSH_KEY, false) });
  }, []);
  const label = state.mascot && state.push ? "слайм и браузер" : state.mascot ? "слайм" : state.push ? "браузер" : "выключено";
  return { label, mascot: state.mascot };
}

function Pips({ done, total }: { done: number; total: number }) {
  const label = `${Math.min(done + 1, total)} из ${total}`;
  if (total > MAX_PIPS) return <span className="rv-count">{label}</span>;
  return (
    <span className="rv-pips" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, index) => (
        <i key={index} className={index < done ? "done" : index === done ? "on" : ""} />
      ))}
    </span>
  );
}

function MemoryChart({
  topic,
  nextDays,
  reviewToday,
  now,
}: {
  topic: WeakTopic;
  nextDays: number;
  reviewToday: boolean;
  now: Date;
}) {
  const curve = memoryCurve({
    lastRevisedAt: topic.lastRevisedAt,
    intervalDays: topic.intervalDays,
    nextDays,
    reviewToday,
    now,
  });
  return (
    <svg className="rv-chart" viewBox="0 0 300 96" preserveAspectRatio="none" aria-hidden="true">
      <path className="gr" d={`M0 ${curve.height - 0.5}H300`} />
      {curve.area ? <path className="ar" d={curve.area} /> : null}
      {curve.past ? <path className="ln" d={curve.past} /> : null}
      <path className="ln fut" d={curve.future} />
      <path className="tod" d={`M${curve.todayX.toFixed(1)} 0V${curve.height}`} />
      {curve.up ? <path className="ln up" d={curve.up} /> : null}
      {/* График растянут по ширине, и обычный кружок стал бы овалом. Точка из штриха остаётся круглой. */}
      {curve.reviews.map((point) => (
        <path key={point.x} className="rv-dot" d={`M${point.x.toFixed(1)} ${point.y.toFixed(1)}h0.01`} />
      ))}
      {curve.next ? (
        <>
          <path className="rv-dot is-ring" d={`M${curve.next.x.toFixed(1)} ${curve.next.y.toFixed(1)}h0.01`} />
          <path className="rv-dot is-hole" d={`M${curve.next.x.toFixed(1)} ${curve.next.y.toFixed(1)}h0.01`} />
        </>
      ) : null}
    </svg>
  );
}

function MemoryPanel({
  topic,
  nextDays,
  nextLabel,
  rest,
  now,
  reminder,
}: {
  topic: WeakTopic;
  nextDays: number;
  nextLabel: string;
  rest: boolean;
  now: Date;
  reminder: string;
}) {
  const percent = memoryPercent(topic, now);
  return (
    <aside className={cn("rv-mem card", rest && "is-rest")} aria-label="Память">
      <div className="rv-now">
        <b>{percent === null ? "—" : `${percent}%`}</b>
        <span>
          {percent === null ? "ещё не повторяли" : "примерно помнишь"}
          <small>{topic.name}</small>
        </span>
      </div>
      <div className="rv-plot">
        <MemoryChart topic={topic} nextDays={nextDays} reviewToday={!rest} now={now} />
        <div className="pf-axis">
          <span>2 недели назад</span>
          <span>сегодня</span>
          <span>через 2 недели</span>
        </div>
      </div>
      <ul className="rv-next">
        <li>
          <span>Повторим</span>
          <b>{nextLabel}</b>
        </li>
        <li>
          <span>Напомню</span>
          <b>{reminder}</b>
        </li>
      </ul>
      <Link className="link rv-how" href="/dashboard/settings">
        Как напоминать
      </Link>
    </aside>
  );
}

export function WeakDeck({
  current,
  left,
  done,
  nearest,
  now,
  onRate,
  onAsk,
}: {
  /** Текущая тема. `null`, если на сегодня всё. */
  current: WeakTopic | null;
  /** Сколько осталось вместе с текущей. */
  left: number;
  /** Сколько уже оценено за этот заход. */
  done: number;
  /** Что будет следующим, когда на сегодня всё. */
  nearest: WeakTopic | null;
  now: Date;
  onRate: (topic: WeakTopic, rating: ReviewRating) => void;
  onAsk: (topic: WeakTopic) => void;
}) {
  const [side, setSide] = useState<"front" | "back">("front");
  const [forgot, setForgot] = useState(false);
  const [preview, setPreview] = useState<ReviewRating | null>(null);
  // Улетающая карточка остаётся на экране, пока её место уже заняла следующая.
  const [flying, setFlying] = useState<WeakTopic | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  const flyTimer = useRef<number | undefined>(undefined);
  const { label: reminder, mascot: mascotReminds } = useReminderLabel();

  const shown = flying ?? current;
  const shownId = shown?.id ?? null;

  useEffect(() => () => window.clearTimeout(flyTimer.current), []);

  // Карточку сменили не мы (удалили тему в списке, «Повторить сейчас»): лицевой стороной.
  const lastCurrent = useRef(current?.id ?? null);
  useEffect(() => {
    if (lastCurrent.current === (current?.id ?? null)) return;
    lastCurrent.current = current?.id ?? null;
    if (!flying) {
      setSide("front");
      setForgot(false);
      setPreview(null);
    }
  }, [current?.id, flying]);

  // Переворот: у анимации нет другого способа запуститься заново, кроме как снять класс.
  const painted = useRef(false);
  useLayoutEffect(() => {
    if (!painted.current) {
      painted.current = true;
      return;
    }
    const card = cardRef.current;
    if (!card || flying) return;
    card.classList.remove("flip");
    void card.offsetWidth;
    card.classList.add("flip");
    if (wantFocus.current) {
      wantFocus.current = false;
      // Кнопка, на которой был фокус, исчезла. Иначе он ушёл бы в начало страницы.
      card.focus({ preventScroll: true });
    }
  }, [shownId, side, flying]);

  const turn = useCallback((didForget: boolean) => {
    wantFocus.current = true;
    setForgot(didForget);
    setPreview(null);
    setSide("back");
  }, []);

  const rate = useCallback(
    (topic: WeakTopic, rating: ReviewRating) => {
      wantFocus.current = true;
      onRate(topic, rating);
      const finish = () => {
        setFlying(null);
        setSide("front");
        setForgot(false);
        setPreview(null);
      };
      if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
        finish();
        return;
      }
      setFlying(topic);
      window.clearTimeout(flyTimer.current);
      flyTimer.current = window.setTimeout(finish, FLY_MS);
    },
    [onRate],
  );

  const panelTopic = shown ?? nearest;
  const rest = !shown;
  const rating = preview ?? (forgot ? "AGAIN" : "GOOD");
  const nextDays = shown
    ? intervalFor(shown, rating)
    : nearest?.nextReviewAt
      ? dayDiff(now, new Date(nearest.nextReviewAt))
      : 0;
  const nextLabel = shown
    ? intervalLabel(nextDays)
    : nearest
      ? whenLabel(nearest.nextReviewAt, now)
      : "";
  const total = done + left;
  const cover = shown ? coverOf(shown.subjectName, shown.subjectColor) : null;
  const subtopics = shown?.subtopics ?? [];

  return (
    <section className={cn("rv", !panelTopic && "is-solo")} aria-label="Повторение">
      <div className="rv-deck" data-left={Math.max(0, left + (flying ? 1 : 0))}>
        <div
          ref={cardRef}
          className={cn("rv-card glass", flying && "fly")}
          tabIndex={-1}
          aria-live="polite"
          data-attach={shown ? `Тема: ${shown.name}` : undefined}
        >
          {shown && cover ? (
            <>
              <div className="rv-head">
                <span className={cn("book mini", cover.className)} style={cover.style as React.CSSProperties} aria-hidden="true" />
                <span className="rv-from">
                  <b>{shown.subjectName ?? "Без предмета"}</b>
                  <small>{lastTimeLabel(shown.lastRevisedAt, now)}</small>
                </span>
                <Pips done={Math.min(done, Math.max(total - 1, 0))} total={total} />
              </div>
              {side === "front" ? (
                <>
                  <h2 className="rv-q">{questionOf(shown)}</h2>
                  <div className="rv-acts">
                    <button className="btn btn-main" type="button" onClick={() => turn(false)}>
                      Проверить себя
                    </button>
                    <button className="btn btn-text" type="button" onClick={() => turn(true)}>
                      Не могу вспомнить
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="rv-small-q">{questionOf(shown)}</p>
                  <p className="rv-a">
                    {subtopics.length
                      ? `В эту тему входит: ${subtopics.map((row) => row.title).join(", ")}.`
                      : forgot
                        ? "Ничего страшного. Разбери тему с тьютором или вернись к ней завтра."
                        : "Оцени честно: от этого зависит, когда тема вернётся."}
                  </p>
                  <div
                    className="rv-rates"
                    onPointerLeave={() => setPreview(null)}
                    onBlur={() => setPreview(null)}
                  >
                    {RATES.map((row) => (
                      <button
                        key={row.rating}
                        type="button"
                        disabled={Boolean(flying)}
                        onPointerEnter={() => setPreview(row.rating)}
                        onFocus={() => setPreview(row.rating)}
                        onClick={() => rate(shown, row.rating)}
                      >
                        <b>{row.label}</b>
                        <small>{intervalLabel(intervalFor(shown, row.rating))}</small>
                      </button>
                    ))}
                  </div>
                  <button className="link rv-explain" type="button" onClick={() => onAsk(shown)}>
                    Разобрать с тьютором
                  </button>
                </>
              )}
            </>
          ) : (
            <div className="rv-done">
              <svg className="rv-slime" viewBox="0 0 172 122" aria-hidden="true">
                <use href="#art-slime" />
              </svg>
              <h2>На сегодня всё</h2>
              <p>
                {nearest
                  ? `Следующее повторение ${whenLabel(nearest.nextReviewAt, now)}.${mascotReminds ? " Напомню через слайма." : ""}`
                  : "Пока повторять нечего. Напиши ниже, что изучил, и первое повторение будет завтра."}
              </p>
            </div>
          )}
        </div>
      </div>
      {panelTopic ? (
        <MemoryPanel
          topic={panelTopic}
          nextDays={nextDays}
          nextLabel={nextLabel}
          rest={rest}
          now={now}
          reminder={reminder}
        />
      ) : null}
    </section>
  );
}

/** Пустое состояние: тем нет совсем. Приглашение написать, что изучил: поле прямо под карточкой. */
export function WeakEmpty() {
  return (
    <section className="rv is-solo" aria-label="Повторение">
      <div className="rv-deck" data-left="1">
        <div className="rv-card glass">
          <div className="rv-done">
            <svg className="rv-slime" viewBox="0 0 172 122" aria-hidden="true">
              <use href="#art-slime" />
            </svg>
            <h2>Тем пока нет</h2>
            <p>Напиши ниже своими словами, что сегодня изучил. Темы заполню сам, а первое повторение поставлю на завтра.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
