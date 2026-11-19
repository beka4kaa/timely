// Чистая логика экрана обработки учебника.
//
// Здесь нет React и нет сети — только преобразования, которые нужно проверять
// тестами: укрупнение шагов пайплайна, расписание опроса и перевод кодов ошибок
// в человеческий текст. Компонент остаётся тонким и занимается только отрисовкой.
//
// Бэкенд отдаёт свою группировку в полях `phase`/`phase_label`, и она — источник
// правды. Дублирующая таблица здесь нужна для двух вещей: показать все фазы сразу
// (в том числе будущие, которых в ответе ещё нет) и пережить ответ старой версии
// бэкенда, где полей `phase*` может не оказаться.

import { resetPhrase } from "./ai-limit.ts";
import { fill, msg, plural, t } from "./i18n";

/** Статусы пайплайна из `Document.Status` на бэкенде. */
export type IngestionStatusCode =
  | "uploaded"
  | "queued"
  | "validating"
  | "extracting_native_text"
  | "classifying_pages"
  | "ocr"
  | "reconstructing_structure"
  | "extracting_blocks"
  | "chunking"
  | "indexing"
  | "quality_check"
  | "ready"
  | "failed";

export type PhaseKey = "checking" | "reading" | "structuring" | "indexing";

export interface PhaseDescriptor {
  key: PhaseKey;
  label: string;
  statuses: readonly IngestionStatusCode[];
}

/** Четыре фазы для человека. Порядок совпадает с `curriculum/progress.py`. */
export const PHASES: readonly PhaseDescriptor[] = [
  {
    key: "checking",
    label: msg("Проверяем файл"),
    statuses: ["uploaded", "queued", "validating"],
  },
  {
    key: "reading",
    label: msg("Читаем страницы"),
    statuses: ["extracting_native_text", "classifying_pages", "ocr"],
  },
  {
    key: "structuring",
    label: msg("Разбираем структуру"),
    statuses: ["reconstructing_structure", "extracting_blocks", "chunking"],
  },
  {
    key: "indexing",
    label: msg("Готовим поиск по книге"),
    statuses: ["indexing", "quality_check", "ready"],
  },
];

const STATUS_TO_PHASE = new Map<IngestionStatusCode, PhaseKey>(
  PHASES.flatMap((phase) => phase.statuses.map((s) => [s, phase.key] as const)),
);

export const TERMINAL_STATUSES: readonly IngestionStatusCode[] = ["ready", "failed"];

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Индекс текущей фазы. У `failed` фазы нет: экран ошибки не показывает прогресс,
 * и делать вид, что «мы на третьем шаге из четырёх», было бы враньём.
 */
export function phaseIndexFor(status: string): number {
  if (status === "failed") return -1;
  const key = STATUS_TO_PHASE.get(status as IngestionStatusCode);
  if (!key) return 0;
  return PHASES.findIndex((phase) => phase.key === key);
}

export type PhaseState = "done" | "active" | "pending";

export function phaseState(phaseIdx: number, currentIdx: number): PhaseState {
  if (currentIdx < 0) return "pending";
  if (phaseIdx < currentIdx) return "done";
  if (phaseIdx === currentIdx) return "active";
  return "pending";
}

// ─────────────────────────────── Опрос ───────────────────────────────────────

/**
 * Интервал опроса в миллисекундах.
 *
 * Обработка занимает от секунд до минут, поэтому частота падает со временем:
 * первую минуту человек смотрит на экран и ждёт реакции, а на пятой минуте
 * лишние запросы только греют сеть. Возвращается интервал ДО следующего опроса.
 */
export function pollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 2_000;
  if (elapsedMs < 300_000) return 5_000;
  return 10_000;
}

/**
 * Пауза перед повтором после сетевой ошибки: 1с, 2с, 4с… но не дольше 30с.
 *
 * Обрыв не повод сдаваться — редеплой бэкенда посреди обработки это норма.
 */
export function retryDelayMs(consecutiveFailures: number): number {
  const capped = Math.min(Math.max(consecutiveFailures, 1), 6);
  return Math.min(1_000 * 2 ** (capped - 1), 30_000);
}

/** После скольких неудач подряд честно сказать, что связь потеряна. */
export const FAILURES_BEFORE_WARNING = 3;

// ────────────────────────── Ошибки обработки ─────────────────────────────────

export const ERROR_MESSAGES: Record<string, string> = {
  // Самый вероятный случай в реальности: скан без подключённого распознавания.
  no_content:
    msg("Не удалось извлечь текст. Похоже, это скан страниц, а распознавание пока не подключено."),
  no_file: msg("Файл книги не нашёлся в хранилище. Попробуй загрузить его заново."),
  pdf_unreadable: msg("Файл повреждён или это не PDF — открыть его не удалось."),
  epub_unreadable: msg("EPUB повреждён или не содержит читаемого текста."),
  unsupported_document_type: msg("Такой формат не подходит. Загрузи PDF или EPUB."),
  no_pages: msg("В документе не нашлось ни одной страницы с текстом."),
  storage_unavailable: msg("Хранилище файлов сейчас недоступно. Попробуй позже."),
  queue_unavailable:
    msg("Очередь обработки сейчас недоступна. Файл сохранён, попробуй позже."),
  stalled:
    msg("Обработка прервалась и давно не двигается. Файл сохранён, запусти обработку заново."),
  ingest_timeout: msg("Обработка заняла слишком много времени и была остановлена."),
  ocr_failed:
    msg("Сканы не распознались: сервис распознавания не ответил. Попробуй ещё раз позже."),
  internal_error: msg("Во время обработки произошла ошибка. Мы уже знаем о ней."),
};

export function ingestionErrorMessage(code: string, fallback = ""): string {
  if (ERROR_MESSAGES[code]) return t(ERROR_MESSAGES[code]);
  return fallback ? t(fallback) : t("Обработать документ не удалось.");
}

export function ingestionFailureTitle(stalled: boolean): string {
  return stalled ? t("Обработка прервалась") : t("Прочитать учебник не удалось");
}

const WARNING_MESSAGES: Record<string, string> = {
  ocr_not_configured:
    msg("Часть страниц выглядит как сканы, а распознавание не подключено. Их текст в программу не попадёт."),
  antivirus_not_configured: msg("Проверка файла антивирусом не настроена."),
  // Сигнал для эксплуатации, а не для ученика: точный счётчик токенов не
  // загрузился, и книга разбита приближённо. Границы фрагментов при этом
  // отличаются от эталонных, хотя версия обработки та же.
  tokenizer_fallback_heuristic:
    msg("Точный счётчик токенов недоступен, поэтому книга разбита приближённо."),
};

/**
 * Предупреждения бэкенда человеческим языком.
 *
 * Часть из них параметрическая (`ocr_limited_to_3_of_40_pages`), поэтому кроме
 * таблицы есть разбор по шаблону. Неизвестный код показываем как есть: молча
 * прятать предупреждение хуже, чем показать его технично.
 */
export function ingestionWarningMessage(code: string): string {
  if (WARNING_MESSAGES[code]) return t(WARNING_MESSAGES[code]);

  const ocrLimit = /^ocr_limited_to_(\d+)_of_(\d+)_pages$/.exec(code);
  if (ocrLimit) {
    return t("Распознано только {done} страниц из {total}, остальные пропущены ради скорости.", {
      done: ocrLimit[1],
      total: ocrLimit[2],
    });
  }

  const pageLimit = /^processed_only_(\d+)_of_(\d+)_pages$/.exec(code);
  if (pageLimit) {
    return t("Обработано {done} страниц из {total}.", { done: pageLimit[1], total: pageLimit[2] });
  }

  return code;
}

// ──────────────────────────── Загрузка файла ─────────────────────────────────

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".pdf", ".epub"] as const;

export interface FileCheck {
  ok: boolean;
  error?: string;
}

/**
 * Быстрая проверка на клиенте — чтобы не гнать заведомо негодный файл через сеть.
 * Настоящая проверка всё равно на бэкенде: там смотрят magic-байты, а не имя.
 */
export function checkFileBeforeUpload(file: {
  name: string;
  size: number;
  type: string;
}): FileCheck {
  const name = file.name.toLowerCase();
  const hasAllowedExtension = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!hasAllowedExtension) {
    return { ok: false, error: t("Поддерживаются только файлы PDF и EPUB.") };
  }
  if (file.size === 0) {
    return { ok: false, error: t("Файл пустой.") };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(file.size / 1024 / 1024);
    return { ok: false, error: t("Файл слишком большой: {mb} МБ при лимите 60 МБ.", { mb }) };
  }
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t("{n} Б", { n: bytes });
  if (bytes < 1024 * 1024) return t("{n} КБ", { n: Math.round(bytes / 1024) });
  return t("{n} МБ", { n: (bytes / 1024 / 1024).toFixed(1) });
}

// ─────────────────────────────── Цитаты ──────────────────────────────────────

export interface TopicSource {
  section_path?: string | null;
  page_start?: number | null;
  page_end?: number | null;
}

/**
 * Ссылка на источник: «§2.1, стр. 34–37».
 *
 * Именно это отличает программу по учебнику от программы, придуманной моделью,
 * поэтому формат должен читаться, а не выглядеть отладочным выводом.
 * У EPUB страниц нет — тогда остаётся только раздел.
 */
export function formatSource(source: TopicSource): string {
  const parts: string[] = [];
  const path = (source.section_path || "").trim();
  if (path) parts.push(`§${path}`);

  const from = source.page_start;
  const to = source.page_end;
  if (typeof from === "number" && from > 0) {
    parts.push(
      typeof to === "number" && to > from
        ? t("стр. {from}–{to}", { from, to })
        : t("стр. {from}", { from }),
    );
  }
  return parts.join(", ");
}

/**
 * Ссылки на источники без повторов, в исходном порядке.
 *
 * У одной темы обычно несколько фрагментов, и они часто лежат на одной странице
 * одного раздела. Без схлопывания получается «§1.2, стр. 1» три раза подряд —
 * это шум, который обесценивает саму идею провенанса.
 */
export function uniqueSourceLabels(sources: readonly TopicSource[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const source of sources) {
    const label = formatSource(source);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** Длительность в минутах человеческим языком: «1 ч 30 мин». */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return t("{n} мин", { n: rest });
  if (rest === 0) return t("{n} ч", { n: hours });
  return t("{h} ч {m} мин", { h: hours, m: rest });
}

/** Прошедшее время на экране ожидания: «2:05». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ─────────────────────── Сканы, лимит и программа ────────────────────────────

/** Сводка распознавания сканов из `ocr_summary`. У старых книг приходит `{}`. */
export type OcrSummary = {
  scanned: number;
  attempted: number;
  recognized: number;
  skipped: "" | "quota" | "window";
  reset_at?: string;
  plan?: string;
  stopped?: "time";
};

type Summary = Partial<OcrSummary> | null | undefined;

function read(summary: Summary) {
  return {
    scanned: summary?.scanned ?? 0,
    attempted: summary?.attempted ?? 0,
    recognized: summary?.recognized ?? 0,
    skipped: summary?.skipped ?? "",
  };
}

export function unrecognizedScans(summary: Summary): number {
  const { scanned, recognized } = read(summary);
  return Math.max(0, scanned - recognized);
}

/** Повтор обработки помогает, только если лимита не хватило сейчас или страницы упали из-за сбоя. */
export function canRecognizeLater(summary: Summary): boolean {
  if (summary?.stopped === "time") return false;
  const { attempted, recognized, skipped } = read(summary);
  return skipped === "quota" || recognized < attempted;
}

export function ocrNotice(
  summary: Summary,
  options: { hasProgram: boolean; now?: Date },
): string | null {
  const { scanned, attempted, recognized, skipped } = read(summary);
  const now = options.now ?? new Date();

  if (skipped === "quota" || skipped === "window") {
    const head = plural(
      scanned,
      "Не распознана {n} страница-скан",
      "Не распознано {n} страницы-скана",
      "Не распознано {n} страниц-сканов",
    );
    if (skipped === "window") {
      return summary?.plan === "free"
        ? t("{head}: на бесплатном тарифе столько не распознать за раз.", { head })
        : t("{head}: на твоём тарифе столько не распознать за раз.", { head });
    }
    const phrase = resetPhrase(summary?.reset_at, now);
    const base = t("{head}: не хватило лимита.", { head });
    if (options.hasProgram) {
      return phrase ? t("{base} Он восстановится {when}.", { base, when: phrase }) : base;
    }
    return phrase
      ? t("{base} Он восстановится {when}, тогда нажми «Обработать заново».", { base, when: phrase })
      : t("{base} Нажми «Обработать заново», когда он восстановится.", { base });
  }

  if (attempted > 0 && scanned > attempted) {
    if (recognized >= attempted) {
      return fill(
        plural(
          attempted,
          "Распознаны первые {n} страница-скан из {total}: больше за одну обработку нельзя.",
          "Распознаны первые {n} страницы-скана из {total}: больше за одну обработку нельзя.",
          "Распознаны первые {n} страниц-сканов из {total}: больше за одну обработку нельзя.",
        ),
        { total: scanned },
      );
    }
    return fill(
      plural(
        scanned,
        "Распознано {recognized} из {n} страницы-скана: больше {attempted} за одну обработку нельзя.",
        "Распознано {recognized} из {n} страниц-сканов: больше {attempted} за одну обработку нельзя.",
        "Распознано {recognized} из {n} страниц-сканов: больше {attempted} за одну обработку нельзя.",
      ),
      { recognized, attempted },
    );
  }
  if (attempted > 0 && recognized < attempted) {
    return fill(
      plural(
        attempted,
        "Распознано {recognized} из {n} страницы-скана.",
        "Распознано {recognized} из {n} страниц-сканов.",
        "Распознано {recognized} из {n} страниц-сканов.",
      ),
      { recognized },
    );
  }
  return null;
}

export function planProfilingNotice(warnings: string[] | undefined): string | null {
  const partial = (warnings ?? []).some(
    (w) => w === "plan_profiling_skipped" || w === "plan_profiling_partial",
  );
  return partial ? t("Программа составлена без подробного разбора глав.") : null;
}

/** Вопрос перед программой, когда часть сканов не распознана, и подпись кнопки «без них». */
export function scansQuestion(
  count: number,
  reason: "quota" | "failed" = "quota",
): { text: string; skip: string } {
  const what = plural(
    count,
    "не попадёт {n} страница",
    "не попадут {n} страницы",
    "не попадут {n} страниц",
  );
  const single = count === 1;
  const skip = single ? t("Составить без неё") : t("Составить без них");
  if (reason === "failed") {
    return {
      text: single
        ? t("В программу {what}: её не удалось распознать. Обработать книгу заново или составить без неё?", { what })
        : t("В программу {what}: их не удалось распознать. Обработать книгу заново или составить без них?", { what }),
      skip,
    };
  }
  return {
    text: single
      ? t("В программу {what}. Подождать лимит и распознать её или составить без неё?", { what })
      : t("В программу {what}. Подождать лимит и распознать их или составить без них?", { what }),
    skip,
  };
}
