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
    label: "Проверяем файл",
    statuses: ["uploaded", "queued", "validating"],
  },
  {
    key: "reading",
    label: "Читаем страницы",
    statuses: ["extracting_native_text", "classifying_pages", "ocr"],
  },
  {
    key: "structuring",
    label: "Разбираем структуру",
    statuses: ["reconstructing_structure", "extracting_blocks", "chunking"],
  },
  {
    key: "indexing",
    label: "Готовим поиск по книге",
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

const ERROR_MESSAGES: Record<string, string> = {
  // Самый вероятный случай в реальности: скан без подключённого распознавания.
  no_content:
    "Не удалось извлечь текст. Похоже, это скан страниц, а распознавание пока не подключено.",
  no_file: "Файл документа не найден в хранилище. Попробуйте загрузить его заново.",
  pdf_unreadable: "Файл повреждён или это не PDF — открыть его не удалось.",
  epub_unreadable: "EPUB повреждён или не содержит читаемого текста.",
  unsupported_document_type: "Формат файла не поддерживается. Загрузите PDF или EPUB.",
  no_pages: "В документе не нашлось ни одной страницы с текстом.",
  storage_unavailable: "Хранилище файлов сейчас недоступно. Попробуйте позже.",
  queue_unavailable:
    "Очередь обработки сейчас недоступна. Файл сохранён — попробуйте позже.",
  stalled:
    "Обработка прервалась: задача давно не обновляла состояние. Файл сохранён — попробуйте запустить обработку заново.",
  ingest_timeout: "Обработка заняла слишком много времени и была остановлена.",
  internal_error: "Во время обработки произошла ошибка. Мы уже знаем о ней.",
};

export function ingestionErrorMessage(code: string, fallback = ""): string {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return fallback || "Обработать документ не удалось.";
}

export function ingestionFailureTitle(stalled: boolean): string {
  return stalled ? "Обработка прервалась" : "Обработать учебник не удалось";
}

const WARNING_MESSAGES: Record<string, string> = {
  ocr_not_configured:
    "Часть страниц выглядит как сканы, но распознавание не подключено — их текст в программу не попадёт.",
  antivirus_not_configured: "Проверка файла антивирусом не настроена.",
  // Сигнал для эксплуатации, а не для ученика: точный счётчик токенов не
  // загрузился, и книга разбита приближённо. Границы фрагментов при этом
  // отличаются от эталонных, хотя версия обработки та же.
  tokenizer_fallback_heuristic:
    "Точный счётчик токенов недоступен — книга разбита приближённо.",
};

/**
 * Предупреждения бэкенда человеческим языком.
 *
 * Часть из них параметрическая (`ocr_limited_to_3_of_40_pages`), поэтому кроме
 * таблицы есть разбор по шаблону. Неизвестный код показываем как есть: молча
 * прятать предупреждение хуже, чем показать его технично.
 */
export function ingestionWarningMessage(code: string): string {
  if (WARNING_MESSAGES[code]) return WARNING_MESSAGES[code];

  const ocrLimit = /^ocr_limited_to_(\d+)_of_(\d+)_pages$/.exec(code);
  if (ocrLimit) {
    return `Распознано только ${ocrLimit[1]} страниц из ${ocrLimit[2]} — остальные пропущены ради скорости.`;
  }

  const pageLimit = /^processed_only_(\d+)_of_(\d+)_pages$/.exec(code);
  if (pageLimit) {
    return `Обработано ${pageLimit[1]} страниц из ${pageLimit[2]}.`;
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
    return { ok: false, error: "Поддерживаются только файлы PDF и EPUB." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Файл пустой." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(file.size / 1024 / 1024);
    return { ok: false, error: `Файл слишком большой: ${mb} МБ при лимите 60 МБ.` };
  }
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
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
      typeof to === "number" && to > from ? `стр. ${from}–${to}` : `стр. ${from}`,
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
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

/** Прошедшее время на экране ожидания: «2:05». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
