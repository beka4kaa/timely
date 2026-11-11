import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DueMark } from "../components/mind/due-mark";
import {
  buildDrafts,
  coverOf,
  dayDiff,
  draftHasSubject,
  dueTopics,
  findSubject,
  firstReviewFields,
  isDue,
  lastTimeLabel,
  nearestTopic,
  topicsInGroup,
  reviewGroup,
  scheduleOf,
  subjectsToRemove,
  type WeakTopic,
  whenLabel,
  exactSubject,
} from "./weak-topics";

// 5 ноября 2026 — четверг.
const NOW = new Date(2026, 10, 5, 14, 0, 0);
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

function topic(overrides: Partial<WeakTopic> & { id: string }): WeakTopic {
  return {
    name: overrides.id,
    status: "MEDIUM",
    archived: false,
    subject: "phys",
    subjectName: "Физика",
    lastRevisedAt: null,
    nextReviewAt: null,
    intervalDays: null,
    easeFactor: 2.5,
    ...overrides,
  };
}

test("dayDiff считает календарные дни, а не сутки", () => {
  assert.equal(dayDiff(NOW, new Date(2026, 10, 5, 23, 59)), 0);
  assert.equal(dayDiff(NOW, new Date(2026, 10, 6, 0, 1)), 1);
  assert.equal(dayDiff(NOW, new Date(2026, 10, 4, 23, 59)), -1);
});

test("группа зависит от дня повторения", () => {
  assert.equal(reviewGroup(null, NOW), "none");
  assert.equal(reviewGroup(at(4), NOW), "late");
  assert.equal(reviewGroup(at(5, 23), NOW), "today");
  assert.equal(reviewGroup(at(6), NOW), "tomorrow");
  assert.equal(reviewGroup(at(8), NOW), "week"); // воскресенье этой недели
  assert.equal(reviewGroup(at(9), NOW), "later"); // понедельник следующей
});

test("в воскресенье на этой неделе уже ничего нет", () => {
  const sunday = new Date(2026, 10, 8, 10);
  assert.equal(reviewGroup(at(9), sunday), "tomorrow");
  assert.equal(reviewGroup(at(10), sunday), "later");
});

test("подпись срока", () => {
  assert.equal(whenLabel(null, NOW), "без срока");
  assert.equal(whenLabel(at(4), NOW), "вчера");
  assert.equal(whenLabel(at(3), NOW), "2 дня назад");
  assert.equal(whenLabel(new Date(2026, 9, 10).toISOString(), NOW), "3 недели назад");
  assert.equal(whenLabel(at(5), NOW), "сегодня");
  assert.equal(whenLabel(at(6), NOW), "завтра");
  assert.equal(whenLabel(at(7), NOW), "в субботу");
  assert.equal(whenLabel(at(8), NOW), "в воскресенье");
  assert.equal(whenLabel(at(14), NOW), "14 ноября");
  assert.equal(whenLabel(new Date(2027, 0, 20).toISOString(), NOW), "20 января 2027 г.");
});

test("подпись прошлого раза", () => {
  assert.equal(lastTimeLabel(null, NOW), "первое повторение");
  assert.equal(lastTimeLabel(at(5), NOW), "прошлый раз сегодня");
  assert.equal(lastTimeLabel(at(2), NOW), "прошлый раз 3 дня назад");
});

test("колода: только сегодняшнее и просроченное, без архива, самое давнее сверху", () => {
  const topics = [
    topic({ id: "today", nextReviewAt: at(5) }),
    topic({ id: "old", nextReviewAt: at(1) }),
    topic({ id: "tomorrow", nextReviewAt: at(6) }),
    topic({ id: "gone", nextReviewAt: at(2), archived: true }),
    topic({ id: "never" }),
  ];
  assert.deepEqual(
    dueTopics(topics, NOW).map((row) => row.id),
    ["old", "today"],
  );
});

test("следующая тема после колоды: ближайшая в будущем", () => {
  const topics = [
    topic({ id: "today", nextReviewAt: at(5) }),
    topic({ id: "soon", nextReviewAt: at(7) }),
    topic({ id: "later", nextReviewAt: at(20) }),
    topic({ id: "gone", nextReviewAt: at(6), archived: true }),
  ];
  assert.equal(nearestTopic(topics, NOW)?.id, "soon");
  assert.equal(nearestTopic([topic({ id: "never" })], NOW), null);
});

test("в группе ближайшие сверху, при равенстве по алфавиту", () => {
  const topics = [
    topic({ id: "б", nextReviewAt: at(7) }),
    topic({ id: "а", nextReviewAt: at(7) }),
    topic({ id: "в", nextReviewAt: at(6) }),
  ];
  assert.deepEqual(
    topicsInGroup(topics, "week", NOW).map((row) => row.id),
    ["а", "б"],
  );
});

test("пора повторить: срок сегодня или уже прошёл, без чисел", () => {
  assert.equal(isDue(topic({ id: "вчера", nextReviewAt: at(4) }), NOW), true);
  assert.equal(isDue(topic({ id: "сегодня", nextReviewAt: at(5, 20) }), NOW), true);
  assert.equal(isDue(topic({ id: "завтра", nextReviewAt: at(6) }), NOW), false);
  assert.equal(isDue(topic({ id: "без срока" }), NOW), false);
  assert.equal(isDue(topic({ id: "архив", nextReviewAt: at(1), archived: true }), NOW), false);
});

test("метка в списке: точка с подписью «пора», без кольца и чисел", () => {
  const due = renderToStaticMarkup(createElement(DueMark, { due: true }));
  assert.match(due, /aria-label="пора"/);
  assert.doesNotMatch(due, /ring|--p|\d/);
  const calm = renderToStaticMarkup(createElement(DueMark, { due: false }));
  assert.match(calm, /aria-hidden="true"/);
  assert.doesNotMatch(calm, /пора|ring|--p/);
});

test("отмена оценки возвращает и память FSRS", () => {
  const before = scheduleOf(
    topic({
      id: "Инерция",
      status: "SUCCESS",
      lastRevisedAt: at(1),
      nextReviewAt: at(9),
      intervalDays: 8,
      easeFactor: 2.31,
      fsrsStability: 8.4,
      fsrsDifficulty: 4.2,
      fsrsState: 2,
      fsrsReps: 3,
      fsrsLapses: 1,
    }),
  );
  assert.deepEqual(before, {
    status: "SUCCESS",
    lastRevisedAt: at(1),
    nextReviewAt: at(9),
    intervalDays: 8,
    easeFactor: 2.31,
    fsrsStability: 8.4,
    fsrsDifficulty: 4.2,
    fsrsState: 2,
    fsrsReps: 3,
    fsrsLapses: 1,
  });
});

test("колода и метка «пора повторить» согласны между собой", () => {
  const topics = [
    topic({ id: "просрочена", nextReviewAt: at(2) }),
    topic({ id: "сегодня", nextReviewAt: at(5, 9) }),
    topic({ id: "потом", nextReviewAt: at(9) }),
    topic({ id: "архив", nextReviewAt: at(1), archived: true }),
  ];
  assert.deepEqual(
    dueTopics(topics, NOW).map((row) => row.id),
    topics.filter((row) => isDue(row, NOW)).map((row) => row.id),
  );
});

test("обложка: свой цвет важнее, остальные по названию и стабильно", () => {
  assert.deepEqual(coverOf("Физика", "#8b5cf6"), { className: "b-phys" });
  assert.deepEqual(coverOf("Алгебра", null), { className: "b-alg" });
  const custom = coverOf("Физика", "#0d9488");
  assert.equal(custom.className, "");
  assert.equal(custom.style?.["--b1"], "#0d9488");
  assert.equal(coverOf("Химия", "#8b5cf6").className, coverOf("Химия", undefined).className);
  // Значение из базы не должно попасть в стиль, если это не цвет.
  assert.equal(coverOf("Физика", "red; background: url(x)").style, undefined);
});

test("предмет ищется без регистра и по началу названия", () => {
  const subjects = [{ name: "Русский язык" }, { name: "Физика" }, { name: "Английский" }];
  assert.equal(findSubject(subjects, "физика")?.name, "Физика");
  assert.equal(findSubject(subjects, "Русский")?.name, "Русский язык");
  assert.equal(findSubject(subjects, "Английский язык")?.name, "Английский");
  assert.equal(findSubject(subjects, "Химия"), undefined);
  assert.equal(findSubject(subjects, "  "), undefined);
});

test("своё название ищется только точно: «Физика 9» это не «Физика»", () => {
  const subjects = [{ name: "Физика" }];
  assert.equal(exactSubject(subjects, " физика ")?.name, "Физика");
  assert.equal(exactSubject(subjects, "Физика 9"), undefined);
  assert.equal(exactSubject(subjects, ""), undefined);
});

test("предпросмотр: находит предмет, предлагает новый, оставляет пустым", () => {
  const subjects = [{ id: "phys", name: "Физика" }];
  const drafts = buildDrafts(
    [
      { title: "Закон Ома", subject: "Физика" },
      { title: "Кислоты", subject: "Химия" },
      { title: "Что-то своё", subject: "" },
    ],
    subjects,
    [],
  );
  assert.deepEqual(
    drafts.map((row) => [row.title, row.subjectId, row.newSubject, row.duplicate]),
    [
      ["Закон Ома", "phys", "", false],
      ["Кислоты", "", "Химия", false],
      ["Что-то своё", "", "", false],
    ],
  );
  assert.deepEqual(drafts.map(draftHasSubject), [true, true, false]);
});

test("предпросмотр: уже имеющуюся тему не задваивает", () => {
  const subjects = [{ id: "phys", name: "Физика" }];
  const topics = [topic({ id: "1", name: "Закон Ома", subject: "phys" })];

  const same = buildDrafts([{ title: "закон ома", subject: "Физика" }], subjects, topics)[0];
  assert.equal(same.duplicate, true);

  // Предмет не назван: тему узнаём, предмет берём от неё.
  const unnamed = buildDrafts([{ title: "Закон Ома", subject: "" }], subjects, topics)[0];
  assert.equal(unnamed.duplicate, true);
  assert.equal(unnamed.subjectId, "phys");

  // В другом предмете это другая тема.
  const other = buildDrafts([{ title: "Закон Ома", subject: "Химия" }], subjects, topics)[0];
  assert.equal(other.duplicate, false);
  assert.equal(other.newSubject, "Химия");
});

test("предпросмотр: одинаковые строки схлопываются", () => {
  const drafts = buildDrafts(
    [
      { title: "Импульс", subject: "Физика" },
      { title: "импульс ", subject: "Физика" },
    ],
    [],
    [],
  );
  assert.equal(drafts.length, 1);
});

test("предпросмотр: название не длиннее того, что примет сервер", () => {
  const [draft] = buildDrafts([{ title: "я".repeat(400), subject: "" }], [], []);
  assert.equal(draft.title.length, 255);
});

test("новая тема: повторяли сегодня, следующий раз завтра", () => {
  const fields = firstReviewFields(NOW);
  assert.equal(fields.intervalDays, 1);
  assert.equal(fields.status, "MEDIUM");
  assert.equal(fields.studyState, "STUDIED");
  assert.equal(fields.lastRevisedAt, NOW.toISOString());
  assert.equal(dayDiff(NOW, new Date(fields.nextReviewAt)), 1);
});

test("созданный карточкой предмет убираем, только если он пуст и не стоит в расписании", () => {
  assert.deepEqual(
    subjectsToRemove(["пустой", "с темой", "в расписании"], [{ subject: "с темой" }], [{ subjectId: "в расписании" }]),
    ["пустой"],
  );
  assert.deepEqual(subjectsToRemove([], [], []), []);
});
