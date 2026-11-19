"use client";

// Что покажет мини-окно, прежде чем что-то поменять.
//
// Ответ помощника почти никогда не является конечным результатом. Результат — это
// список изменений, и решение ученик принимает по нему, а не по формулировке: поэтому
// он стоит отдельно от текста, а кнопок всегда две, «Применить» и «Не надо».

import { useMemo } from "react";

import { t } from "@/lib/i18n";
import { revisionRows } from "@/lib/now-feed";
import type { ScheduleRevision } from "@/lib/studyplan-api";
import { zonedDateKey } from "@/lib/studyplan-calendar";
import type {
  ParsedCommitment,
  ProposedStudyWindows,
} from "@/lib/studyplan-chat";
import { durationLabel } from "@/lib/studyplan-visuals";

import { groupWindows } from "./study-windows";

/** Сколько строк показать, прежде чем написать «и ещё»: окно должно оставаться коротким. */
const MAX_ROWS = 6;

/** Перенесённое и укороченное занятие приходит двумя строками, а читается одной. */
function mergeRows(rows: ReturnType<typeof revisionRows>) {
  const merged: typeof rows = [];
  for (const row of rows) {
    const blockId = row.id.slice(2);
    const moved = merged.find((item) => item.kind === "moved" && item.id.slice(2) === blockId);
    if (moved && (row.kind === "shortened" || row.kind === "extended")) {
      moved.to = `${moved.to}, ${row.to}`;
    } else {
      merged.push({ ...row });
    }
  }
  return merged;
}

export function RevisionCard({
  revision,
  timeZone,
  busy,
  hideActions = false,
  onDecide,
}: {
  revision: ScheduleRevision;
  timeZone: string;
  busy: boolean;
  /** Внутри общей карточки: кнопка там одна на всех. */
  hideActions?: boolean;
  onDecide: (revision: ScheduleRevision, accept: boolean) => void;
}) {
  const rows = useMemo(
    () => mergeRows(revisionRows(revision, zonedDateKey(new Date(), timeZone), timeZone)),
    [revision, timeZone],
  );

  if (rows.length === 0) {
    return (
      <>
        <p className="q-status">{t("Помощник ничего не переносит.")}</p>
        {hideActions ? null : (
          <div className="q-acts">
            <button className="btn btn-text" type="button" disabled={busy} onClick={() => onDecide(revision, false)}>
              {t("Закрыть")}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <ul className="q-diff" aria-label={t("Что изменится")}>
        {rows.slice(0, MAX_ROWS).map((row) => (
          <li key={row.id}>
            <span className="nm">{row.title}</span>
            <span className="chg">
              {row.from ? `${row.from} → ` : t("новое → ")}
              <b>{row.to || t("убрать")}</b>
            </span>
          </li>
        ))}
        {rows.length > MAX_ROWS ? (
          <li>
            <span className="nm">{t("И ещё {n}", { n: rows.length - MAX_ROWS })}</span>
          </li>
        ) : null}
      </ul>
      {hideActions ? null : (
        <div className="q-acts">
          <button className="btn btn-main" type="button" disabled={busy} onClick={() => onDecide(revision, true)}>
            {t("Применить")}
          </button>
          <button className="btn btn-text" type="button" disabled={busy} onClick={() => onDecide(revision, false)}>
            {t("Не надо")}
          </button>
        </div>
      )}
    </>
  );
}

export function CommitmentsCard({
  items,
  busy,
  hideActions = false,
  onAccept,
  onDismiss,
}: {
  items: ParsedCommitment[];
  busy: boolean;
  /** Внутри общей карточки: кнопка там одна на всех. */
  hideActions?: boolean;
  onAccept: (items: ParsedCommitment[]) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <p className="q-status">{t("Запишу как занятое время, занятия встанут вокруг него:")}</p>
      <ul className="q-diff">
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <span className="nm">{item.title}</span>
            <span className="chg">
              <b>
                {item.weekday_name
                  ? `${t(item.weekday_name)}, ${item.start_time}, ${durationLabel(item.duration_minutes ?? 0)}`
                  : t("разово")}
              </b>
            </span>
          </li>
        ))}
      </ul>
      {hideActions ? null : (
        <div className="q-acts">
          <button className="btn btn-main" type="button" disabled={busy} onClick={() => onAccept(items)}>
            {t("Записать")}
          </button>
          <button className="btn btn-text" type="button" disabled={busy} onClick={onDismiss}>
            {t("Не надо")}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Новый ритм: окна, внутри которых вообще могут стоять занятия.
 *
 * Отдельная карточка, а не разновидность переноса. Перенос двигает занятие внутри уже
 * объявленного времени, а здесь меняется само время, и это решение ученика о собственной
 * жизни. Поэтому карточка показывает, что было и что станет: заменить вечера утрами не то
 * же самое, что добавить утро к вечерам.
 */
export function StudyWindowsCard({
  proposal,
  busy,
  hideActions = false,
  onAccept,
  onDismiss,
}: {
  proposal: ProposedStudyWindows;
  busy: boolean;
  /** Внутри общей карточки: кнопка там одна на всех. */
  hideActions?: boolean;
  onAccept: (proposal: ProposedStudyWindows) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <p className="q-status">
        {proposal.replace ? t("Заменю время занятий:") : t("Добавлю время занятий:")}
      </p>
      <ul className="q-diff">
        {groupWindows(proposal.windows).map((line) => (
          <li key={line}>
            <span className="nm">{line}</span>
          </li>
        ))}
      </ul>
      {proposal.replace && proposal.current.length > 0 ? (
        <p className="q-cite">{t("Прежнее время уберу: {windows}.", { windows: groupWindows(proposal.current).join("; ") })}</p>
      ) : null}
      <p className="q-cite">{t("Занятия смогут вставать только в это время, а уже расставленные придётся переразложить.")}</p>
      {hideActions ? null : (
        <div className="q-acts">
          <button className="btn btn-main" type="button" disabled={busy} onClick={() => onAccept(proposal)}>
            {proposal.replace ? t("Заменить") : t("Добавить")}
          </button>
          <button className="btn btn-text" type="button" disabled={busy} onClick={onDismiss}>
            {t("Не надо")}
          </button>
        </div>
      )}
    </>
  );
}
