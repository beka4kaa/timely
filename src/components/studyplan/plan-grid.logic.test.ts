import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyDragOverride,
  applyRevisionPreview,
  blockFit,
  buildDeadlines,
  clock,
  clockRange,
  dayShort,
  fullDayLabel,
  GHOST_PREFIX,
  isOwnEvent,
  laneBox,
  lessonState,
  loadLabel,
  monthCells,
  monthTitle,
  movedStart,
  resizedDuration,
  slotStart,
  snapToStep,
  soonWhen,
  upcomingDeadlines,
} from "./plan-grid.logic.ts";

test("время без ведущего нуля, как в сетке", () => {
  assert.equal(clock(8 * 60), "8:00");
  assert.equal(clock(16 * 60 + 5), "16:05");
  assert.equal(clock(24 * 60), "0:00");
  assert.equal(clockRange(16 * 60 + 5, 30), "16:05–16:35");
});

test("нагрузка дня в шапке", () => {
  assert.equal(loadLabel(0), "свободно");
  assert.equal(loadLabel(45), "45 мин");
  assert.equal(loadLabel(60), "1 ч");
  assert.equal(loadLabel(75), "1 ч 15");
});

test("подписи дня и месяца", () => {
  assert.equal(dayShort("2026-11-03"), "вт");
  assert.equal(fullDayLabel("2026-11-03"), "Вторник, 3 ноября");
  assert.equal(monthTitle("2026-11-03"), "Ноябрь 2026");
});

test("месяц идёт целыми неделями с понедельника", () => {
  const cells = monthCells("2026-11-03");
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].dateKey, "2026-10-26");
  assert.equal(cells[0].out, true);
  assert.equal(cells[6].dateKey, "2026-11-01");
  assert.equal(cells[6].out, false);
  assert.equal(cells[cells.length - 1].dateKey, "2026-12-06");
  // Февраль 2027 начинается в понедельник и кончается в воскресенье: ровно 28 клеток.
  assert.equal(monthCells("2027-02-10").length, 28);
});

test("перенос идёт шагом пятнадцать минут и не выходит за сутки", () => {
  assert.equal(snapToStep(16 * 60 + 8), 16 * 60 + 15);
  assert.equal(movedStart(15 * 60, 37, 30), 15 * 60 + 30);
  assert.equal(movedStart(60, -500, 30), 0);
  assert.equal(movedStart(23 * 60, 300, 60), 23 * 60);
});

test("растягивание: шаг сетки, границы бэкенда и конец суток", () => {
  assert.equal(resizedDuration(30, 22, 15 * 60), 45);
  assert.equal(resizedDuration(30, -300, 15 * 60), 15);
  assert.equal(resizedDuration(60, 2000, 8 * 60), 480);
  assert.equal(resizedDuration(30, 300, 23 * 60), 60);
});

test("новое занятие начинается чуть выше курсора и помещается в сутки", () => {
  assert.equal(slotStart(15 * 60 + 10), 15 * 60);
  assert.equal(slotStart(15 * 60 + 20), 15 * 60 + 15);
  assert.equal(slotStart(0), 0);
  assert.equal(slotStart(24 * 60), 23 * 60 + 30);
});

test("строки названия считаются по высоте блока, как fit() в прототипе", () => {
  assert.deepEqual(blockFit(15), { lines: 1, hasTime: false, tiny: true });
  assert.deepEqual(blockFit(30), { lines: 2, hasTime: false, tiny: false });
  assert.deepEqual(blockFit(45), { lines: 2, hasTime: true, tiny: false });
  assert.deepEqual(blockFit(60), { lines: 3, hasTime: true, tiny: false });
  assert.deepEqual(blockFit(240), { lines: 4, hasTime: true, tiny: false });
  // В узкой дорожке время не поместится: всё место названию.
  assert.equal(blockFit(60, { lanes: 3 }).hasTime, false);
  assert.equal(blockFit(60, { lanes: 3 }).lines, 4);
});

test("дорожки не режутся дальше трёх", () => {
  assert.equal(laneBox(0, 1), null);
  assert.equal(laneBox(1, 2)?.left, "calc(50.000% + 2px)");
  const fourth = laneBox(3, 4);
  assert.equal(fourth?.left, "calc(66.667% + 8px)");
  assert.equal(fourth?.width, "calc(33.333% - 9px)");
});

const lesson = (status: string, startAt: string, minutes = 30, fixed = false) => ({
  status,
  fixed,
  start_at: startAt,
  duration_minutes: minutes,
});
const NOW = Date.parse("2026-11-05T12:00:00Z");

test("идущее сейчас, прошлое и будущее", () => {
  const running = lessonState(lesson("scheduled", "2026-11-05T11:50:00Z"), NOW);
  assert.equal(running.onNow, true);
  assert.equal(running.movable, false);
  // Мышью не тянется, но перенести через помощника можно: ещё не начато.
  assert.equal(running.reschedulable, true);

  const past = lessonState(lesson("scheduled", "2026-11-05T10:00:00Z"), NOW);
  assert.equal(past.past, true);
  // Прошло, но не сделано: занятие ещё можно поставить на другое время.
  assert.equal(past.movable, true);

  const future = lessonState(lesson("scheduled", "2026-11-05T15:00:00Z"), NOW);
  assert.deepEqual(future, {
    past: false,
    onNow: false,
    done: false,
    missed: false,
    reschedulable: true,
    movable: true,
  });
});

test("сервер не примет перенос сделанного и закреплённого: сетка и не пробует", () => {
  assert.equal(lessonState(lesson("completed", "2026-11-05T15:00:00Z"), NOW).movable, false);
  assert.equal(lessonState(lesson("completed", "2026-11-05T15:00:00Z"), NOW).past, true);
  assert.equal(lessonState(lesson("in_progress", "2026-11-05T15:00:00Z"), NOW).onNow, true);
  assert.equal(lessonState(lesson("in_progress", "2026-11-05T15:00:00Z"), NOW).reschedulable, false);
  assert.equal(lessonState(lesson("scheduled", "2026-11-05T15:00:00Z", 30, true), NOW).movable, false);
  assert.equal(lessonState(lesson("missed", "2026-11-05T09:00:00Z"), NOW).missed, true);
});

test("свой блок: только разовая ручная запись без вида", () => {
  const own = { kind: "other", source: "manual", weekday: null, start_at: "2026-11-05T10:00:00Z", end_at: "2026-11-05T10:30:00Z" };
  assert.equal(isOwnEvent(own), true);
  assert.equal(isOwnEvent({ ...own, source: "chat" }), false);
  assert.equal(isOwnEvent({ ...own, kind: "tutor" }), false);
  assert.equal(isOwnEvent({ ...own, weekday: 2 }), false);
});

const entry = (id: string, start: string, minutes: number) => ({
  id,
  title: `Занятие ${id}`,
  start_at: start,
  end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
  duration_minutes: minutes,
});
const span = (start: string, minutes: number) => ({
  start_at: start,
  end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
  duration_minutes: minutes,
});

test("предпросмотр: перенос оставляет старое место и рисует новое", () => {
  const a = entry("a", "2026-11-05T10:00:00.000Z", 30);
  const preview = applyRevisionPreview([a], {
    moved: [{ block_id: "a", title: "A", from: span(a.start_at, 30), to: span("2026-11-06T10:00:00.000Z", 30) }],
  });
  assert.deepEqual(Array.from(preview.leaving), ["a"]);
  assert.deepEqual(Array.from(preview.ghosts), [`${GHOST_PREFIX}a`]);
  assert.equal(preview.entries.length, 2);
  assert.equal(preview.entries[1].start_at, "2026-11-06T10:00:00.000Z");
});

test("предпросмотр: укорочение меняет длину на месте, а перенесённое не дублируется", () => {
  const a = entry("a", "2026-11-05T10:00:00.000Z", 30);
  const b = entry("b", "2026-11-05T12:00:00.000Z", 60);
  const preview = applyRevisionPreview([a, b], {
    moved: [{ block_id: "b", title: "B", from: span(b.start_at, 60), to: span("2026-11-05T15:00:00.000Z", 30) }],
    shortened: [
      { block_id: "a", title: "A", from: span(a.start_at, 30), to: span(a.start_at, 15) },
      { block_id: "b", title: "B", from: span(b.start_at, 60), to: span("2026-11-05T15:00:00.000Z", 30) },
    ],
  });
  assert.deepEqual(Array.from(preview.resizing), ["a"]);
  assert.equal(preview.entries.find((item) => item.id === "a")?.duration_minutes, 15);
  assert.equal(preview.entries.find((item) => item.id === "b")?.duration_minutes, 60);
  assert.equal(preview.entries.find((item) => item.id === `${GHOST_PREFIX}b`)?.duration_minutes, 30);
});

test("предпросмотр: занятие с другой недели собирается из самого предложения", () => {
  const preview = applyRevisionPreview<ReturnType<typeof entry>>([], {
    moved: [
      {
        block_id: "far",
        title: "С другой недели",
        from: span("2026-10-01T10:00:00.000Z", 30),
        to: span("2026-11-05T10:00:00.000Z", 30),
      },
    ],
  });
  assert.equal(preview.leaving.size, 0);
  assert.equal(preview.entries[0].title, "С другой недели");
});

test("без предложения сетка та же", () => {
  const a = entry("a", "2026-11-05T10:00:00.000Z", 30);
  const preview = applyRevisionPreview([a], null);
  assert.deepEqual(preview.entries, [a]);
  assert.equal(preview.ghosts.size, 0);
});

test("перетаскивание: блок стоит там, куда его поставили, с новой длиной и концом", () => {
  const a = entry("a", "2026-11-05T10:00:00.000Z", 30);
  const [moved] = applyDragOverride([a], {
    id: "a",
    startAt: "2026-11-06T11:00:00.000Z",
    durationMinutes: 45,
  });
  assert.equal(moved.start_at, "2026-11-06T11:00:00.000Z");
  assert.equal(moved.end_at, "2026-11-06T11:45:00.000Z");
  assert.equal(moved.duration_minutes, 45);
  assert.deepEqual(applyDragOverride([a], null), [a]);
});

test("сроки: контрольные, цели, контесты и экзамены по порядку", () => {
  const list = buildDeadlines({
    timeZone: "UTC",
    tests: [{ dateKey: "2026-11-06", title: "СОР по физике" }],
    goals: [
      { id: 1, title: "Итоговые", status: "active", endDate: "2027-05-25" },
      { id: 2, title: "Уже сделано", status: "done", endDate: "2026-11-07" },
      { id: 3, title: "Без срока", status: "active" },
    ],
    contests: [{ id: 505, title: "Контест 505", start_time: "2026-11-07T11:00:00Z" }],
    exams: [{ id: "e", title: "Пробный", start_at: "2026-11-06T09:00:00Z" }],
  });
  assert.deepEqual(
    list.map((item) => item.title),
    ["СОР по физике", "Пробный", "Контест 505", "Итоговые"],
  );
  assert.equal(list[2].minutes, 11 * 60);
  assert.equal(list[0].minutes, null);
});

test("«Скоро» показывает только то, что впереди", () => {
  const list = buildDeadlines({
    timeZone: "UTC",
    tests: [
      { dateKey: "2026-11-02", title: "Прошла" },
      { dateKey: "2026-11-05", title: "Сегодня" },
    ],
    contests: [
      { id: 1, title: "Утренний", start_time: "2026-11-05T08:00:00Z" },
      { id: 2, title: "Вечерний", start_time: "2026-11-05T20:00:00Z" },
    ],
  });
  assert.deepEqual(
    upcomingDeadlines(list, "2026-11-05", 12 * 60).map((item) => item.title),
    ["Сегодня", "Вечерний"],
  );
});

test("когда: сегодня, завтра, в этот день недели или дата", () => {
  const today = "2026-11-03";
  assert.equal(soonWhen({ dateKey: today, minutes: null }, today), "сегодня");
  assert.equal(soonWhen({ dateKey: "2026-11-04", minutes: 600 }, today), "завтра, в 10:00");
  assert.equal(soonWhen({ dateKey: "2026-11-06", minutes: null }, today), "в пятницу, 6 ноября");
  assert.equal(soonWhen({ dateKey: "2026-11-07", minutes: 660 }, today), "в субботу, в 11:00");
  assert.equal(soonWhen({ dateKey: "2027-05-25", minutes: null }, today), "25 мая");
});
