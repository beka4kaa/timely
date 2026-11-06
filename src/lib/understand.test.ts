import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDeadline, parseHabit, parseSchedule, understandLocally } from "./understand.ts";

test("как часто по словам ученика", () => {
  const onDays = (...weekdays: number[]) => ({ frequency: "weekdays", weekdays, intervalDays: 2 });
  const every = (intervalDays: number) => ({ frequency: "interval", weekdays: [], intervalDays });
  const cases: Array<[string, object | null]> = [
    ["Зарядка по будням", onDays(0, 1, 2, 3, 4)],
    ["в будни делать зарядку", onDays(0, 1, 2, 3, 4)],
    ["с понедельника по пятницу бегать", onDays(0, 1, 2, 3, 4)],
    ["пн-пт зарядка", onDays(0, 1, 2, 3, 4)],
    ["По выходным гулять", onDays(5, 6)],
    ["английский по понедельникам и средам", onDays(0, 2)],
    ["Плавание пн, ср, пт", onDays(0, 2, 4)],
    ["плавание вт/чт", onDays(1, 3)],
    ["каждую субботу созвон", onDays(5)],
    ["каждый понедельник планировать неделю", onDays(0)],
    ["во вторник и четверг рисовать", onDays(1, 3)],
    ["3 раза в неделю зал", onDays(0, 2, 4)],
    ["два раза в неделю бегать", onDays(0, 3)],
    ["дважды в неделю бегать", onDays(0, 3)],
    ["пять раз в неделю учить слова", onDays(0, 1, 2, 3, 4)],
    ["читать через день", every(2)],
    ["Бегать раз в 3 дня", every(3)],
    ["раз в пять дней поливать цветы", every(5)],
    ["каждые 2 дня поливать цветы", every(2)],
    ["каждый третий день убирать стол", every(3)],
    ["раз в пару дней звонить бабушке", every(2)],
    ["раз в несколько дней разбирать почту", every(3)],
    ["убираться раз в неделю", every(7)],
    ["каждую неделю убираться", every(7)],
    ["раз в две недели стричься", every(14)],
    ["раз в месяц подводить итоги", every(30)],
    ["раз в 90 дней менять щётку", every(30)],
    ["Читать каждый день", null],
    ["читать ежедневно", null],
    ["Пить воду", null],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseSchedule(text), expected, text);
});

test("слова, похожие на дни, днями не считаются", () => {
  for (const text of ["Читать про окружающую среду", "Считать среднее", "Что такое вторник", "Вспомнить всё", "Сделать чтение"]) {
    assert.equal(parseSchedule(text), null, text);
  }
});

test("частота уходит из названия привычки", () => {
  const cases: Array<[string, string]> = [
    ["Зарядка по будням", "Зарядка"],
    ["По выходным гулять", "Гулять"],
    ["читать 20 минут через день", "Читать 20 минут"],
    ["Хочу бегать раз в 3 дня", "Бегать"],
    ["английский по понедельникам и средам", "Английский"],
    ["Плавание пн, ср, пт", "Плавание"],
    ["Решать 3 задачи 3 раза в неделю", "Решать 3 задачи"],
    ["Зарядка - по будням.", "Зарядка"],
    ["Буду читать 20 минут каждый день", "Читать 20 минут"],
    ["Читать про окружающую среду", "Читать про окружающую среду"],
  ];
  for (const [text, name] of cases) assert.equal(parseHabit(text), name, text);
});

test("если вся запись про частоту, название не пустеет", () => {
  assert.equal(parseHabit("по будням"), "По будням");
});

test("запись с частотой понятна без модели", () => {
  for (const text of ["зарядка по будням", "читать через день", "бегать раз в 3 дня", "по средам плавание", "дважды в неделю зал"]) {
    const result = understandLocally(text);
    assert.equal(result.kind, "habit", text);
    assert.ok(result.kind === "habit" && result.schedule, text);
  }
  const plain = understandLocally("читать каждый день");
  assert.ok(plain.kind === "habit" && plain.schedule === null);
});

test("просьба поменять частоту идёт к помощнику, а цель остаётся целью", () => {
  assert.equal(understandLocally("поменяй зарядку на через день", "habit").kind, "question");
  assert.equal(understandLocally("Хочу сдать контрольную в понедельник").kind, "goal");
});

test("вопрос остаётся вопросом, даже если в нём есть «хочу» или «цель»", () => {
  assert.equal(understandLocally("Что такое цель?").kind, "question");
  assert.equal(understandLocally("как сдать физику").kind, "question");
  assert.equal(understandLocally("Хочу понять производную").kind, "question");
  assert.equal(understandLocally("Перенеси физику на завтра").kind, "question");
  // Просьба об уже записанном идёт к помощнику, а не становится новой записью.
  assert.equal(understandLocally("Отметь зарядку за сегодня", "habit").kind, "question");
});

test("запись находит своё место по смыслу", () => {
  assert.equal(understandLocally("Хочу сдать физику на 9 к декабрю").kind, "goal");
  assert.equal(understandLocally("Буду читать 20 минут каждый день").kind, "habit");
  const topics = understandLocally("Сегодня изучил закон Ома и метод интервалов");
  assert.equal(topics.kind, "topics");
  assert.equal(topics.kind === "topics" ? topics.topics.length : 0, 2);
});

test("у каждой темы свой предмет, чужой ей не приписывается", () => {
  const mixed = understandLocally("Сегодня изучил закон Ома и метод интервалов");
  assert.deepEqual(
    mixed.kind === "topics" ? mixed.topics.map((topic) => topic.subject) : [],
    ["Физика", "Алгебра"],
  );
  const unknown = understandLocally("Сегодня изучил закон Ома и правило ударения");
  assert.deepEqual(
    unknown.kind === "topics" ? unknown.topics.map((topic) => topic.subject) : [],
    ["Физика", ""],
  );
  const named = understandLocally("Сегодня по физике разобрал импульс и работу");
  assert.deepEqual(named.kind === "topics" ? named.topics : [], [
    { title: "Импульс", subject: "Физика" },
    { title: "Работу", subject: "Физика" },
  ]);
});

test("страница подсказывает, если по словам непонятно", () => {
  assert.equal(understandLocally("Победа на олимпиаде").kind, "question");
  assert.equal(understandLocally("Победа на олимпиаде", "goal").kind, "goal");
  assert.equal(understandLocally("Закон Ома", "topics").kind, "topics");
});

test("срок из текста: прошедший месяц значит следующий год", () => {
  const now = new Date(2026, 10, 5);
  assert.equal(parseDeadline("к декабрю", now), "2026-12-01");
  assert.equal(parseDeadline("до 20 мая", now), "2027-05-20");
  assert.equal(parseDeadline("когда-нибудь", now), null);
});
