"use client";

// Видео и трансляции недели. Ссылки живут в дне дневника, а итог за месяц показывает
// страница итоговых оценок.

import { useState, type FormEvent } from "react";

import { Icon } from "@/components/shell/icons";
import { dayMonthLabel, weekdayLabel } from "@/lib/now-feed";
import type { DiaryWeek, YoutubeLink } from "@/types/diary";
import type { DiaryWeekApi } from "./use-diary-week";

function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("?")[0];
    if (parsed.hostname.includes("youtube.com")) return parsed.searchParams.get("v");
  } catch {
    // Не адрес: покажем как есть, без картинки.
  }
  return null;
}

/** Адрес, который можно открыть: `javascript:` в href выполнился бы по клику. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function linkName(link: YoutubeLink): string {
  if (link.label) return link.label;
  return youtubeId(link.url) ? "YouTube" : "Ссылка";
}

export function weekLinkCount(week: DiaryWeek): number {
  return week.days.reduce((sum, day) => sum + (day.youtubeLinks?.length ?? 0), 0);
}

export function WeekVideos({
  week,
  today,
  api,
}: {
  week: DiaryWeek;
  today: string;
  api: DiaryWeekApi;
}) {
  const inWeek = week.days.some((day) => day.date === today);
  const [dayId, setDayId] = useState(
    () => (inWeek ? week.days.find((day) => day.date === today)?.id : week.days[0]?.id) ?? "",
  );
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState("");

  const days = week.days.filter((day) => day.youtubeLinks?.length);
  const selected = week.days.find((day) => day.id === dayId) ?? week.days[0];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = url.trim();
    if (!selected || !isWebUrl(address)) return;
    const link: YoutubeLink = {
      id: crypto.randomUUID(),
      url: address,
      label: label.trim() || undefined,
      durationMin: minutes ? parseInt(minutes, 10) || undefined : undefined,
      createdAt: new Date().toISOString(),
    };
    api.saveLinks(selected, [...(selected.youtubeLinks ?? []), link]);
    setUrl("");
    setLabel("");
    setMinutes("");
  };

  return (
    <section className="dy-videos">
      <h2 className="sec">Видео и трансляции</h2>
      <div className="card dy-videos-card">
        {days.length ? (
          <ul>
            {days.flatMap((day) =>
              (day.youtubeLinks ?? []).map((link) => {
                const id = youtubeId(link.url);
                return (
                  <li key={link.id} className="dy-video">
                    {id ? (
                      <img src={`https://i.ytimg.com/vi/${id}/default.jpg`} alt="" loading="lazy" />
                    ) : (
                      <span className="dy-video-ph" aria-hidden="true" />
                    )}
                    <span className="dy-video-b">
                      {isWebUrl(link.url) ? (
                        <a className="dy-video-name" href={link.url} target="_blank" rel="noopener noreferrer">
                          {linkName(link)}
                        </a>
                      ) : (
                        <span className="dy-video-name">{linkName(link)}</span>
                      )}
                      <small>
                        {weekdayLabel(day.date)}, {dayMonthLabel(day.date)}
                        {link.durationMin ? `, ${link.durationMin} мин` : ""}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Убрать: ${linkName(link)}`}
                      onClick={() =>
                        api.saveLinks(
                          day,
                          (day.youtubeLinks ?? []).filter((item) => item.id !== link.id),
                        )
                      }
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
        ) : (
          <p className="dy-videos-none">На этой неделе ссылок нет. Добавь запись урока или трансляцию.</p>
        )}
        <form className="dy-video-form" onSubmit={submit}>
          <select
            className="dy-select"
            aria-label="День"
            value={selected?.id ?? ""}
            onChange={(event) => setDayId(event.target.value)}
          >
            {week.days.map((day) => (
              <option key={day.id} value={day.id}>
                {weekdayLabel(day.date)}, {dayMonthLabel(day.date)}
              </option>
            ))}
          </select>
          <span className="dy-input">
            <input
              type="url"
              value={url}
              aria-label="Ссылка"
              placeholder="Ссылка на видео"
              onChange={(event) => setUrl(event.target.value)}
            />
          </span>
          <span className="dy-input">
            <input
              value={label}
              aria-label="Название"
              placeholder="Название, если нужно"
              onChange={(event) => setLabel(event.target.value)}
            />
          </span>
          <span className="dy-input dy-input-min">
            <input
              type="number"
              min={1}
              max={600}
              value={minutes}
              aria-label="Сколько минут"
              placeholder="Мин"
              onChange={(event) => setMinutes(event.target.value)}
            />
          </span>
          <button type="submit" className="btn btn-line" disabled={!isWebUrl(url.trim())}>
            Добавить
          </button>
        </form>
      </div>
    </section>
  );
}
