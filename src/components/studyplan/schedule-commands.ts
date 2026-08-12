// Управляющие команды правой панели расписания.
//
// Модуль не зависит от React: slash-токен разбирается локально и никогда не
// становится частью сообщения модели.

export type ScheduleAssistantMode = "advice" | "plan";
export type ScheduleCommandId = "start" | "plan";

export interface ScheduleCommand {
  id: ScheduleCommandId;
  command: string;
  aliases: readonly string[];
  title: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
}

export interface ParsedScheduleCommand {
  id: ScheduleCommandId;
  command: string;
  argument: string;
}

export type ScheduleSubmission =
  | { kind: "empty" }
  | { kind: "start" }
  | { kind: "arm_plan" }
  | { kind: "message"; message: string; mode: ScheduleAssistantMode }
  | { kind: "error"; message: string };

const COMMAND_DEFINITIONS = [
  {
    id: "start",
    command: "/start",
    aliases: ["/start-plan", "/start_plan"],
    title: "Создать расписание",
    description: "Ответить на короткие вопросы и получить первый черновик.",
  },
  {
    id: "plan",
    command: "/plan",
    aliases: [],
    title: "Изменить расписание",
    description: "Перенести занятия, разгрузить день или восстановить план.",
  },
] as const;

export function scheduleCommands(
  hasSchedule: boolean,
  canStart = !hasSchedule,
): ScheduleCommand[] {
  return COMMAND_DEFINITIONS.map((definition) => {
    const available = definition.id === "start" ? canStart : hasSchedule;
    return {
      ...definition,
      aliases: [...definition.aliases],
      available,
      unavailableReason:
        definition.id === "start"
          ? "Подтверждённое расписание меняется через /plan"
          : "Сначала создай расписание через /start",
    };
  });
}

/** Меню открывается только во время набора самого первого slash-токена. */
export function slashQuery(value: string): string | null {
  const trimmedStart = value.trimStart();
  if (!trimmedStart.startsWith("/") || /\s/.test(trimmedStart)) return null;
  return trimmedStart.toLocaleLowerCase("ru-RU");
}

export function matchingScheduleCommands(
  value: string,
  hasSchedule: boolean,
  canStart = !hasSchedule,
): ScheduleCommand[] {
  const query = slashQuery(value);
  if (query === null) return [];

  return scheduleCommands(hasSchedule, canStart).filter((item) =>
    [item.command, ...item.aliases].some((token) => token.startsWith(query)),
  );
}

export function parseScheduleCommand(
  value: string,
): ParsedScheduleCommand | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;

  const [token = "", ...rest] = trimmed.split(/\s+/);
  const normalized = token.toLocaleLowerCase("ru-RU");
  const definition = COMMAND_DEFINITIONS.find((candidate) =>
    [candidate.command, ...candidate.aliases].some(
      (candidateToken) => candidateToken === normalized,
    ),
  );
  if (!definition) return null;

  return {
    id: definition.id,
    command: definition.command,
    argument: rest.join(" ").trim(),
  };
}

export function moveCommandSelection(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  length: number,
): number {
  if (length <= 0) return -1;
  if (current < 0) return key === "ArrowDown" ? 0 : length - 1;
  return key === "ArrowDown"
    ? (current + 1) % length
    : (current - 1 + length) % length;
}

/** Превращает содержимое composer в локальное действие или чистое сообщение. */
export function resolveScheduleSubmission(
  value: string,
  pendingMode: ScheduleAssistantMode,
  hasSchedule: boolean,
  canStart = !hasSchedule,
): ScheduleSubmission {
  const message = value.trim();
  if (!message) return { kind: "empty" };

  const parsed = parseScheduleCommand(message);
  if (parsed?.id === "start") {
    return !canStart
      ? { kind: "error", message: "Расписание уже создано — используй /plan." }
      : { kind: "start" };
  }
  if (parsed?.id === "plan") {
    if (!hasSchedule) {
      return {
        kind: "error",
        message: "Сначала создай расписание через /start.",
      };
    }
    return parsed.argument
      ? { kind: "message", message: parsed.argument, mode: "plan" }
      : { kind: "arm_plan" };
  }
  if (message.startsWith("/")) {
    return {
      kind: "error",
      message: "Неизвестная команда. Доступны /start и /plan.",
    };
  }
  return { kind: "message", message, mode: pendingMode };
}
