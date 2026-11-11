import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import {
  ERROR_MESSAGES,
  FAILURES_BEFORE_WARNING,
  MAX_UPLOAD_BYTES,
  PHASES,
  checkFileBeforeUpload,
  canRecognizeLater,
  formatBytes,
  formatElapsed,
  formatMinutes,
  formatSource,
  ingestionErrorMessage,
  ingestionFailureTitle,
  ingestionWarningMessage,
  isTerminal,
  ocrNotice,
  planProfilingNotice,
  scansQuestion,
  unrecognizedScans,
  phaseIndexFor,
  phaseState,
  pollDelayMs,
  retryDelayMs,
  uniqueSourceLabels,
} from "./curriculum-progress.ts";

// ─────────────────────────────── Фазы ────────────────────────────────────────

test("очередь и одиннадцать шагов пайплайна укладываются в четыре фазы", () => {
  assert.equal(PHASES.length, 4);
  const covered = PHASES.flatMap((p) => p.statuses);
  assert.equal(covered.length, 12);
  assert.equal(new Set(covered).size, 12, "статус не должен попадать в две фазы");
});

test("статус переводится в свою фазу", () => {
  assert.equal(phaseIndexFor("uploaded"), 0);
  assert.equal(phaseIndexFor("queued"), 0);
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

test("зависшая обработка получает честный заголовок и безопасное сообщение", () => {
  assert.equal(ingestionFailureTitle(true), "Обработка прервалась");
  assert.equal(ingestionFailureTitle(false), "Прочитать учебник не удалось");
  assert.match(ingestionErrorMessage("stalled"), /файл сохранён/i);
  assert.doesNotMatch(ingestionErrorMessage("stalled"), /памят/i);
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

test("принимаются PDF и EPUB", () => {
  assert.ok(checkFileBeforeUpload({ name: "book.pdf", size: 1000, type: "" }).ok);
  assert.ok(checkFileBeforeUpload({ name: "BOOK.PDF", size: 1000, type: "" }).ok);
  assert.ok(checkFileBeforeUpload({ name: "book.epub", size: 1000, type: "" }).ok);
  assert.ok(checkFileBeforeUpload({ name: "BOOK.EPUB", size: 1000, type: "" }).ok);

  const docx = checkFileBeforeUpload({ name: "book.docx", size: 1000, type: "" });
  assert.ok(!docx.ok);
  assert.match(docx.error ?? "", /PDF и EPUB/);
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

// ───────────────────────── Сканы и лимит ─────────────────────────────────────

const NOW = new Date(2026, 10, 10, 15, 0);
const AT_1840 = new Date(2026, 10, 10, 18, 40).toISOString();
const PAST = new Date(2026, 10, 10, 14, 0).toISOString();
const none = { hasProgram: false, now: NOW };
const withProgram = { hasProgram: true, now: NOW };
const quota = (scanned: number, reset_at?: string) => ({
  scanned, attempted: 0, recognized: 0, skipped: "quota" as const, reset_at, plan: "free",
});

test("ocrNotice: quota без программы, время известно", () => {
  assert.equal(
    ocrNotice(quota(25, AT_1840), none),
    "Не распознано 25 страниц-сканов: не хватило лимита. Он восстановится сегодня в 18:40, тогда нажми «Обработать заново».",
  );
});

test("ocrNotice: quota без программы, времени нет или оно прошло", () => {
  const text = "Не распознано 25 страниц-сканов: не хватило лимита. Нажми «Обработать заново», когда он восстановится.";
  assert.equal(ocrNotice(quota(25), none), text);
  assert.equal(ocrNotice(quota(25, PAST), none), text);
});

test("ocrNotice: quota, программа есть", () => {
  assert.equal(ocrNotice(quota(25), withProgram), "Не распознано 25 страниц-сканов: не хватило лимита.");
  assert.equal(
    ocrNotice(quota(25, AT_1840), withProgram),
    "Не распознано 25 страниц-сканов: не хватило лимита. Он восстановится сегодня в 18:40.",
  );
});

test("ocrNotice: quota, склонение при n = 1, 3 и 21", () => {
  assert.equal(ocrNotice(quota(1), withProgram), "Не распознана 1 страница-скан: не хватило лимита.");
  assert.equal(ocrNotice(quota(3), withProgram), "Не распознано 3 страницы-скана: не хватило лимита.");
  assert.equal(ocrNotice(quota(21), withProgram), "Не распознана 21 страница-скан: не хватило лимита.");
});

const win = (scanned: number, plan: string) => ({ scanned, attempted: 0, recognized: 0, skipped: "window" as const, plan });

test("ocrNotice: window, бесплатный тариф", () => {
  assert.equal(
    ocrNotice(win(120, "free"), none),
    "Не распознано 120 страниц-сканов: на бесплатном тарифе столько не распознать за раз.",
  );
});

test("ocrNotice: window, другой тариф", () => {
  assert.equal(
    ocrNotice(win(120, "pro"), none),
    "Не распознано 120 страниц-сканов: на твоём тарифе столько не распознать за раз.",
  );
});

test("ocrNotice: window, склонение при 11, 111, 112 и 3", () => {
  for (const n of [11, 111, 112]) {
    assert.equal(
      ocrNotice(win(n, "free"), none),
      `Не распознано ${n} страниц-сканов: на бесплатном тарифе столько не распознать за раз.`,
    );
  }
  assert.equal(
    ocrNotice(win(3, "free"), none),
    "Не распознано 3 страницы-скана: на бесплатном тарифе столько не распознать за раз.",
  );
});

test("ocrNotice: потолок, всё отправленное распознано", () => {
  assert.equal(
    ocrNotice({ scanned: 120, attempted: 40, recognized: 40, skipped: "" }, none),
    "Распознаны первые 40 страниц-сканов из 120: больше за одну обработку нельзя.",
  );
});

test("ocrNotice: потолок, часть упала", () => {
  assert.equal(
    ocrNotice({ scanned: 120, attempted: 40, recognized: 35, skipped: "" }, none),
    "Распознано 35 из 120 страниц-сканов: больше 40 за одну обработку нельзя.",
  );
});

test("ocrNotice: часть упала без потолка", () => {
  assert.equal(
    ocrNotice({ scanned: 5, attempted: 5, recognized: 3, skipped: "" }, none),
    "Распознано 3 из 5 страниц-сканов.",
  );
  assert.equal(
    ocrNotice({ scanned: 21, attempted: 21, recognized: 20, skipped: "" }, none),
    "Распознано 20 из 21 страницы-скана.",
  );
});

test("ocrNotice: остановка по времени читается как частичный сбой", () => {
  assert.equal(
    ocrNotice({ scanned: 5, attempted: 5, recognized: 3, skipped: "", stopped: "time" }, none),
    "Распознано 3 из 5 страниц-сканов.",
  );
});

test("ocrNotice: нечего говорить", () => {
  assert.equal(ocrNotice({}, none), null);
  assert.equal(ocrNotice(null, none), null);
  assert.equal(ocrNotice(undefined, none), null);
  assert.equal(ocrNotice({ scanned: 3, attempted: 0, recognized: 0, skipped: "" }, none), null);
  assert.equal(ocrNotice({ scanned: 5, attempted: 5, recognized: 5, skipped: "" }, none), null);
});

test("unrecognizedScans", () => {
  assert.equal(unrecognizedScans({ scanned: 25, recognized: 5 }), 20);
  assert.equal(unrecognizedScans({ scanned: 2, recognized: 5 }), 0);
  assert.equal(unrecognizedScans({}), 0);
  assert.equal(unrecognizedScans(null), 0);
});

test("canRecognizeLater", () => {
  assert.equal(canRecognizeLater({ scanned: 25, attempted: 0, recognized: 0, skipped: "quota", reset_at: AT_1840, plan: "free" }), true);
  assert.equal(canRecognizeLater({ scanned: 5, attempted: 5, recognized: 3, skipped: "" }), true);
  assert.equal(canRecognizeLater({ scanned: 120, attempted: 0, recognized: 0, skipped: "window", plan: "free" }), false);
  assert.equal(canRecognizeLater({ scanned: 120, attempted: 40, recognized: 40, skipped: "" }), false);
  assert.equal(canRecognizeLater({ scanned: 3, attempted: 0, recognized: 0, skipped: "" }), false);
  assert.equal(canRecognizeLater({}), false);
  assert.equal(canRecognizeLater({ scanned: 5, attempted: 5, recognized: 3, skipped: "", stopped: "time" }), false);
});

test("planProfilingNotice", () => {
  const text = "Программа составлена без подробного разбора глав.";
  assert.equal(planProfilingNotice(["plan_profiling_skipped"]), text);
  assert.equal(planProfilingNotice(["x", "plan_profiling_partial"]), text);
  assert.equal(planProfilingNotice(["x"]), null);
  assert.equal(planProfilingNotice(undefined), null);
});

test("scansQuestion склоняет страницы и местоимения", () => {
  assert.deepEqual(scansQuestion(1), {
    text: "В программу не попадёт 1 страница. Подождать лимит и распознать её или составить без неё?",
    skip: "Составить без неё",
  });
  assert.deepEqual(scansQuestion(3), {
    text: "В программу не попадут 3 страницы. Подождать лимит и распознать их или составить без них?",
    skip: "Составить без них",
  });
  assert.deepEqual(scansQuestion(21), {
    text: "В программу не попадёт 21 страница. Подождать лимит и распознать их или составить без них?",
    skip: "Составить без них",
  });
  assert.deepEqual(scansQuestion(25), {
    text: "В программу не попадут 25 страниц. Подождать лимит и распознать их или составить без них?",
    skip: "Составить без них",
  });
});

test("тексты ошибок сервера для timed_out и ocr_quota показываются как есть", () => {
  const timed = "Обработка заняла больше часа и остановлена.";
  const q = "В книге одни сканы, а лимита на их распознавание не хватило. Файл сохранён.";
  assert.equal(ingestionErrorMessage("timed_out", timed), timed);
  assert.equal(ingestionErrorMessage("ocr_quota", q), q);
});

test("ocr_failed переведён дословно", () => {
  assert.equal(
    ERROR_MESSAGES.ocr_failed,
    "Сканы не распознались: сервис распознавания не ответил. Попробуй ещё раз позже.",
  );
});

test("scansQuestion: причина «failed»", () => {
  assert.deepEqual(scansQuestion(1, "failed"), {
    text: "В программу не попадёт 1 страница: её не удалось распознать. Обработать книгу заново или составить без неё?",
    skip: "Составить без неё",
  });
  assert.deepEqual(scansQuestion(3, "failed"), {
    text: "В программу не попадут 3 страницы: их не удалось распознать. Обработать книгу заново или составить без них?",
    skip: "Составить без них",
  });
  assert.deepEqual(scansQuestion(21, "failed"), {
    text: "В программу не попадёт 21 страница: их не удалось распознать. Обработать книгу заново или составить без них?",
    skip: "Составить без них",
  });
  assert.deepEqual(scansQuestion(25, "failed"), {
    text: "В программу не попадут 25 страниц: их не удалось распознать. Обработать книгу заново или составить без них?",
    skip: "Составить без них",
  });
});
