// Шаблон расписания в CSV и обратно: для Excel и переноса между аккаунтами.

import { DAYS_ORDER, DAY_OF_WEEK_LABELS, type DayOfWeek } from "@/types/diary";

import type { SlotDraft, WeekDays } from "./week-template";

/** Ячейка CSV: кавычки удваиваются, значение с запятой или переносом берётся в кавычки. */
function csvCell(value: string): string {
  const text = String(value ?? "").replace(/"/g, '""');
  return /[,"\n\r]/.test(text) ? `"${text}"` : text;
}

export function exportTemplateCsv(
  name: string,
  week: WeekDays,
  subjectName: (id: string) => string | undefined,
  blockLabel: (slot: SlotDraft) => string,
): void {
  const rows = [["День", "№", "Начало", "Конец", "Тип", "Предмет / Название"].map(csvCell).join(",")];
  for (const day of DAYS_ORDER) {
    for (const slot of week[day]) {
      const isLesson = slot.blockType === "lesson";
      rows.push(
        [
          DAY_OF_WEEK_LABELS[day],
          String(slot.lessonNumber),
          slot.startTime,
          slot.endTime,
          slot.blockType,
          isLesson ? subjectName(slot.subjectId) ?? slot.subjectId : blockLabel(slot),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  // BOM, чтобы Excel открыл кириллицу.
  const blob = new Blob([`﻿${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|]/g, "_")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Строка CSV с учётом кавычек. */
function cellsOf(row: string): string[] {
  const cells: string[] = [];
  let index = 0;
  while (index < row.length) {
    if (row[index] === '"') {
      let value = "";
      index++;
      while (index < row.length) {
        if (row[index] === '"' && row[index + 1] === '"') {
          value += '"';
          index += 2;
        } else if (row[index] === '"') {
          index++;
          break;
        } else {
          value += row[index++];
        }
      }
      cells.push(value);
      if (row[index] === ",") index++;
    } else {
      const end = row.indexOf(",", index);
      if (end === -1) {
        cells.push(row.slice(index));
        break;
      }
      cells.push(row.slice(index, end));
      index = end + 1;
    }
  }
  return cells;
}

const DAY_KEYS: Record<string, DayOfWeek> = {
  ...Object.fromEntries(DAYS_ORDER.map((day) => [DAY_OF_WEEK_LABELS[day].toLowerCase(), day])),
  ...Object.fromEntries(DAYS_ORDER.map((day) => [day, day])),
};

export interface CsvRow {
  dayOfWeek: DayOfWeek;
  lessonNumber: number;
  startTime: string;
  endTime: string;
  blockType: string;
  rawName: string;
}

export function parseTemplateCsv(csv: string): CsvRow[] {
  const lines = csv
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = cellsOf(line);
    if (cells.length < 5) continue;
    const [dayRaw, numberRaw, start, end, type, name = ""] = cells;
    const day = DAY_KEYS[dayRaw.trim().toLowerCase()];
    if (!day) continue;
    rows.push({
      dayOfWeek: day,
      lessonNumber: parseInt(numberRaw, 10) || 1,
      startTime: start.trim(),
      endTime: end.trim(),
      blockType: type.trim() || "lesson",
      rawName: name.trim(),
    });
  }
  return rows;
}
