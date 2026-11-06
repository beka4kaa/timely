// Управляющие команды помощника по расписанию в мини-окне.
//
// Модуль не зависит от React: slash-токен разбирается локально и никогда не
// становится частью сообщения модели.
//
// Окно спрашивает «Что поменять?», поэтому при наличии расписания обычное сообщение
// идёт в режиме `plan`: он только готовит предложение, а применяет его сам ученик. Совет
// без изменений остаётся за `/advice`.

export type ScheduleAssistantMode = "advice" | "plan";
export type ScheduleCommandId = "start" | "plan" | "advice";

export interface ScheduleCommand {
  id: ScheduleCommandId;
  command: string;
  aliases: readonly string[];
  title: string;
  description: string;
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
  | { kind: "arm_advice" }
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
  {
    id: "advice",
    command: "/advice",
    aliases: ["/совет"],
    title: "Только совет",
    description: "Оценить нагрузку и подсказать, ничего не меняя.",
  },
] as const;

/** Обычное сообщение без команды готовит изменение. Пустой календарь не исключение: первое расписание создаёт сам помощник. */
export const DEFAULT_SCHEDULE_MODE: ScheduleAssistantMode = "plan";

export function scheduleCommands(): ScheduleCommand[] {
  return COMMAND_DEFINITIONS.map((definition) => ({
    ...definition,
    aliases: [...definition.aliases],
  }));
}

/** Меню открывается только во время набора самого первого slash-токена. */
export function slashQuery(value: string): string | null {
  const trimmedStart = value.trimStart();
  if (!trimmedStart.startsWith("/") || /\s/.test(trimmedStart)) return null;
  return trimmedStart.toLocaleLowerCase("ru-RU");
}

export function matchingScheduleCommands(value: string): ScheduleCommand[] {
  const query = slashQuery(value);
  if (query === null) return [];

  return scheduleCommands().filter((item) =>
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
): ScheduleSubmission {
  const message = value.trim();
  if (!message) return { kind: "empty" };

  const parsed = parseScheduleCommand(message);
  if (parsed?.id === "start") {
    return { kind: "start" };
  }
  if (parsed?.id === "plan") {
    return parsed.argument
      ? { kind: "message", message: parsed.argument, mode: "plan" }
      : { kind: "arm_plan" };
  }
  if (parsed?.id === "advice") {
    return parsed.argument
      ? { kind: "message", message: parsed.argument, mode: "advice" }
      : { kind: "arm_advice" };
  }
  if (message.startsWith("/")) {
    return {
      kind: "error",
      message: "Неизвестная команда. Доступны /start, /plan и /advice.",
    };
  }
  return { kind: "message", message, mode: pendingMode };
}
