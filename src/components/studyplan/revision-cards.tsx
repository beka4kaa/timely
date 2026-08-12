"use client";

// Карточки решения помощника: что изменится и что записать как занятое время.
//
// Ответ помощника почти никогда не является конечным результатом. Результат —
// это diff, и он показывается отдельно от текста, потому что решение ученик
// принимает по нему, а не по формулировке.
//
// Вынесены из панели «Помощник», которая жила в правой колонке «Плана»: сам
// разговор переехал в панель справа (`tutor-rail/schedule-rail.tsx`), а вид
// карточек остался прежним — он уже свёрстан под колонку такой ширины.

import {
  paperButton,
  paperCaption,
  paperPrimaryButton,
  paperTile,
} from "@/components/curriculum/paper";
import type { ScheduleRevision } from "@/lib/studyplan-api";
import type {
  ParsedCommitment,
  ProposedStudyWindows,
} from "@/lib/studyplan-chat";

import { groupWindows } from "./study-windows";
import { durationLabel } from "@/lib/studyplan-visuals";

export function RevisionCard({
  revision,
  timeZone,
  busy,
  onDecide,
}: {
  revision: ScheduleRevision;
  timeZone: string;
  busy: boolean;
  onDecide: (revision: ScheduleRevision, accept: boolean) => void;
}) {
  const moved = revision.diff?.moved ?? [];
  const shortened = revision.diff?.shortened ?? [];
  const format = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <div className={`${paperTile} px-3 py-2.5`}>
      <div className={paperCaption}>Что изменится</div>

      {moved.length === 0 && shortened.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-[#7b7168]">
          Помощник ничего не переносит.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[#4a443d]">
          {moved.slice(0, 6).map((entry) => (
            <li key={`m-${entry.block_id}`}>
              <span className="font-medium">{entry.title}</span>
              <br />
              <span className="tabular-nums text-[#7b7168]">
                {format(entry.from.start_at)} → {format(entry.to.start_at)}
              </span>
            </li>
          ))}
          {moved.length > 6 ? (
            <li className="text-[#7b7168]">…и ещё {moved.length - 6}</li>
          ) : null}
          {shortened.map((entry) => (
            <li key={`s-${entry.block_id}`} className="text-[#7b7168]">
              {entry.title}: {durationLabel(entry.from.duration_minutes)} →{" "}
              {durationLabel(entry.to.duration_minutes)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className={paperPrimaryButton}
          disabled={busy}
          onClick={() => onDecide(revision, true)}
        >
          Применить
        </button>
        <button
          type="button"
          className={paperButton}
          disabled={busy}
          onClick={() => onDecide(revision, false)}
        >
          Не надо
        </button>
      </div>
    </div>
  );
}

export function CommitmentsCard({
  items,
  busy,
  onAccept,
  onDismiss,
}: {
  items: ParsedCommitment[];
  busy: boolean;
  onAccept: (items: ParsedCommitment[]) => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`${paperTile} px-3 py-2.5`}>
      <div className={paperCaption}>Записать как занятое время</div>
      <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[#4a443d]">
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <span className="font-medium">{item.title}</span>{" "}
            <span className="text-[#7b7168]">
              {item.weekday_name
                ? `— ${item.weekday_name}, ${item.start_time}, ${durationLabel(
                    item.duration_minutes ?? 0,
                  )}`
                : "— разово"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#7b7168]">
        Планировщик перестанет ставить занятия в это время.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className={paperPrimaryButton}
          disabled={busy}
          onClick={() => onAccept(items)}
        >
          Записать
        </button>
        <button type="button" className={paperButton} disabled={busy} onClick={onDismiss}>
          Не надо
        </button>
      </div>
    </div>
  );
}

/**
 * Новый ритм: окна, внутри которых вообще могут стоять занятия.
 *
 * Отдельная карточка, а не разновидность переноса. Перенос двигает занятие
 * внутри уже объявленного времени, а здесь меняется само время — и это решение
 * ученика о собственной жизни, а не деталь расписания. Поэтому карточка
 * показывает, что было и что станет: заменить вечера утрами — не то же самое,
 * что добавить утро к вечерам.
 */
export function StudyWindowsCard({
  proposal,
  busy,
  onAccept,
  onDismiss,
}: {
  proposal: ProposedStudyWindows;
  busy: boolean;
  onAccept: (proposal: ProposedStudyWindows) => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`${paperTile} px-3 py-2.5`}>
      <div className={paperCaption}>
        {proposal.replace ? "Заменить время занятий" : "Добавить время занятий"}
      </div>
      <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[#4a443d]">
        {groupWindows(proposal.windows).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {proposal.replace && proposal.current.length > 0 ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-[#7b7168]">
          Прежнее время уберём: {groupWindows(proposal.current).join("; ")}.
        </p>
      ) : null}
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#7b7168]">
        Занятия смогут вставать только в это время. Уже расставленные придётся
        переразложить.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className={paperPrimaryButton}
          disabled={busy}
          onClick={() => onAccept(proposal)}
        >
          {proposal.replace ? "Заменить" : "Добавить"}
        </button>
        <button type="button" className={paperButton} disabled={busy} onClick={onDismiss}>
          Не надо
        </button>
      </div>
    </div>
  );
}
