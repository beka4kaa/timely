import type { WhiteboardAction } from "@/stores/whiteboard";

type RawCommand = Record<string, any>;

type RawStep = {
  title?: string;
  step_number?: number;
  commands?: RawCommand[];
};

type BuildLectureActionsInput = {
  boardSteps: RawStep[];
  baseX: number;
  baseY: number;
  maxColumnHeight: number;
  generationStyle: string;
  now?: number;
};

type TextVariant = "heading" | "body" | "formula" | "table";

const COLUMN_WIDTH = 320;
const COLUMN_GAP = 54;
const ITEM_GAP = 22;
const SECTION_GAP = 34;
const MIN_COLUMN_HEIGHT = 520;
const MAX_COLUMN_HEIGHT = 760;
const IMAGE_WIDTH = 520;
const IMAGE_HEIGHT = 338;

const FONT_BY_VARIANT: Record<TextVariant, number> = {
  heading: 24,
  body: 19,
  formula: 22,
  table: 16,
};

const LINE_HEIGHT_BY_VARIANT: Record<TextVariant, number> = {
  heading: 1.18,
  body: 1.28,
  formula: 1.2,
  table: 1.35,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function visibleLength(text: string): number {
  return text
    .replace(/\$[^$]*\$/g, "MMMM")
    .replace(/[^\S\n]+/g, " ")
    .length;
}

function charsPerLine(variant: TextVariant): number {
  const fontSize = FONT_BY_VARIANT[variant];
  const charWidth = variant === "table" ? fontSize * 0.62 : fontSize * 0.52;
  return Math.max(18, Math.floor(COLUMN_WIDTH / charWidth));
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .filter(Boolean);

  if (sentences.length <= 1) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (visibleLength(next) > maxChars && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (visibleLength(next) > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) =>
    visibleLength(chunk) > maxChars * 1.25 && /\s/.test(chunk)
      ? splitLongParagraph(chunk, maxChars)
      : [chunk]
  );
}

function splitTextIntoLectureBlocks(content: string, variant: TextVariant): string[] {
  const normalized = normalizeText(content);
  if (!normalized) return [];

  if (variant === "formula") return [normalized.replace(/^\$|\$$/g, "").trim()];

  const maxLines = variant === "heading" ? 2 : variant === "table" ? 9 : 7;
  const maxChars = charsPerLine(variant) * maxLines;
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const source = paragraphs.length ? paragraphs : [normalized];
  return source.flatMap((paragraph) =>
    visibleLength(paragraph) <= maxChars ? [paragraph] : splitLongParagraph(paragraph, maxChars)
  );
}

function estimateTextHeight(content: string, variant: TextVariant): number {
  const perLine = charsPerLine(variant);
  const fontSize = FONT_BY_VARIANT[variant];
  const lineHeight = LINE_HEIGHT_BY_VARIANT[variant];
  const lines = normalizeText(content)
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(visibleLength(line) / perLine)), 0);
  return Math.ceil(lines * fontSize * lineHeight + (variant === "heading" ? 6 : 10));
}

function formatTableCommand(command: RawCommand): string {
  const headers = Array.isArray(command.headers) ? command.headers.map(String) : [];
  const rows = Array.isArray(command.rows)
    ? command.rows.filter(Array.isArray).map((row: unknown[]) => row.map(String))
    : [];
  const allRows = headers.length ? [headers, ...rows] : rows;
  if (!allRows.length) return "";

  const columnCount = Math.max(...allRows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.min(18, Math.max(...allRows.map((row) => (row[index] ?? "").length), 3))
  );

  const renderRow = (row: string[]) =>
    row
      .map((cell, index) => {
        const clipped = cell.length > widths[index] ? `${cell.slice(0, widths[index] - 1)}…` : cell;
        return clipped.padEnd(widths[index], " ");
      })
      .join("  ");

  const rendered = allRows.map(renderRow);
  if (headers.length && rendered.length > 1) {
    rendered.splice(1, 0, widths.map((w) => "-".repeat(w)).join("  "));
  }
  return rendered.join("\n");
}

function formatBarChartCommand(command: RawCommand): string {
  const title = typeof command.title === "string" ? command.title.trim() : "";
  const labels = Array.isArray(command.labels) ? command.labels : [];
  const values = Array.isArray(command.values) ? command.values : [];
  const rows = labels.map((label, index) => `${String(label)}: ${String(values[index] ?? 0)}`);
  return [title, ...rows].filter(Boolean).join("\n");
}

/** Иллюстрация, поставленная плейсхолдером: растр догружается отдельно. */
export interface PendingIllustration {
  /** id элемента на холсте — по нему подставляем картинку через UPDATE_ELEMENT. */
  elementId: string;
  /** Исходная команда image_with_labels с image_prompt. */
  command: RawCommand;
}

export interface BuildLectureActionsResult {
  actions: WhiteboardAction[];
  pendingIllustrations: PendingIllustration[];
}

export function buildLectureWhiteboardActions({
  boardSteps,
  baseX,
  baseY,
  maxColumnHeight,
  generationStyle,
  now = Date.now(),
}: BuildLectureActionsInput): BuildLectureActionsResult {
  const actions: WhiteboardAction[] = [];
  // Иллюстрации, для которых растр ещё предстоит догрузить (прогрессивная
  // выдача). Вызывающий проходит по списку и дёргает /api/ai/illustration,
  // подставляя результат в элемент с тем же elementId.
  const pendingIllustrations: PendingIllustration[] = [];
  const columnTop = baseY;
  const columnHeight = clamp(maxColumnHeight, MIN_COLUMN_HEIGHT, MAX_COLUMN_HEIGHT);
  const columnBottom = columnTop + columnHeight;
  const stride = COLUMN_WIDTH + COLUMN_GAP;
  const reservedUntil: number[] = [];
  let column = 0;
  let x = baseX;
  let y = columnTop;
  let serial = 0;

  const jumpToColumn = (nextColumn: number) => {
    column = nextColumn;
    x = baseX + column * stride;
    y = Math.max(columnTop, reservedUntil[column] ?? columnTop);
  };

  const reserveColumns = (width: number, height: number, gap = ITEM_GAP) => {
    const span = Math.max(1, Math.ceil((width + COLUMN_GAP) / stride));
    const until = y + height + gap;
    for (let i = column; i < column + span; i += 1) {
      reservedUntil[i] = Math.max(reservedUntil[i] ?? columnTop, until);
    }
  };

  const ensureSpace = (height: number) => {
    let guard = 0;
    while (y + height > columnBottom && guard < 24) {
      jumpToColumn(column + 1);
      guard += 1;
    }
  };

  const pushText = (content: string, variant: TextVariant) => {
    const blocks = splitTextIntoLectureBlocks(content, variant);
    for (const block of blocks) {
      const height = estimateTextHeight(block, variant);
      ensureSpace(height);
      const id = `ai-${now}-${serial++}`;
      actions.push({
        type: "CREATE_TEXT",
        payload: {
          id,
          position: { x, y },
          content: variant === "formula" ? `$${block.replace(/^\$|\$$/g, "").trim()}$` : block,
          width: COLUMN_WIDTH,
          fontSize: FONT_BY_VARIANT[variant],
          lineHeight: LINE_HEIGHT_BY_VARIANT[variant],
          // Цвет НЕ задаём. Инлайновый color перебивает классы рендерера
          // (`text-slate-950 dark:text-zinc-100`), а зашит тут был #f8fafc —
          // почти белый. В тёмной теме это выглядело нормально, а в светлой
          // текст лекции становился невидимым на светлом холсте.
          variant,
        },
      });
      reserveColumns(COLUMN_WIDTH, height, ITEM_GAP);
      y += height + ITEM_GAP;
    }
  };

  const pushIllustration = (command: RawCommand) => {
    const baseImageUrl = command.base_image_url || command.image_url;
    // Прогрессивная выдача: команда без картинки, но с image_prompt — это ещё
    // не сгенерированная иллюстрация. Занимаем под неё место сразу и ставим
    // плейсхолдер; растр подставит чат через UPDATE_ELEMENT, когда догрузит.
    const pending = !baseImageUrl && Boolean(command.image_prompt);
    if (!baseImageUrl && !pending) return false;
    ensureSpace(IMAGE_HEIGHT);
    const id = `ai-${now}-${serial++}`;
    actions.push({
      type: "CREATE_ILLUSTRATION",
      payload: {
        id,
        position: { x, y },
        src: baseImageUrl || "",
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        rotation: 0,
        labels: Array.isArray(command.labels) ? command.labels : [],
        masks: Array.isArray(command.masks) ? command.masks : null,
        alt: typeof command.alt === "string" ? command.alt : undefined,
        genStyle: typeof command.gen_style === "string" ? command.gen_style : generationStyle,
        // Сюжет нужен для последующего рестайла «сделай в стиле скетч»:
        // по нему картинку перерисовывают, не поднимая board-модель.
        imagePrompt:
          typeof command.image_prompt === "string" ? command.image_prompt : undefined,
        pending: pending || undefined,
      },
    });
    if (pending) pendingIllustrations.push({ elementId: id, command });
    reserveColumns(IMAGE_WIDTH, IMAGE_HEIGHT, SECTION_GAP);
    y += IMAGE_HEIGHT + SECTION_GAP;
    return true;
  };

  const pushShape = (command: RawCommand) => {
    const id = `ai-${now}-${serial++}`;
    const type = command.type;
    if (type === "circle") {
      const r = asNumber(command.r, 50);
      actions.push({
        type: "DRAW_SHAPE",
        payload: {
          id,
          shape: "ellipse",
          position: { x: baseX + asNumber(command.x) - r, y: baseY + asNumber(command.y) - r },
          width: r * 2,
          height: r * 2,
          color: command.color || "#ffffff",
        },
      });
      return;
    }
    if (type === "rect") {
      actions.push({
        type: "DRAW_SHAPE",
        payload: {
          id,
          shape: "rect",
          position: { x: baseX + asNumber(command.x), y: baseY + asNumber(command.y) },
          width: asNumber(command.w, 100),
          height: asNumber(command.h, 100),
          color: command.color || "#ffffff",
        },
      });
      return;
    }
    if (type === "line") {
      const x1 = asNumber(command.x1);
      const y1 = asNumber(command.y1);
      const x2 = asNumber(command.x2);
      const y2 = asNumber(command.y2);
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      actions.push({
        type: "DRAW_SHAPE",
        payload: {
          id,
          shape: "line",
          position: { x: baseX + minX, y: baseY + minY },
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          flip: (x1 < x2 && y1 > y2) || (x1 > x2 && y1 < y2),
          color: command.color || "#ffffff",
        },
      });
    }
  };

  const meaningfulSteps = boardSteps.filter((step) => Array.isArray(step.commands) && step.commands.length > 0);
  meaningfulSteps.forEach((step, stepIndex) => {
    const title = normalizeText(step.title);
    if (title && meaningfulSteps.length > 1) {
      pushText(`${stepIndex + 1}. ${title}`, "heading");
    }

    for (const command of step.commands ?? []) {
      if (!command || typeof command !== "object") continue;
      if (command.type === "image_with_labels") {
        if (!pushIllustration(command) && command.image_error) {
          const message =
            typeof command.image_error === "object"
              ? command.image_error.message
              : String(command.image_error);
          pushText(`Ошибка генерации изображения: ${message}`, "body");
        }
      } else if (command.type === "text") {
        pushText(command.content || "", "body");
      } else if (command.type === "formula") {
        pushText(command.content || "", "formula");
      } else if (command.type === "table") {
        pushText(formatTableCommand(command), "table");
      } else if (command.type === "barchart") {
        pushText(formatBarChartCommand(command), "table");
      } else if (command.type === "circle" || command.type === "rect" || command.type === "line") {
        pushShape(command);
      }
    }
  });

  return { actions, pendingIllustrations };
}
