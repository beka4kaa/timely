import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import {
  FAILURES_BEFORE_WARNING,
  MAX_UPLOAD_BYTES,
  PHASES,
  checkFileBeforeUpload,
  formatBytes,
  formatElapsed,
  formatMinutes,
  formatSource,
  ingestionErrorMessage,
  ingestionWarningMessage,
  isTerminal,
  phaseIndexFor,
  phaseState,
  pollDelayMs,
  retryDelayMs,
  uniqueSourceLabels,
} from "./curriculum-progress.ts";

// ─────────────────────────────── Фазы ────────────────────────────────────────

test("одиннадцать шагов пайплайна укладываются ровно в четыре фазы", () => {
  assert.equal(PHASES.length, 4);
  const covered = PHASES.flatMap((p) => p.statuses);
  assert.equal(covered.length, 11);
  assert.equal(new Set(covered).size, 11, "статус не должен попадать в две фазы");
});

test("статус переводится в свою фазу", () => {
  assert.equal(phaseIndexFor("uploaded"), 0);
  assert.equal(phaseIndexFor("ocr"), 1);
  assert.equal(phaseIndexFor("chunking"), 2);
  assert.equal(phaseIndexFor("ready"), 3);
});

test("у провала фазы нет: прогресс на экране ошибки был бы враньём", () => {
  assert.equal(phaseIndexFor("failed"), -1);
  assert.equal(phaseState(0, phaseIndexFor("failed")), "pending");
});

test("неизвестный статус не роняет индикатор", () => {
  assert.equal(phaseIndexFor("совершенно-новый-шаг"), 0);
});

test("фазы делятся на пройденные, текущую и будущие", () => {
  const current = phaseIndexFor("chunking"); // 2
  assert.equal(phaseState(0, current), "done");
  assert.equal(phaseState(1, current), "done");
  assert.equal(phaseState(2, current), "active");
  assert.equal(phaseState(3, current), "pending");
});

test("терминальны только ready и failed", () => {
  assert.ok(isTerminal("ready"));
  assert.ok(isTerminal("failed"));
  assert.ok(!isTerminal("chunking"));
  assert.ok(!isTerminal("uploaded"));
});

// ─────────────────────────────── Опрос ───────────────────────────────────────

test("частота опроса падает со временем", () => {
  assert.equal(pollDelayMs(0), 2_000);
  assert.equal(pollDelayMs(59_000), 2_000);
  assert.equal(pollDelayMs(60_000), 5_000);
  assert.equal(pollDelayMs(299_000), 5_000);
  assert.equal(pollDelayMs(300_000), 10_000);
  assert.equal(pollDelayMs(3_600_000), 10_000);
});

test("повтор после сетевой ошибки растёт, но не бесконечно", () => {
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(2), 2_000);
  assert.equal(retryDelayMs(3), 4_000);
  assert.equal(retryDelayMs(99), 30_000, "потолок 30 секунд");
  assert.equal(retryDelayMs(0), 1_000, "нулевая попытка не даёт нулевой паузы");
});

test("о потере связи говорим не с первой неудачи", () => {
  assert.equal(FAILURES_BEFORE_WARNING, 3);
});

// ────────────────────────────── Ошибки ───────────────────────────────────────

test("самый вероятный провал объясняется по-человечески", () => {
  const message = ingestionErrorMessage("no_content");
  assert.match(message, /скан/i);
  assert.ok(!message.includes("no_content"), "код не должен протекать в текст");
});

test("неизвестный код не оставляет пользователя без объяснения", () => {
  assert.ok(ingestionErrorMessage("невиданная_ошибка").length > 0);
  assert.equal(
    ingestionErrorMessage("невиданная_ошибка", "Сообщение от бэкенда"),
    "Сообщение от бэкенда",
    "текст бэкенда важнее нашей заглушки",
  );
});

test("параметрические предупреждения разбираются по шаблону", () => {
  assert.match(
    ingestionWarningMessage("ocr_limited_to_3_of_40_pages"),
    /3 страниц из 40/,
  );
  assert.match(
    ingestionWarningMessage("processed_only_400_of_812_pages"),
    /400 страниц из 812/,
  );
});

test("незнакомое предупреждение показывается как есть, а не прячется", () => {
  assert.equal(ingestionWarningMessage("что_то_новое"), "что_то_новое");
});

// ───────────────────────── Проверка файла ────────────────────────────────────

test("принимается только PDF", () => {
  assert.ok(checkFileBeforeUpload({ name: "book.pdf", size: 1000, type: "" }).ok);
  assert.ok(checkFileBeforeUpload({ name: "BOOK.PDF", size: 1000, type: "" }).ok);
  const epub = checkFileBeforeUpload({ name: "book.epub", size: 1000, type: "" });
  assert.ok(!epub.ok);
  assert.match(epub.error ?? "", /PDF/);
});

test("пустой и слишком большой файл отклоняются с понятной причиной", () => {
  assert.ok(!checkFileBeforeUpload({ name: "b.pdf", size: 0, type: "" }).ok);
  const huge = checkFileBeforeUpload({
    name: "b.pdf",
    size: MAX_UPLOAD_BYTES + 1,
    type: "",
  });
  assert.ok(!huge.ok);
  assert.match(huge.error ?? "", /60 МБ/);
});

test("файл ровно на границе лимита проходит", () => {
  assert.ok(checkFileBeforeUpload({ name: "b.pdf", size: MAX_UPLOAD_BYTES, type: "" }).ok);
});

// ────────────────────────────── Цитаты ───────────────────────────────────────

test("ссылка на источник читается, а не выглядит отладкой", () => {
  assert.equal(
    formatSource({ section_path: "2.1", page_start: 34, page_end: 37 }),
    "§2.1, стр. 34–37",
  );
});

test("одна страница не превращается в диапазон", () => {
  assert.equal(
    formatSource({ section_path: "2.1", page_start: 34, page_end: 34 }),
    "§2.1, стр. 34",
  );
});

test("у источника без страниц остаётся раздел — страницы не выдумываем", () => {
  assert.equal(
    formatSource({ section_path: "7.2", page_start: null, page_end: null }),
    "§7.2",
  );
  assert.equal(formatSource({}), "");
});

test("повторяющиеся ссылки схлопываются, порядок сохраняется", () => {
  const labels = uniqueSourceLabels([
    { section_path: "1.2", page_start: 1, page_end: 1 },
    { section_path: "1.2", page_start: 1, page_end: 1 },
    { section_path: "1.3", page_start: 4, page_end: 6 },
    { section_path: "1.2", page_start: 1, page_end: 1 },
  ]);
  assert.deepEqual(labels, ["§1.2, стр. 1", "§1.3, стр. 4–6"]);
});

test("пустые ссылки не попадают в список", () => {
  assert.deepEqual(uniqueSourceLabels([{}, { section_path: "  " }]), []);
});

// ───────────────────────────── Форматы ───────────────────────────────────────

test("минуты переводятся в часы", () => {
  assert.equal(formatMinutes(45), "45 мин");
  assert.equal(formatMinutes(60), "1 ч");
  assert.equal(formatMinutes(90), "1 ч 30 мин");
  assert.equal(formatMinutes(0), "—");
  assert.equal(formatMinutes(-5), "—");
});

test("байты и прошедшее время читаемы", () => {
  assert.equal(formatBytes(512), "512 Б");
  assert.equal(formatBytes(2048), "2 КБ");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 МБ");
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(65_000), "1:05");
  assert.equal(formatElapsed(600_000), "10:00");
});
