import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import EN, { EN_PARTS } from "./en/index";
import {
  dateLocale,
  fill,
  localeFromCookie,
  plural,
  russianForm,
  setLocaleForTests,
  t,
  translate,
  translatePlural,
} from "./index";
import { placeholders, scanFiles, scanSource, sourceFiles } from "./scan";

const SRC = path.resolve(__dirname, "../..");

/** Временная строка словаря: тесты не зависят от того, что уже переведено. Прежнее значение возвращается. */
function withEntry(key: string, value: string, run: () => void) {
  const had = Object.prototype.hasOwnProperty.call(EN, key);
  const before = EN[key];
  EN[key] = value;
  try {
    run();
  } finally {
    if (had) EN[key] = before;
    else delete EN[key];
  }
}

test("по-русски ключ и есть текст, подстановки заполняются", () => {
  setLocaleForTests("ru");
  assert.equal(t("Сохранить"), "Сохранить");
  assert.equal(t("Осталось {n} мин из {total}", { n: 5, total: 25 }), "Осталось 5 мин из 25");
  assert.equal(fill("{who} и {n}", { n: 1 }), "{who} и 1");
});

test("по-английски перевод из словаря, а без перевода остаётся русский", () => {
  withEntry("Тестовая строка {n}", "Test line {n}", () => {
    assert.equal(translate("en", "Тестовая строка {n}", { n: 3 }), "Test line 3");
    assert.equal(translate("ru", "Тестовая строка {n}", { n: 3 }), "Тестовая строка 3");
    setLocaleForTests("en");
    try {
      assert.equal(t("Тестовая строка {n}", { n: 7 }), "Test line 7");
      assert.equal(t("Строки нет в словаре"), "Строки нет в словаре");
    } finally {
      setLocaleForTests("ru");
    }
  });
});

test("контекст разводит одинаковый русский текст с разным смыслом", () => {
  withEntry("тест::Тестовое слово", "Test sense", () => {
    withEntry("Тестовое слово", "Other sense", () => {
      assert.equal(translate("en", "Тестовое слово", undefined, "тест"), "Test sense");
      assert.equal(translate("en", "Тестовое слово"), "Other sense");
      assert.equal(translate("ru", "Тестовое слово", undefined, "тест"), "Тестовое слово");
    });
  });
  const found = scanSource("x.ts", 'const a = t("По дням", undefined, "история");');
  assert.deepEqual(found.keys.map((key) => key.key), ["история::По дням"]);
});

test("русское склонение: 1, 2–4, 5+, 11–14 и дробные", () => {
  const forms = ["урок", "урока", "уроков"] as const;
  const pick = (n: number) => russianForm(n, ...forms);
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 0].map(pick), [
    "урок",
    "урока",
    "урока",
    "уроков",
    "уроков",
    "уроков",
    "уроков",
    "урок",
    "урока",
    "уроков",
    "урок",
    "уроков",
    "уроков",
  ]);
  assert.equal(pick(1.5), "урока");
  assert.equal(plural(3, "{n} урок", "{n} урока", "{n} уроков"), "3 урока");
});

test("английское склонение берёт «единственное|множественное» из словаря", () => {
  withEntry("{n} тест|{n} теста|{n} тестов", "{n} test|{n} tests", () => {
    assert.equal(translatePlural("en", 1, "{n} тест", "{n} теста", "{n} тестов"), "1 test");
    assert.equal(translatePlural("en", 21, "{n} тест", "{n} теста", "{n} тестов"), "21 tests");
    assert.equal(translatePlural("ru", 21, "{n} тест", "{n} теста", "{n} тестов"), "21 тест");
  });
  withEntry("ответ|ответа|ответов", "answer|answers", () => {
    assert.equal(translatePlural("en", 2, "ответ", "ответа", "ответов"), "answers");
  });
  // Перевода нет — русские формы, а не пустая строка.
  assert.equal(translatePlural("en", 5, "{n} зверь", "{n} зверя", "{n} зверей"), "5 зверей");
});

test("язык из куки: только ru и en, без куки русский", () => {
  assert.equal(localeFromCookie("a=1; timely-lang=en; b=2"), "en");
  assert.equal(localeFromCookie("timely-lang=ru"), "ru");
  assert.equal(localeFromCookie("timely-lang=kk"), "ru");
  assert.equal(localeFromCookie("my-timely-lang=en"), "ru");
  assert.equal(localeFromCookie(""), "ru");
  assert.equal(localeFromCookie(undefined), "ru");
});

test("даты по-английски британские: 24 часа и неделя с понедельника", () => {
  assert.equal(dateLocale("ru"), "ru-RU");
  assert.equal(dateLocale("en"), "en-GB");
});

test("разбор исходника находит ключи, склонения и русский текст вне перевода", () => {
  const source = [
    'import { t, plural } from "@/lib/i18n";',
    "// Комментарий не считается",
    'const re = /привет/;',
    'const a = t("Сохранить");',
    'const b = plural(n, "урок", "урока", "уроков");',
    'const c = plural(n, ["день", "дня", "дней"]);',
    "const d = t(`Шаблон ${x}`);",
    'const e = "Забыли перевести";',
    'const f = "Данные"; // i18n-skip',
    'console.warn("Отладка");',
    "const g = <b>Текст в разметке</b>;",
  ].join("\n");
  const found = scanSource("x.tsx", source);
  assert.deepEqual(
    found.keys.map((key) => key.key),
    ["Сохранить", "урок|урока|уроков", "день|дня|дней"],
  );
  assert.deepEqual(
    found.broken.map((item) => item.line),
    [7],
  );
  assert.deepEqual(
    found.leftovers.map((item) => item.text),
    ["Забыли перевести", "Текст в разметке"],
  );
});

const scanned = scanFiles(sourceFiles(SRC), path.resolve(SRC, ".."));

test("у каждого t() и plural() в коде есть английский перевод", () => {
  const missing = scanned.keys.filter((key) => {
    const value = EN[key.key];
    return value === undefined || value.trim() === "";
  });
  const report = missing.map((key) => `${key.file}:${key.line} ${JSON.stringify(key.key)}`).join("\n");
  assert.equal(missing.length, 0, `Нет перевода:\n${report}`);
});

test("t() получает обычную строку с {именами}, а не шаблон с ${}", () => {
  const report = scanned.broken.map((item) => `${item.file}:${item.line} ${item.text}`).join("\n");
  assert.equal(scanned.broken.length, 0, `Шаблон вместо строки:\n${report}`);
});

test("в переводе те же подстановки, что в русском ключе", () => {
  const wrong: string[] = [];
  for (const [key, value] of Object.entries(EN)) {
    const isPlural = key.split("|").length === 3;
    const expected = placeholders(key);
    if (isPlural) {
      const forms = value.split("|");
      const extra = forms.flatMap(placeholders).filter((name) => !expected.includes(name) && name !== "n");
      if (forms.length > 2 || extra.length) wrong.push(`${key} → ${value}`);
    } else if (placeholders(value).join() !== expected.join()) {
      wrong.push(`${key} → ${value}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("одинаковая русская строка переведена одинаково во всех файлах словаря", () => {
  const seen = new Map<string, { part: string; value: string }>();
  const conflicts: string[] = [];
  for (const [part, dictionary] of Object.entries(EN_PARTS)) {
    for (const [key, value] of Object.entries(dictionary)) {
      const before = seen.get(key);
      if (before && before.value !== value) {
        conflicts.push(`${JSON.stringify(key)}: ${before.part} «${before.value}», ${part} «${value}»`);
      }
      if (!before) seen.set(key, { part, value });
    }
  }
  assert.deepEqual(conflicts, []);
});
