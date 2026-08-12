import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import {
  EMPTY_SOURCE_FORM,
  normalizeUrl,
  prepareSource,
  sourceSummary,
  unitsHint,
} from "./add-source.logic.ts";
import type { SourceFormValues } from "./add-source.logic.ts";

function form(overrides: Partial<SourceFormValues> = {}): SourceFormValues {
  return { ...EMPTY_SOURCE_FORM, ...overrides };
}

function errorsOf(result: ReturnType<typeof prepareSource>) {
  assert.ok("errors" in result, "ожидались ошибки, а форма прошла");
  return result.errors;
}

function draftOf(result: ReturnType<typeof prepareSource>) {
  assert.ok("draft" in result, "форма не прошла проверку");
  return result.draft;
}

// ──────────────────────────────── Адрес ──────────────────────────────────────

test("адрес без схемы дописывается сам", () => {
  // Человек копирует «khanacademy.org» из адресной строки, и требовать от него
  // дописать https:// — работа, которую поле делает само.
  assert.equal(normalizeUrl("khanacademy.org"), "https://khanacademy.org/");
  assert.equal(
    normalizeUrl("  collegeboard.org/sat  "),
    "https://collegeboard.org/sat",
  );
});

test("существующая схема сохраняется", () => {
  assert.equal(normalizeUrl("http://example.com/x"), "http://example.com/x");
});

test("строка без домена адресом не считается", () => {
  assert.equal(normalizeUrl("просто текст"), null);
  assert.equal(normalizeUrl("localhost"), null);
  assert.equal(normalizeUrl(""), null);
});

test("у ссылки адрес обязателен, у остальных типов — нет", () => {
  const link = prepareSource(
    form({ kind: "link", title: "Khan", totalUnits: "10", minutesPerUnit: "30" }),
    "g1",
  );
  assert.equal(errorsOf(link).url, "Нужен адрес страницы.");

  const tests = prepareSource(
    form({
      kind: "practice_set",
      title: "SAT",
      totalUnits: "10",
      minutesPerUnit: "180",
    }),
    "g1",
  );
  assert.equal(draftOf(tests).url, "");
});

// ──────────────────────────────── Числа ──────────────────────────────────────

test("количество и время должны быть целыми и больше нуля", () => {
  const base = { kind: "custom" as const, title: "Своё" };

  assert.ok(errorsOf(prepareSource(form({ ...base }), "g1")).totalUnits);
  assert.ok(
    errorsOf(prepareSource(form({ ...base, totalUnits: "0" }), "g1")).totalUnits,
  );
  assert.ok(
    errorsOf(prepareSource(form({ ...base, totalUnits: "2.5" }), "g1"))
      .totalUnits,
  );
  assert.ok(
    errorsOf(prepareSource(form({ ...base, totalUnits: "десять" }), "g1"))
      .totalUnits,
  );
  assert.ok(
    errorsOf(
      prepareSource(form({ ...base, totalUnits: "10", minutesPerUnit: "-5" }), "g1"),
    ).minutesPerUnit,
  );
});

test("лишний ноль в паре чисел ловится по сумме", () => {
  // 5000 × 600 — это 50 000 часов. По отдельности оба числа допустимы, и
  // поймать опечатку можно только вместе.
  const result = prepareSource(
    form({
      kind: "problem_set",
      title: "Задачник",
      totalUnits: "5000",
      minutesPerUnit: "600",
    }),
    "g1",
  );
  assert.match(errorsOf(result).totalUnits ?? "", /двух тысяч часов/);
});

// ──────────────────────────────── Черновик ───────────────────────────────────

test("готовый черновик несёт цель, тип и подпись единицы", () => {
  const draft = draftOf(
    prepareSource(
      form({
        kind: "practice_set",
        title: "  SAT Practice Tests  ",
        totalUnits: "10",
        minutesPerUnit: "180",
        note: "  по одному в неделю  ",
      }),
      "g-1",
    ),
  );

  assert.deepEqual(draft, {
    goalId: "g-1",
    kind: "practice_set",
    title: "SAT Practice Tests",
    url: "",
    note: "по одному в неделю",
    total_units: 10,
    minutes_per_unit: 180,
    unit_label: "вариантов",
  });
});

test("название обязательно", () => {
  const result = prepareSource(
    form({ kind: "custom", totalUnits: "5", minutesPerUnit: "20" }),
    "g1",
  );
  assert.ok(errorsOf(result).title);
});

// ──────────────────────────────── Подписи ────────────────────────────────────

test("подпись единицы зависит от типа", () => {
  assert.equal(unitsHint("practice_set"), "вариантов");
  assert.equal(unitsHint("problem_set"), "задач");
  assert.equal(unitsHint("link"), "занятий");
});

test("сводка показывает объём словами, а не голыми числами", () => {
  assert.equal(
    sourceSummary(
      form({ kind: "practice_set", totalUnits: "10", minutesPerUnit: "180" }),
    ),
    "10 вариантов · 30 ч",
  );
  assert.equal(
    sourceSummary(form({ kind: "custom", totalUnits: "2", minutesPerUnit: "20" })),
    "2 занятий · 40 мин",
  );
  assert.equal(sourceSummary(form({ totalUnits: "", minutesPerUnit: "" })), "");
});
