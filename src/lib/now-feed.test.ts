import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDay,
  closedByRejecting,
  attachLabel,
  criterionText,
  dayHeading,
  dayPhrase,
  dayShortLabel,
  daySummary,
  homeworkOf,
  homeworkTitle,
  lessonGrade,
  longDateLabel,
  mergeListRequests,
  missedBlocks,
  nextContest,
  nextSchoolDay,
  partLabel,
  pickPresetIndex,
  plural,
  relativeDayLabel,
  relativeStamp,
  revisionRows,
  shortDateLabel,
  splitBlockTitle,
  upcomingTests,
  weekStrip,
  workspaceOf,
} from "./now-feed.ts";
import type { CalendarLearningBlock, ScheduleRevision } from "./studyplan-api.ts";
import type { DiaryLesson } from "../types/diary.ts";

const TZ = "UTC";
const NOW = new Date("2026-11-03T16:12:00Z"); // вторник

function block(
  id: string,
  start: string,
  minutes: number,
  overrides: Partial<CalendarLearningBlock> = {},
): CalendarLearningBlock {
  const startAt = new Date(start);
  return {
    id,
    title: `Тема ${id} — практика`,
    start_at: startAt.toISOString(),
    end_at: new Date(startAt.getTime() + minutes * 60_000).toISOString(),
    duration_minutes: minutes,
    activity_type: "independent_practice",
    status: "scheduled",
    fixed: false,
    detail_level: "detailed",
    source: "generated",
    topic: null,
    review_step: null,
    schedule: "s1",
    course_plan: "p1",
    module: null,
    workspace_type: "smart_board",
    priority: 0,
    lesson_payload: {},
    mastery_criteria: "",
    source_section_ids: [],
    source_chunk_ids: [],
    prerequisite_block_ids: [],
    review_of_topic: null,
    version: 1,
    schedule_version: 1,
    schedule_status: "active",
    schedule_timezone: TZ,
    course_plan_title: "Физика 9",
    ...overrides,
  } as CalendarLearningBlock;
}

function lesson(
  id: string,
  startTime: string,
  endTime: string,
  overrides: Partial<DiaryLesson> = {},
): DiaryLesson {
  return {
    id,
    lessonNumber: 1,
    startTime,
    endTime,
    subjectId: "subject",
    subjectName: "Алгебра",
    subjectEmoji: "",
    subjectColor: "#6366f1",
    grades: { retelling: null, exercises: null, test: null },
    homework: "",
    notes: "",
    ...overrides,
  };
}

const SCHOOL = [
  lesson("l1", "08:00", "08:45", { grades: { retelling: null, exercises: 5, test: null } }),
  lesson("l2", "08:55", "09:40", { subjectName: "Физика" }),
  lesson("brk", "09:40", "09:50", { blockType: "break" }),
  lesson("l3", "12:45", "13:30", { subjectName: "Казахский язык" }),
];

const DAY_BLOCKS = [
  block("theory", "2026-11-03T15:30:00Z", 25),
  block("now", "2026-11-03T16:05:00Z", 30),
  block("review", "2026-11-03T16:45:00Z", 20, { activity_type: "review" }),
  block("check", "2026-11-03T17:15:00Z", 30, { fixed: true }),
  block("cancelled", "2026-11-03T18:00:00Z", 30, { status: "cancelled" }),
  block("evening", "2026-11-03T19:00:00Z", 30),
];

test("склоняет числительные", () => {
  assert.equal(plural(1, ["занятие", "занятия", "занятий"]), "занятие");
  assert.equal(plural(3, ["занятие", "занятия", "занятий"]), "занятия");
  assert.equal(plural(5, ["занятие", "занятия", "занятий"]), "занятий");
  assert.equal(plural(12, ["занятие", "занятия", "занятий"]), "занятий");
  assert.equal(plural(21, ["занятие", "занятия", "занятий"]), "занятие");
});

test("отделяет вид занятия от темы, но не режет чужие тире", () => {
  assert.deepEqual(splitBlockTitle("Равноускоренное движение — практика с разбором"), {
    topic: "Равноускоренное движение",
    detail: "практика с разбором",
  });
  assert.deepEqual(splitBlockTitle("Квадратные неравенства — практика 1/2"), {
    topic: "Квадратные неравенства",
    detail: "практика 1/2",
  });
  assert.equal(partLabel("практика 1/2"), "часть 1 из 2");
  assert.deepEqual(splitBlockTitle("Глава 2 — Динамика"), {
    topic: "Глава 2 — Динамика",
    detail: "",
  });
});

test("идущий блок становится шагом, прошлое уходит назад, впереди — окна", () => {
  const day = buildDay({ now: NOW, timeZone: TZ, lessons: SCHOOL, blocks: DAY_BLOCKS });

  assert.equal(day.state, "now");
  assert.equal(day.hero?.block.id, "now");
  assert.equal(day.hero?.minutesLeft, 23);
  assert.ok(Math.abs((day.hero?.progress ?? 0) - 7 / 30) < 1e-9);

  assert.deepEqual(
    day.past.map((entry) => entry.kind),
    ["school", "block"],
  );
  assert.deepEqual(
    day.future.map((entry) =>
      entry.kind === "block" ? entry.block.id : entry.kind === "free" ? `free:${entry.minutes}` : entry.kind,
    ),
    ["review", "check", "free:75", "evening"],
  );
  // Отменённый блок не попадает ни в ленту, ни в сумму.
  assert.equal(day.blocks.length, 5);
  assert.equal(day.plannedMinutes, 135);
});

test("строка о дне называет объём, прошедшее и то, что идёт", () => {
  const day = buildDay({ now: NOW, timeZone: TZ, lessons: SCHOOL, blocks: DAY_BLOCKS });
  const summary = daySummary(day);
  assert.equal(
    `${summary.lead} ${summary.total}${summary.tail}`,
    "Сегодня 5\u00a0занятий\u00a0на\u00a02\u00a0ч\u00a015\u00a0мин. Одно уже позади, сейчас — Физика 9.",
  );
});

test("между занятиями шаг — ближайшее, а то, что раньше него, стоит перед ним", () => {
  const now = new Date("2026-11-03T14:00:00Z");
  const day = buildDay({
    now,
    timeZone: TZ,
    lessons: [],
    blocks: [block("later", "2026-11-03T16:45:00Z", 20)],
    busy: [{ id: "swim", title: "Плавание", kind: "other", start: 15 * 60, end: 16 * 60 + 30 }],
  });
  assert.equal(day.state, "next");
  assert.equal(day.hero?.minutesUntil, 165);
  assert.deepEqual(
    day.beforeHero.map((entry) => entry.kind),
    ["busy"],
  );
  assert.equal(day.future.length, 0);
  const summary = daySummary(day);
  assert.equal(summary.tail, ". Следующее в 16:45.");
});

test("во время уроков школа идёт сейчас и знает текущий урок", () => {
  const now = new Date("2026-11-03T09:00:00Z");
  const day = buildDay({ now, timeZone: TZ, lessons: SCHOOL, blocks: DAY_BLOCKS });
  assert.equal(day.state, "next");
  assert.equal(day.hero?.block.id, "theory");
  const school = day.current.find((entry) => entry.kind === "school");
  assert.ok(school && school.kind === "school");
  assert.equal(school.school.currentId, "l2");
  // Перемена — не урок.
  assert.equal(school.school.lessons.length, 3);
  assert.equal(school.school.graded, 1);
});

test("день без занятий и закончившийся день различаются", () => {
  const empty = buildDay({ now: NOW, timeZone: TZ, lessons: [], blocks: [] });
  assert.equal(empty.state, "empty");
  assert.equal(daySummary(empty).total, "занятий по плану нет");

  const late = new Date("2026-11-03T21:00:00Z");
  const done = buildDay({ now: late, timeZone: TZ, lessons: [], blocks: DAY_BLOCKS });
  assert.equal(done.state, "done");
  assert.equal(done.hero, null);
  assert.equal(daySummary(done).tail, " — на сегодня всё.");
});

test("без отметки — только открытые незакреплённые блоки прошлых дней, свежие сверху", () => {
  const blocks = [
    block("old", "2026-10-29T15:00:00Z", 30),
    block("older", "2026-10-28T15:00:00Z", 30),
    block("done", "2026-10-30T15:00:00Z", 30, { status: "completed" }),
    block("moved", "2026-10-30T16:00:00Z", 30, { status: "rescheduled" }),
    block("pinned", "2026-10-30T17:00:00Z", 30, { fixed: true }),
    block("today", "2026-11-03T08:00:00Z", 30),
  ];
  assert.deepEqual(
    missedBlocks(blocks, "2026-11-03", TZ).map((item) => item.id),
    ["old", "older"],
  );
});

test("домашнее задание берётся из уроков дня по порядку", () => {
  const items = homeworkOf([
    lesson("b", "10:00", "10:45", { subjectName: "Химия", homework: " §8, конспект " }),
    lesson("a", "08:00", "08:45", { subjectName: "Геометрия", homework: "№ 245, 247" }),
    lesson("c", "11:00", "11:45", { subjectName: "История", homework: "" }),
  ]);
  assert.deepEqual(
    items.map((item) => `${item.subject}: ${item.text}`),
    ["Геометрия: № 245, 247", "Химия: §8, конспект"],
  );
});

test("сделанное в дневнике задание на главной больше не ждёт", () => {
  const items = homeworkOf([
    lesson("a", "08:00", "08:45", { subjectName: "Геометрия", homework: "№ 245" }),
    lesson("b", "09:00", "09:45", { subjectName: "Химия", homework: "§8", homeworkDone: true }),
  ]);
  assert.deepEqual(items.map((item) => item.subject), ["Геометрия"]);
});

test("тест считается поводом готовиться, пока он впереди", () => {
  const days = [
    {
      date: "2026-11-03",
      lessons: [lesson("t0", "09:50", "10:35", { blockType: "test", blockLabel: "СОР по алгебре" })],
    },
    {
      date: "2026-11-06",
      lessons: [lesson("t1", "09:50", "10:35", { blockType: "test", blockLabel: "СОР по физике" })],
    },
    {
      date: "2026-11-09",
      lessons: [lesson("t2", "09:50", "10:35", { blockType: "test" })],
    },
  ];
  const tests = upcomingTests(days, "2026-11-03", 16 * 60 + 12);
  assert.deepEqual(
    tests.map((item) => `${item.title}:${item.inDays}`),
    ["СОР по физике:3"],
  );
});

test("неделя показывает нагрузку относительно пика и отметку теста", () => {
  const days = ["2026-11-02", "2026-11-03", "2026-11-04"];
  const strip = weekStrip(
    days,
    [
      block("a", "2026-11-02T15:00:00Z", 60),
      block("b", "2026-11-03T15:00:00Z", 120),
      block("x", "2026-11-03T18:00:00Z", 60, { status: "cancelled" }),
    ],
    [{ date: "2026-11-04", lessons: [lesson("t", "09:00", "09:45", { blockType: "test", blockLabel: "СОР" })] }],
    "2026-11-03",
    TZ,
  );
  assert.deepEqual(
    strip.map((day) => [day.weekday, day.day, day.ratio, day.test, day.isToday]),
    [
      ["пн", 2, 0.5, null, false],
      ["вт", 3, 1, null, true],
      ["ср", 4, 0, "СОР", false],
    ],
  );
});

test("изменение плана читается словами: день и время, было → стало", () => {
  const revision = {
    id: "r1",
    status: "proposed",
    created_at: "2026-11-03T16:00:00Z",
    diff: {
      moved: [
        {
          block_id: "b1",
          title: "Законы Ньютона — проверка",
          from: { start_at: "2026-11-03T17:15:00Z", end_at: "", duration_minutes: 30 },
          to: { start_at: "2026-11-04T16:30:00Z", end_at: "", duration_minutes: 30 },
        },
      ],
      shortened: [
        {
          block_id: "b2",
          title: "Сложноподчинённые предложения",
          from: { start_at: "", end_at: "", duration_minutes: 30 },
          to: { start_at: "", end_at: "", duration_minutes: 15 },
        },
      ],
      created: [],
      removed: [],
      extended: [],
    },
  } as unknown as ScheduleRevision;
  assert.deepEqual(
    revisionRows(revision, "2026-11-03", TZ).map((row) => `${row.from} → ${row.to}`),
    ["сегодня 17:15 → завтра 16:30", "30 мин → 15 мин"],
  );
});

test("ритм фокуса подбирается под остаток блока", () => {
  const presets = [{ focus: 25 }, { focus: 50 }, { focus: 60 }, { focus: 90 }, { focus: 45 }];
  assert.equal(pickPresetIndex(23, presets), 0);
  assert.equal(pickPresetIndex(48, presets), 1);
  assert.equal(pickPresetIndex(42, presets), 4);
  assert.equal(pickPresetIndex(200, presets), 3);
  assert.equal(pickPresetIndex(5, presets), 0);
});

test("критерий остаётся предложением, как его написал план", () => {
  assert.equal(
    criterionText("  Решает 3 задачи на v = v₀ + at без подсказок. "),
    "Решает 3 задачи на v = v₀ + at без подсказок",
  );
});

test("день во фразе — с предлогом и в нужном падеже", () => {
  assert.equal(dayPhrase("2026-11-03", "2026-11-03"), "сегодня");
  assert.equal(dayPhrase("2026-11-04", "2026-11-03"), "завтра");
  assert.equal(dayPhrase("2026-11-06", "2026-11-03"), "в пятницу");
  assert.equal(dayPhrase("2026-11-03", "2026-10-31"), "во вторник");
  assert.equal(dayPhrase("2026-11-20", "2026-11-03"), "20 ноября");
  assert.equal(dayShortLabel("2026-11-04"), "4\u00a0нояб.");
  assert.equal(dayHeading("2026-11-04", "2026-11-03"), "Завтра");
  assert.equal(dayHeading("2026-11-06", "2026-11-03"), "В пятницу");
  assert.equal(homeworkTitle("2026-11-04", "2026-11-03"), "К завтра");
  assert.equal(homeworkTitle("2026-11-09", "2026-11-06"), "К понедельнику");
  assert.equal(homeworkTitle("2026-11-10", "2026-11-06"), "Ко вторнику");
  assert.equal(homeworkTitle("2026-11-11", "2026-11-06"), "К среде");
});

test("подпись шага для мини-окна: тема, день и время", () => {
  assert.equal(
    attachLabel("Равноускоренное движение", "2026-11-03", 16 * 60 + 5),
    "Равноускоренное движение, вт 16:05",
  );
});

test("шаг с доской ведёт в чат по той же теме, пока доска выключена", () => {
  const board = { course_plan: "p1", workspace_type: "smart_board" };
  const off = workspaceOf(board, "Импульс", false);
  assert.equal(off.label, "Открыть чат");
  assert.ok(off.href.startsWith("/dashboard/chat?q="));
  assert.ok(decodeURIComponent(off.href).includes("«Импульс»"));
  assert.deepEqual(workspaceOf(board, "Импульс", true), {
    label: "Открыть доску",
    href: "/dashboard/whiteboard",
  });
});

test("остальные шаги ведут туда, где занятие и проходит, с доской и без", () => {
  for (const boardEnabled of [true, false]) {
    assert.equal(
      workspaceOf({ course_plan: "p1", workspace_type: "tutor_chat" }, "Импульс", boardEnabled).label,
      "Начать с тьютором",
    );
    assert.deepEqual(
      workspaceOf({ course_plan: "p1", workspace_type: "book_reader" }, "Импульс", boardEnabled),
      { label: "Открыть книгу", href: "/dashboard/curriculum/plan/p1" },
    );
    assert.deepEqual(
      workspaceOf({ course_plan: "p1", workspace_type: "answer_form" }, "Импульс", boardEnabled),
      { label: "Открыть программу", href: "/dashboard/curriculum/plan/p1" },
    );
  }
});

test("контест: идущий важнее будущего, а дальний и прошедший не показываем", () => {
  const contest = (id: number, start: string, end: string) => ({
    id,
    title: `Контест ${id}`,
    start_time: start,
    end_time: end,
  });
  const past = contest(1, "2026-11-01T10:00:00Z", "2026-11-01T11:30:00Z");
  const soon = contest(2, "2026-11-07T11:00:00Z", "2026-11-07T12:30:00Z");
  const later = contest(3, "2026-11-20T11:00:00Z", "2026-11-20T12:30:00Z");
  const running = contest(4, "2026-11-03T16:00:00Z", "2026-11-03T17:30:00Z");

  assert.deepEqual(nextContest([later, past, soon], NOW, TZ), {
    id: 2,
    title: "Контест 2",
    running: false,
    dateKey: "2026-11-07",
    minutes: 11 * 60,
  });
  assert.equal(nextContest([soon, running], NOW, TZ)?.id, 4);
  assert.equal(nextContest([soon, running], NOW, TZ)?.running, true);
  assert.equal(nextContest([past, later], NOW, TZ), null);
  assert.equal(nextContest([], NOW, TZ), null);
});

test("следующий учебный день пропускает выходные", () => {
  const days = [
    { date: "2026-11-06", lessons: [lesson("f", "08:00", "08:45")] },
    { date: "2026-11-07", lessons: [] },
    { date: "2026-11-08", lessons: [lesson("brk", "10:00", "10:15", { blockType: "break" })] },
    { date: "2026-11-09", lessons: [lesson("m", "08:00", "08:45")] },
  ];
  assert.equal(nextSchoolDay(days, "2026-11-06")?.date, "2026-11-09");
  assert.equal(nextSchoolDay(days, "2026-11-09"), null);
});

test("даты и метки времени по-русски", () => {
  assert.equal(longDateLabel("2026-11-03"), "Вторник, 3 ноября");
  assert.equal(shortDateLabel("2026-11-03"), "Вт, 3 ноября");
  assert.equal(relativeDayLabel("2026-11-04", "2026-11-03"), "завтра");
  assert.equal(relativeDayLabel("2026-11-06", "2026-11-03"), "пт");
  assert.equal(relativeDayLabel("2026-10-12", "2026-11-03"), "12 окт.");
  assert.equal(relativeStamp("2026-11-03T15:58:00Z", NOW, TZ), "сегодня, 15:58");
  assert.equal(relativeStamp("2026-11-02T21:14:00Z", NOW, TZ), "вчера, 21:14");
  assert.equal(relativeStamp("2026-10-30T10:00:00Z", NOW, TZ), "пт, 10:00");
});

function proposal(id: string, schedule: string, baseVersion: number, createdAt: string) {
  return {
    id,
    schedule,
    base_version: baseVersion,
    created_at: createdAt,
  } as unknown as ScheduleRevision;
}

test("отказ закрывает само предложение и более старые той же версии", () => {
  const declined = proposal("b", "физика", 3, "2026-11-03T10:00:00Z");
  const closed = closedByRejecting(declined);
  assert.equal(closed(declined), true);
  assert.equal(closed(proposal("a", "физика", 3, "2026-11-03T09:00:00Z")), true);
});

test("отказ не трогает более свежие, другие версии и другие расписания", () => {
  const closed = closedByRejecting(proposal("b", "физика", 3, "2026-11-03T10:00:00Z"));
  assert.equal(closed(proposal("c", "физика", 3, "2026-11-03T11:00:00Z")), false);
  assert.equal(closed(proposal("a", "физика", 2, "2026-11-03T09:00:00Z")), false);
  assert.equal(closed(proposal("z", "алгебра", 3, "2026-11-03T09:00:00Z")), false);
});

test("упавший запрос не прячет ответы остальных", async () => {
  const merged = await mergeListRequests([
    Promise.resolve(["физика"]),
    Promise.reject(new Error("500")),
    Promise.resolve(["алгебра", "русский"]),
  ]);
  assert.deepEqual(merged, ["физика", "алгебра", "русский"]);
});

test("упали все запросы — это ошибка, а не пустой список", async () => {
  const first = new Error("нет сети");
  await assert.rejects(
    mergeListRequests([Promise.reject(first), Promise.reject(new Error("нет сети"))]),
    (error) => error === first,
  );
});

test("пустой ответ — не сбой", async () => {
  assert.deepEqual(
    await mergeListRequests([Promise.resolve([]), Promise.reject(new Error("500"))]),
    [],
  );
  assert.deepEqual(await mergeListRequests([]), []);
});

test("оценка строки зависит от вида блока", () => {
  const grades = { retelling: 3, exercises: 5, test: 4 } as const;
  assert.equal(lessonGrade({ grades, blockType: undefined }), 5);
  assert.equal(lessonGrade({ grades, blockType: "feynman" }), 3);
  assert.equal(lessonGrade({ grades, blockType: "test" }), 4);
});

test("зона ученика задаёт «сегодня» и минуты", () => {
  // 20:30 UTC — уже 01:30 следующего дня в Ташкенте (+05).
  const late = new Date("2026-11-03T20:30:00Z");
  const day = buildDay({
    now: late,
    timeZone: "Asia/Tashkent",
    lessons: [],
    blocks: [block("morning", "2026-11-04T03:00:00Z", 30)],
  });
  assert.equal(day.dateKey, "2026-11-04");
  assert.equal(day.nowMinutes, 90);
  assert.equal(day.hero?.block.id, "morning");
  assert.equal(day.hero?.mode, "next");
});
