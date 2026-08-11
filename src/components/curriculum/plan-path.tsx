// Путь курса: ось времени от сегодня до финиша.
//
// Герой страницы. Прежде им был корешок книги — полоса страниц 1..682, — но
// он отвечал на вопрос про качество генератора («сколько книги попало в
// программу»), а не на вопросы ученика. Все они лежат на оси времени: когда
// закончу, успею ли к сроку, сколько это в неделях, где вехи.
//
// Одна вольность на весь экран — красная отметка срока и то, что за ней:
// главы правее неё рисуются контуром, а не заливкой. «Не успеваю» должно быть
// видно, а не прочитано в сноске. Всё остальное держится тихо: одна краска для
// глав, никакой раскраски по модулям (одиннадцать оттенков одного тона
// различить нельзя, это уже проверено легендой корешка).
//
// Ширина главы — ЧАСЫ. Двенадцатичасовая глава и сорокаминутная наконец
// выглядят по-разному; на оси страниц они были почти одинаковыми.

"use client";

import { useState } from "react";

import type { CoursePlan, LearningGoal } from "@/lib/curriculum-api";
import type { CoursePath } from "@/lib/curriculum-path";
import {
  forecastWarningMessage,
  formatPlanDate,
  formatShortDate,
  paceAdvice,
  parseForecast,
  rhythmLine,
  riskLabel,
  sessionsCountLabel,
} from "@/lib/curriculum-forecast";
import { formatMinutes } from "@/lib/curriculum-progress";
import { PlanPaceDialog } from "./plan-pace";
import { paperCaption, paperNumber, paperStrip } from "./paper";

const TRACK_HEIGHT = 34;

export function PlanPath({
  plan,
  goal,
  path,
  bookLines,
  hoveredModuleId,
  onPlanChange,
}: {
  plan: CoursePlan;
  goal: LearningGoal | null;
  path: CoursePath;
  /** Что осталось от книги: покрытие и пропуски, по строке на каждое. */
  bookLines: string[];
  /**
   * Глава наведённой в списке темы. Связь односторонняя: строка темы находит
   * своё место во времени, а обратно с оси в список вести незачем — там сто
   * пятьдесят строк, и прыгать к ним по наведению было бы шумом.
   */
  hoveredModuleId: string | null;
  onPlanChange?: (plan: CoursePlan) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const forecast = parseForecast(plan.forecast);
  const rhythm = rhythmLine(
    forecast?.sessionsPerWeek ?? plan.recommended_sessions_per_week,
    forecast?.minutesPerSession ?? plan.recommended_session_minutes,
  );
  const deadlineIso = goal?.desired_finish_date ?? null;
  const feasible = forecast?.desiredDeadlineFeasible ?? null;
  const advice = forecast ? paceAdvice(forecast, deadlineIso) : null;

  const { optimistic, expected, realistic } = path.finish;
  const spread = optimistic && realistic ? [optimistic, realistic] : null;

  return (
    <section className={`${paperStrip} p-5 sm:p-6`}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={paperCaption}>Путь курса</p>
        <p className={`${paperNumber} text-[12px] text-[#7f776e]`}>
          {[
            formatMinutes(plan.estimated_total_minutes),
            forecast?.estimatedSessions
              ? sessionsCountLabel(forecast.estimatedSessions)
              : null,
            path.weeks ? `${path.weeks} нед.` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* Ритм — допущение, на котором держится вся картинка, поэтому он стоит
          подзаголовком, а не в карточке сбоку. Кнопка появляется только там,
          где ритма нет: менять его иначе есть где, внизу страницы. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-[12px] text-[#8b8278]">
          {rhythm ?? "Ритм занятий не задан — без него календарь не построить."}
        </p>
        {!rhythm && <PlanPaceDialog plan={plan} onPlanChange={onPlanChange} />}
      </div>

      {/* ── Ось ─────────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-[10px] border border-[#e0d9cd] bg-[#f5f0e7]"
        style={{ height: TRACK_HEIGHT }}
        role="img"
        aria-label={axisLabel(path, deadlineIso)}
      >
        {path.blocks.map((block, index) => {
          const active = hoveredModuleId === block.moduleId || hovered === block.key;
          // Разрезанная сроком глава — это два куска, но номер у неё один:
          // подписываем только первый.
          const first =
            path.blocks.findIndex((item) => item.moduleId === block.moduleId) === index;
          const wide = first && block.widthPct >= 4;
          return (
            <div
              key={block.key}
              onMouseEnter={() => setHovered(block.key)}
              onMouseLeave={() => setHovered(null)}
              title={blockTitle(block.title, block.startDate, block.endDate)}
              className={`timely-path-block absolute inset-y-0 grid place-items-center overflow-hidden rounded-[3px] transition-colors duration-150 ${
                block.beyondDeadline
                  ? "border border-[#a89a84] bg-transparent"
                  : "border border-transparent"
              }`}
              style={{
                left: `${block.startPct}%`,
                width: `max(2px, calc(${block.widthPct}% - 2px))`,
                background: block.beyondDeadline
                  ? undefined
                  : active
                    ? "#b7792d"
                    : "#6f6350",
                borderColor: block.beyondDeadline
                  ? active
                    ? "#b7792d"
                    : "#a89a84"
                  : "transparent",
                animationDelay: `${Math.min(index, 24) * 25}ms`,
              }}
            >
              {/* Номер главы живёт внутри своей полосы: отдельная линейка
                  номеров под осью спорила бы с линейкой месяцев. */}
              {wide && (
                <span
                  className={`${paperNumber} pointer-events-none text-[10px] leading-none ${
                    block.beyondDeadline ? "text-[#8b8278]" : "text-[#f3ece0]"
                  }`}
                >
                  {block.label}
                </span>
              )}
            </div>
          );
        })}

        {/* Отметка срока. Единственное место на странице, где палитра
            повышает голос. */}
        {path.deadline && (
          <span
            aria-hidden
            className="timely-path-mark absolute inset-y-0 w-px bg-[#b0473e]"
            style={{ left: `${path.deadline.atPct}%` }}
          />
        )}

        {/* Вехи — ромбы на конце своей главы, поверх заливки. */}
        {path.milestones.map((milestone) => (
          <span
            key={milestone.id}
            aria-hidden
            title={milestone.title}
            className="timely-path-mark absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#fffdfa] bg-[#e7c98f]"
            style={{ left: `${milestone.atPct}%` }}
          />
        ))}
      </div>

      {/* ── Линейка и отметки под осью ───────────────────────────────────── */}
      <div className="relative mt-1.5 h-4" aria-hidden>
        {path.ticks.map((tick) => (
          <span
            key={`${tick.label}-${tick.atPct}`}
            className={`${paperNumber} absolute top-0 text-[10px] leading-none text-[#a1978b]`}
            style={{
              left: `${tick.atPct}%`,
              transform: tick.atPct > 92 ? "translateX(-100%)" : "translateX(0)",
            }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* Разброс финиша: усы от оптимистичной даты до реалистичной, точка на
          ожидаемой. Одна дата на её месте была бы псевдоточностью — буфер на
          пропуски встроен в расчёт. */}
      {spread && (
        <div className="relative mt-1 h-3" aria-hidden>
          <span
            className="absolute top-1/2 h-px -translate-y-1/2 bg-[#cfc6b8]"
            style={{
              left: `${spread[0].atPct}%`,
              width: `${Math.max(0, spread[1].atPct - spread[0].atPct)}%`,
            }}
          />
          {[spread[0], expected, spread[1]].map((mark, index) =>
            mark ? (
              <span
                key={`${mark.date}-${index}`}
                className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${mark.atPct}%`,
                  background: index === 1 ? "#8a5b24" : "#cfc6b8",
                }}
              />
            ) : null,
          )}
        </div>
      )}

      {/* ── Что всё это значит ───────────────────────────────────────────── */}
      <div className="mt-4 space-y-1.5 border-t border-[#e7e1d7] pt-3">
        {(expected || spread) && (
          <p className="text-[13px] leading-6 text-[#4a443d]">
            {spread
              ? `Закончите между ${formatShortDate(spread[0].date)} и ${formatShortDate(spread[1].date)}`
              : `Закончите ${formatPlanDate(expected?.date ?? null)}`}
            {expected && spread ? (
              <span className="text-[#8b8278]">
                {" "}
                · ожидаемо {formatShortDate(expected.date)}
              </span>
            ) : null}
          </p>
        )}

        {/* Срок обсуждается, только если его задавали: `null` в
            `desired_deadline_feasible` — это «не спрашивали», а не «не успеете». */}
        {feasible !== null && (
          <p className="text-[13px] leading-6 text-[#4a443d]">
            <span
              aria-hidden
              className="mr-1.5 inline-block h-2 w-px translate-y-[1px] bg-[#b0473e]"
            />
            {feasible
              ? `Успеваете к ${formatPlanDate(deadlineIso)}`
              : `К ${formatPlanDate(deadlineIso)} при таком темпе не выходит`}
            {advice && <span className="text-[#6f675e]"> {advice}</span>}
          </p>
        )}

        {path.milestones.length > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#8b8278]">
            {path.milestones.map((milestone) => (
              <span key={milestone.id}>
                <span aria-hidden className="mr-1.5 text-[#c3a163]">
                  ◆
                </span>
                {milestone.title}
                <span className="text-[#a1978b]"> · {milestone.moduleLabel}</span>
              </span>
            ))}
          </p>
        )}

        {forecast?.risk && (
          <p className="flex items-center gap-2 text-[11px] text-[#7f776e]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  forecast.risk === "low"
                    ? "#8a9a6b"
                    : forecast.risk === "medium"
                      ? "#c08a3e"
                      : "#b0673c",
              }}
            />
            {/* Точка риска всегда с текстовой подписью: цветом одним не говорим. */}
            {riskLabel(forecast.risk)}
          </p>
        )}

        {/* От книги остаётся строка, а не полоса: покрытие — метрика качества
            генератора, и герой экрана из неё выходил плохой. */}
        {bookLines.length > 0 && (
          <p className="text-[11px] leading-5 text-[#9b9186]">
            {bookLines.join(" ")}
          </p>
        )}

        {forecast && forecast.warnings.length > 0 && (
          <ul className="space-y-1 pt-1">
            {forecast.warnings.map((code) => (
              <li key={code} className="text-[11px] leading-5 text-[#8b7a5e]">
                {forecastWarningMessage(code)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function blockTitle(
  title: string,
  startDate: string | null,
  endDate: string | null,
): string {
  if (!startDate || !endDate) return title;
  return `${title} · ${formatShortDate(startDate)} — ${formatShortDate(endDate)}`;
}

function axisLabel(path: CoursePath, deadline: string | null): string {
  const parts = [`Курс из ${path.blocks.length} частей по времени`];
  if (path.finish.expected) {
    parts.push(`финиш ${formatPlanDate(path.finish.expected.date)}`);
  }
  if (deadline) {
    parts.push(
      path.overshootPct > 0
        ? `срок ${formatPlanDate(deadline)} — курс выходит за него`
        : `срок ${formatPlanDate(deadline)} — курс укладывается`,
    );
  }
  return `${parts.join(". ")}.`;
}
