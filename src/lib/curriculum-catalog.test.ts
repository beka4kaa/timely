import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import {
  UNSORTED_TITLE,
  booksOf,
  buildCatalog,
  subjectState,
  subjectTitle,
} from "./curriculum-catalog.ts";
import type {
  CoursePlanSummary,
  CurriculumDocument,
  LearningGoal,
  StudyMaterial,
} from "./curriculum-api.ts";

function goal(id: string, subject = "", text = "хочу разобраться"): LearningGoal {
  return {
    id,
    original_text: text,
    normalized_subject: subject,
    normalized_direction: "",
    normalization_confidence: null,
    normalization_confirmed: true,
    goal_type: "skill",
    current_level: "beginner",
    target_level: "school_confident",
    preferred_language: "ru",
    theory_practice_balance: "balanced",
    status: "confirmed",
    created_at: "2026-08-10T00:00:00Z",
  } as unknown as LearningGoal;
}

function book(
  id: string,
  goalId: string | null,
  status = "ready",
): CurriculumDocument {
  return {
    id,
    goal: goalId,
    title: `Книга ${id}`,
    authors: [],
    language: "ru",
    document_type: "textbook",
    source_type: "upload",
    page_count: 100,
    ingestion_status: status,
    processing_version: "1.2.0",
    file: null,
    created_at: "2026-08-10T00:00:00Z",
  } as unknown as CurriculumDocument;
}

function material(
  id: string,
  goalId: string,
  kind: StudyMaterial["kind"] = "practice_set",
): StudyMaterial {
  return {
    id,
    goal: goalId,
    kind,
    title: `Материал ${id}`,
    url: "",
    note: "",
    total_units: 10,
    completed_units: 0,
    unit_label: "",
    units_word: "вариантов",
    minutes_per_unit: 60,
    total_minutes: 600,
    position: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
  };
}

function plan(
  id: string,
  goalId: string,
  documentId: string | null,
  materialId: string | null = null,
): CoursePlanSummary {
  return {
    id,
    goal: goalId,
    document: documentId,
    material: materialId,
    title: `План ${id}`,
    status: "awaiting_approval",
    estimated_total_minutes: 600,
    forecast_finish_date: null,
    current_version: 1,
    created_at: "2026-08-10T00:00:00Z",
  };
}

function sourceIds(subject: { sources: readonly unknown[] }): string[] {
  return (subject.sources as { kind: string; document?: { id: string }; material?: { id: string } }[]).map(
    (source) => (source.kind === "book" ? source.document!.id : source.material!.id),
  );
}

// ───────────────────────────── Ничего не теряется ────────────────────────────

test("книга без предмета попадает в отдельную группу, а не исчезает", () => {
  // Книги, загруженные до каталога, предмета не имеют. Пропасть они не должны:
  // ученик решит, что загрузка не удалась, и загрузит файл ещё раз.
  const catalog = buildCatalog([goal("g1", "Физика")], [book("d1", null)], []);

  assert.equal(catalog.length, 2);
  assert.equal(catalog[1].title, UNSORTED_TITLE);
  assert.equal(catalog[1].goalId, null);
  assert.deepEqual(sourceIds(catalog[1]), ["d1"]);
});

test("книга с исчезнувшим предметом тоже остаётся видимой", () => {
  // Три запроса приходят порознь и могут разъехаться во времени: цель уже
  // удалена, а список книг отдан до удаления.
  const catalog = buildCatalog([], [book("d1", "g-удалённая")], []);

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].title, UNSORTED_TITLE);
});

test("план без книги остаётся у своего предмета", () => {
  // `CoursePlan.document` — SET_NULL: книгу удалили, план живёт.
  const catalog = buildCatalog([goal("g1", "Физика")], [], [plan("p1", "g1", null)]);

  assert.deepEqual(
    catalog[0].orphanPlans.map((entry) => entry.id),
    ["p1"],
  );
});

// ─────────────────────────────── Соединение ──────────────────────────────────

test("несколько книг на предмет и несколько планов на книгу", () => {
  const catalog = buildCatalog(
    [goal("g1", "Физика")],
    [book("d1", "g1"), book("d2", "g1")],
    [plan("p1", "g1", "d1"), plan("p2", "g1", "d1"), plan("p3", "g1", "d2")],
  );

  assert.equal(catalog.length, 1);
  assert.deepEqual(
    booksOf(catalog[0]).map((entry) => [
      entry.document.id,
      entry.plans.map((item) => item.id),
    ]),
    [
      ["d1", ["p1", "p2"]],
      ["d2", ["p3"]],
    ],
  );
});

test("предметы не смешиваются между собой", () => {
  const catalog = buildCatalog(
    [goal("g1", "Физика"), goal("g2", "Алгебра")],
    [book("d1", "g1"), book("d2", "g2")],
    [plan("p1", "g1", "d1"), plan("p2", "g2", "d2")],
  );

  assert.deepEqual(
    catalog.map((subject) => [subject.title, sourceIds(subject)]),
    [
      ["Физика", ["d1"]],
      ["Алгебра", ["d2"]],
    ],
  );
});

// ──────────────────────────── Источники без файла ────────────────────────────

test("книги и материалы стоят одним списком, книги первыми", () => {
  const catalog = buildCatalog(
    [goal("g1", "SAT")],
    [book("d1", "g1")],
    [],
    [material("m1", "g1"), material("m2", "g1", "link")],
  );

  assert.deepEqual(sourceIds(catalog[0]), ["d1", "m1", "m2"]);
});

test("программа по материалу остаётся у своего источника, а не сиротеет", () => {
  // Оба вида программы приходят с `document: null`. Без связи с материалом
  // свежесобранная программа подписывалась бы как «книга удалена».
  const catalog = buildCatalog(
    [goal("g1", "SAT")],
    [],
    [plan("p1", "g1", null, "m1")],
    [material("m1", "g1")],
  );

  assert.deepEqual(catalog[0].orphanPlans, []);
  assert.deepEqual(
    catalog[0].sources.map((source) => source.plans.map((item) => item.id)),
    [["p1"]],
  );
});

test("материал с исчезнувшим предметом остаётся видимым", () => {
  const catalog = buildCatalog([], [], [], [material("m1", "g-удалённая")]);

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].title, UNSORTED_TITLE);
  assert.deepEqual(sourceIds(catalog[0]), ["m1"]);
});

test("предмет с одними материалами сразу готов к расчёту", () => {
  // Обрабатывать в материале нечего, поэтому «обработка» тут невозможна.
  const catalog = buildCatalog([goal("g1")], [], [], [material("m1", "g1")]);
  assert.equal(subjectState(catalog[0]), "ready_to_plan");
});

test("посчитанная программа по материалу важнее книги в очереди", () => {
  const catalog = buildCatalog(
    [goal("g1")],
    [book("d1", "g1", "ocr")],
    [plan("p1", "g1", null, "m1")],
    [material("m1", "g1")],
  );
  assert.equal(subjectState(catalog[0]), "has_plan");
});

test("порядок предметов повторяет порядок целей с сервера", () => {
  const catalog = buildCatalog(
    [goal("g1", "Физика"), goal("g2", "Алгебра"), goal("g3", "Химия")],
    [],
    [],
  );
  assert.deepEqual(
    catalog.map((subject) => subject.title),
    ["Физика", "Алгебра", "Химия"],
  );
});

// ──────────────────────────────── Заголовок ──────────────────────────────────

test("пока модель не разобрала цель, показывается формулировка ученика", () => {
  assert.equal(subjectTitle(goal("g1", "", "механика с нуля")), "механика с нуля");
});

test("разобранный предмет вытесняет исходную формулировку", () => {
  assert.equal(subjectTitle(goal("g1", "Физика", "механика с нуля")), "Физика");
});

// ───────────────────────────── Состояние строки ──────────────────────────────

test("пустой предмет отличается от предмета в обработке", () => {
  assert.equal(subjectState(buildCatalog([goal("g1")], [], [])[0]), "empty");
  assert.equal(
    subjectState(buildCatalog([goal("g1")], [book("d1", "g1", "ocr")], [])[0]),
    "processing",
  );
});

test("готовая книга без плана зовёт построить программу", () => {
  const catalog = buildCatalog([goal("g1")], [book("d1", "g1", "ready")], []);
  assert.equal(subjectState(catalog[0]), "ready_to_plan");
});

test("построенный план важнее всего остального", () => {
  // У предмета две книги: одна ещё обрабатывается, по другой план уже есть.
  // Строка должна говорить о результате, а не о фоне.
  const catalog = buildCatalog(
    [goal("g1")],
    [book("d1", "g1", "ready"), book("d2", "g1", "ocr")],
    [plan("p1", "g1", "d1")],
  );
  assert.equal(subjectState(catalog[0]), "has_plan");
});

test("ошибка обработки заметнее, чем соседняя книга в очереди", () => {
  const catalog = buildCatalog(
    [goal("g1")],
    [book("d1", "g1", "failed"), book("d2", "g1", "ocr")],
    [],
  );
  assert.equal(subjectState(catalog[0]), "failed");
});
