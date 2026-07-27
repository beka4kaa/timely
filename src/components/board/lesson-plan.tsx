"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  Clock3,
  Loader2,
  Target,
  X,
} from "lucide-react";
import { authFetch } from "../../lib/auth-fetch";
import {
  PlanningQuestionPopover,
  type PlanningPopoverState,
} from "./planning-question-popover";

export type LessonGoal = "understand" | "solve" | "prepare";
export type LessonLevel = "foundation" | "school" | "advanced";
export type LessonResultType = "understand" | "solve_problem" | "prepare";

export interface LessonPlanTask {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
}

export interface LessonPlan {
  id: string;
  topic: string;
  objective: string;
  goal: LessonGoal;
  goalLabel: string;
  level: LessonLevel;
  levelLabel: string;
  durationMinutes: number;
  resultType?: LessonResultType;
  difficulties?: string[];
  successCriteria?: string[];
  tasks: LessonPlanTask[];
}

export interface PlanningInput {
  topic: string;
  goal: LessonGoal;
  level: LessonLevel;
  durationMinutes: number;
  resultType?: LessonResultType;
  difficulties?: string[];
  successCriteria?: string[];
}

const GOAL_OPTIONS: Array<{
  value: LessonGoal;
  label: string;
  description: string;
}> = [
  {
    value: "understand",
    label: "Понять тему",
    description: "Связи, смысл и наглядное объяснение",
  },
  {
    value: "solve",
    label: "Решать задачи",
    description: "Алгоритм, пример и самостоятельный шаг",
  },
  {
    value: "prepare",
    label: "Подготовиться",
    description: "Карта темы, типовые вопросы и проверка",
  },
];

const LEVEL_OPTIONS: Array<{ value: LessonLevel; label: string }> = [
  { value: "foundation", label: "С нуля" },
  { value: "school", label: "Знаком с темой" },
  { value: "advanced", label: "Углублённо" },
];

const DURATION_OPTIONS = [20, 35, 50] as const;

// The board result type is not a second question — it is the same axis as the
// goal, so it is derived rather than asked. The finer "what exactly to do on
// the board" nuance is covered by the adaptive question on the next step.
const GOAL_TO_RESULT_TYPE: Record<LessonGoal, LessonResultType> = {
  understand: "understand",
  solve: "solve_problem",
  prepare: "prepare",
};

// Kept only for labelling the derived value in the planning summary — the
// backend still returns a `result_type` field.
const RESULT_TYPE_LABELS: Record<LessonResultType, string> = {
  understand: "Понять",
  solve_problem: "Решить задачу",
  prepare: "Подготовиться",
};

function taskTemplates(input: PlanningInput) {
  const commonStart = {
    title: "Цель урока",
    description: `Зафиксировать результат по теме «${input.topic}» и исходные знания.`,
  };

  const byGoal: Record<
    LessonGoal,
    Array<{ title: string; description: string }>
  > = {
    understand: [
      {
        title: "Ключевая идея",
        description: "Разобрать основное понятие и причинно-следственные связи.",
      },
      {
        title: "Наглядная схема",
        description: "Собрать визуальную модель без лишних деталей.",
      },
      {
        title: "Разбор примера",
        description: "Применить идею на одном понятном примере.",
      },
    ],
    solve: [
      {
        title: "Разбор условия",
        description: "Выделить известные данные, неизвестное и ограничения.",
      },
      {
        title: "Модель задачи",
        description: "Построить схему и выбрать подходящий способ решения.",
      },
      {
        title: "Решение",
        description: "Пройти алгоритм по шагам и проверить каждый переход.",
      },
    ],
    prepare: [
      {
        title: "Карта темы",
        description: "Собрать ключевые определения и связи между ними.",
      },
      {
        title: "Типовой пример",
        description: "Разобрать задачу или вопрос, который встречается чаще всего.",
      },
      {
        title: "Слабые места",
        description: "Найти потенциальные ошибки и коротко их исправить.",
      },
    ],
  };

  const depthTask =
    input.level === "foundation"
      ? {
          title: "База",
          description: "Уточнить необходимые термины и не пропускать промежуточные шаги.",
        }
      : input.level === "advanced"
        ? {
            title: "Углубление",
            description: "Добавить сложный случай, ограничения и связь с соседними темами.",
          }
        : null;

  const practiceTask =
    input.goal === "understand"
      ? {
          title: "Своя формулировка",
          description: "Объяснить ключевую идею своими словами без подсказки.",
        }
      : input.goal === "solve"
        ? {
            title: "Самостоятельный шаг",
            description: "Выполнить один ключевой этап решения самостоятельно.",
          }
        : {
            title: "Самопроверка",
            description: "Ответить на несколько коротких вопросов по всей теме.",
          };

  const middleTasks = [];
  if (depthTask) middleTasks.push(depthTask);
  middleTasks.push(...byGoal[input.goal]);
  if (input.durationMinutes >= 35) middleTasks.push(practiceTask);
  const finalTask = {
    title: "Проверка",
    description: "Проверить достижение цели и зафиксировать следующий шаг.",
  };

  const maxTasks = input.durationMinutes >= 50 ? 7 : input.durationMinutes >= 35 ? 6 : 5;
  return [
    commonStart,
    ...middleTasks.slice(0, Math.max(0, maxTasks - 2)),
    finalTask,
  ];
}

export function buildLessonPlan(input: PlanningInput): LessonPlan {
  const goalMeta =
    GOAL_OPTIONS.find((option) => option.value === input.goal) ?? GOAL_OPTIONS[0];
  const levelMeta =
    LEVEL_OPTIONS.find((option) => option.value === input.level) ?? LEVEL_OPTIONS[0];
  const templates = taskTemplates(input);
  const baseDuration = Math.max(
    3,
    Math.floor(input.durationMinutes / templates.length),
  );
  let allocated = 0;

  const tasks = templates.map((template, index) => {
    const isLast = index === templates.length - 1;
    const durationMinutes = isLast
      ? Math.max(3, input.durationMinutes - allocated)
      : baseDuration;
    allocated += durationMinutes;

    return {
      id: `task-${index + 1}`,
      ...template,
      durationMinutes,
    };
  });

  return {
    id: `lesson-${Date.now()}`,
    topic: input.topic.trim(),
    objective: goalMeta.description,
    goal: input.goal,
    goalLabel: goalMeta.label,
    level: input.level,
    levelLabel: levelMeta.label,
    durationMinutes: input.durationMinutes,
    ...(input.resultType && { resultType: input.resultType }),
    ...(input.difficulties && { difficulties: input.difficulties }),
    ...(input.successCriteria && { successCriteria: input.successCriteria }),
    tasks,
  };
}

interface PlanningOption {
  id: string;
  label: string;
  description?: string;
}

interface PlanningQuestion {
  id: string;
  text: string;
  options: PlanningOption[];
}

interface PlanningSummary {
  topic: string;
  goal: string;
  result_type: string;
  focus: string;
  level: string;
  duration_minutes: number;
  success_criteria: string[];
}

interface PlanningIntakeResponse {
  type: "planning_intake";
  status: "question" | "complete";
  session_id: string;
  step?: number;
  total_steps_hint?: number;
  question?: PlanningQuestion;
  allow_other?: boolean;
  answers?: Record<string, string | number>;
  summary?: PlanningSummary;
  plan?: LessonPlan;
  fallback?: boolean;
  notice?: string;
  model?: string;
}

type IntakeScreen = "topic" | "intent" | "adaptive" | "context" | "summary";

export function fallbackPlanningQuestion(
  goal: LessonGoal,
  resultType: LessonResultType,
): PlanningQuestion {
  if (goal === "solve" || resultType === "solve_problem") {
    return {
      id: "solution_focus",
      text: "Где именно нужна помощь?",
      options: [
        {
          id: "build_model",
          label: "Построить модель",
          description: "Разметим данные, связи и схему.",
        },
        {
          id: "choose_method",
          label: "Выбрать способ",
          description: "Найдём формулу или алгоритм.",
        },
        {
          id: "full_solution",
          label: "Решить целиком",
          description: "Пройдём решение и проверку.",
        },
      ],
    };
  }
  if (goal === "prepare" || resultType === "prepare") {
    return {
      id: "preparation_focus",
      text: "На чём сделать акцент?",
      options: [
        {
          id: "topic_map",
          label: "Карта темы",
          description: "Свяжем определения и идеи.",
        },
        {
          id: "typical_tasks",
          label: "Типовые задания",
          description: "Разберём частые форматы.",
        },
        {
          id: "knowledge_check",
          label: "Проверка знаний",
          description: "Найдём пробелы вопросами.",
        },
      ],
    };
  }
  return {
    id: "explanation_focus",
    text: "Как лучше разобрать тему?",
    options: [
      {
        id: "concept_links",
        label: "Через связи",
        description: "Покажем зависимости между идеями.",
      },
      {
        id: "visual_example",
        label: "Через пример",
        description: "Начнём с наглядной ситуации.",
      },
      {
        id: "step_by_step",
        label: "По шагам",
        description: "Пойдём от простого к сложному.",
      },
    ],
  };
}

export function buildLocalPlanningSummary(input: {
  topic: string;
  goal: LessonGoal;
  resultType: LessonResultType;
  level: LessonLevel;
  durationMinutes: number;
  focus?: string;
}): PlanningSummary {
  const goalLabel =
    GOAL_OPTIONS.find((option) => option.value === input.goal)?.label ??
    GOAL_OPTIONS[0].label;
  const resultLabel =
    RESULT_TYPE_LABELS[input.resultType] ?? RESULT_TYPE_LABELS.understand;
  const levelLabel =
    LEVEL_OPTIONS.find((option) => option.value === input.level)?.label ??
    LEVEL_OPTIONS[1].label;
  const successCriteria =
    input.goal === "solve"
      ? [
          "Самостоятельно выделить данные и неизвестное",
          "Выбрать способ решения и проверить ответ",
        ]
      : input.goal === "prepare"
        ? [
            "Объяснить ключевые идеи без подсказки",
            "Разобрать типовой проверочный вопрос",
          ]
        : [
            "Объяснить основную идею своими словами",
            "Применить её на понятном примере",
          ];

  return {
    topic: input.topic,
    goal: goalLabel,
    result_type: resultLabel,
    focus: input.focus || resultLabel,
    level: levelLabel,
    duration_minutes: input.durationMinutes,
    success_criteria: successCriteria,
  };
}

export function isLessonPlan(value: unknown): value is LessonPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<LessonPlan>;
  return (
    typeof plan.id === "string" &&
    typeof plan.topic === "string" &&
    Array.isArray(plan.tasks) &&
    plan.tasks.length > 0
  );
}

async function postPlanning(
  payload: Record<string, unknown>,
): Promise<PlanningIntakeResponse> {
  const response = await authFetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok || !data || typeof data !== "object") {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error || "")
        : "";
    throw new Error(message || `Сервер вернул ${response.status}`);
  }
  return data as PlanningIntakeResponse;
}

function ChoiceCard({
  option,
  selected,
  disabled,
  onClick,
  compact = false,
}: {
  option: { value?: string; id?: string; label: string; description?: string };
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`w-full rounded-[13px] border text-left outline-none transition-[border-color,background-color,opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30 disabled:cursor-default ${
        compact ? "px-2.5 py-2" : "px-3 py-2.5"
      } ${
        selected
          ? "border-[#b9803b] bg-[#fff8ec] text-[#443b31]"
          : disabled
            ? "border-[#e1ddd6] bg-white/35 opacity-35"
            : "border-[#ddd8d0] bg-white/62 text-[#514a42] hover:border-[#c9b28e] hover:bg-white"
      }`}
    >
      <span className="block font-serif text-[12px] font-semibold leading-tight">
        {option.label}
      </span>
      {option.description && (
        <span className="mt-1 block text-[10px] leading-snug text-[#938c83]">
          {option.description}
        </span>
      )}
    </button>
  );
}

export function LessonPlanningForm({
  onCreate,
  onPlanningEvent,
  onResetEvents,
}: {
  onCreate: (plan: LessonPlan) => void;
  onPlanningEvent?: (event: string) => void;
  onResetEvents?: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState<LessonGoal | null>(null);
  const [level, setLevel] = useState<LessonLevel | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [screen, setScreen] = useState<IntakeScreen>("topic");
  const [sessionId, setSessionId] = useState("");
  const [adaptiveQuestion, setAdaptiveQuestion] =
    useState<PlanningQuestion | null>(null);
  const [adaptiveAnswers, setAdaptiveAnswers] = useState<Record<string, string>>(
    {},
  );
  const [askedQuestionIds, setAskedQuestionIds] = useState<string[]>([]);
  const [selectedChoiceId, setSelectedChoiceId] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherValue, setOtherValue] = useState("");
  const [summary, setSummary] = useState<PlanningSummary | null>(null);
  const [popoverState, setPopoverState] =
    useState<PlanningPopoverState>("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const requestCounterRef = useRef(0);

  // Derived, not stored: keeping it as separate state allowed goal and
  // resultType to disagree (e.g. goal=understand + result=solve_problem),
  // which downstream code resolved inconsistently.
  const resultType = goal ? GOAL_TO_RESULT_TYPE[goal] : null;

  const emitEvent = useCallback(
    (label: string, value: string) => {
      onPlanningEvent?.(`${label} · ${value}`);
    },
    [onPlanningEvent],
  );

  const baseAnswers = useCallback(
    (
      overrides: Partial<{
        goal: LessonGoal;
        resultType: LessonResultType;
        level: LessonLevel;
        durationMinutes: number;
      }> = {},
    ): Record<string, string | number> => {
      const activeGoal = overrides.goal ?? goal;
      const activeResultType = overrides.resultType ?? resultType;
      const activeLevel = overrides.level ?? level;
      const activeDuration = overrides.durationMinutes ?? durationMinutes;
      return {
        topic: topic.trim(),
        ...(activeGoal && { goal: activeGoal }),
        ...(activeResultType && { result_type: activeResultType }),
        ...(activeLevel && { level: activeLevel }),
        ...(activeDuration && { duration_minutes: activeDuration }),
        ...adaptiveAnswers,
      };
    },
    [
      adaptiveAnswers,
      durationMinutes,
      goal,
      level,
      resultType,
      topic,
    ],
  );

  const loadAdaptiveQuestion = useCallback(
    async (nextGoal: LessonGoal, nextResultType: LessonResultType) => {
      const requestId = ++requestCounterRef.current;
      setScreen("adaptive");
      setPopoverState("loading");
      setNotice("");
      setError("");
      setAdaptiveQuestion(null);
      setSelectedChoiceId("");
      setOtherOpen(false);
      setOtherValue("");

      try {
        const data = await postPlanning({
          type: "planning_intake",
          ...(sessionId && { session_id: sessionId }),
          answers: baseAnswers({
            goal: nextGoal,
            resultType: nextResultType,
          }),
          asked_question_ids: askedQuestionIds,
          step: 3,
        });
        if (requestCounterRef.current !== requestId) return;
        setSessionId(data.session_id || "");
        if (data.notice) setNotice(data.notice);
        if (data.status === "question" && data.question) {
          setAdaptiveQuestion(data.question);
          setPopoverState(data.fallback ? "fallback" : "question");
          return;
        }
        setScreen("context");
        setPopoverState(data.fallback ? "fallback" : "question");
      } catch {
        if (requestCounterRef.current !== requestId) return;
        setAdaptiveQuestion(
          fallbackPlanningQuestion(nextGoal, nextResultType),
        );
        setNotice("Продолжим с базовыми настройками.");
        setPopoverState("fallback");
      }
    },
    [askedQuestionIds, baseAnswers, sessionId],
  );

  useEffect(
    () => () => {
      requestCounterRef.current += 1;
    },
    [],
  );

  const submitTopic = (event: React.FormEvent) => {
    event.preventDefault();
    const value = topic.trim();
    if (value.length < 3) {
      setError("Напиши тему хотя бы в трёх символах.");
      return;
    }
    setError("");
    emitEvent("Тема", value);
    setScreen("intent");
    setPopoverState("question");
  };

  const chooseGoal = (selectedGoal: LessonGoal) => {
    if (selectedChoiceId) return;
    setGoal(selectedGoal);
    setSelectedChoiceId(`goal:${selectedGoal}`);
    emitEvent(
      "Цель",
      GOAL_OPTIONS.find((option) => option.value === selectedGoal)?.label ??
        selectedGoal,
    );
    window.setTimeout(() => {
      void loadAdaptiveQuestion(
        selectedGoal,
        GOAL_TO_RESULT_TYPE[selectedGoal],
      );
    }, 140);
  };

  const commitAdaptiveAnswer = (value: string, selectedId: string) => {
    if (
      !adaptiveQuestion ||
      !value.trim() ||
      popoverState === "answering"
    ) {
      return;
    }
    const questionId = adaptiveQuestion.id;
    setSelectedChoiceId(selectedId);
    setPopoverState("answering");
    setAdaptiveAnswers((current) => ({
      ...current,
      [questionId]: value.trim(),
    }));
    setAskedQuestionIds((current) =>
      current.includes(questionId) ? current : [...current, questionId],
    );
    emitEvent("Фокус", value.trim());
    window.setTimeout(() => {
      setScreen("context");
      setPopoverState("question");
      setSelectedChoiceId("");
    }, 170);
  };

  const showSummary = async () => {
    if (!goal || !resultType || !level || !durationMinutes) return;
    const focus = Object.values(adaptiveAnswers).at(-1);
    const fallbackSummary = buildLocalPlanningSummary({
      topic: topic.trim(),
      goal,
      resultType,
      level,
      durationMinutes,
      focus,
    });
    emitEvent(
      "Формат",
      `${
        LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level
      }, ${durationMinutes} мин`,
    );
    setPopoverState("loading");
    setError("");

    try {
      const data = await postPlanning({
        type: "planning_intake",
        ...(sessionId && { session_id: sessionId }),
        answers: baseAnswers({ level, durationMinutes }),
        asked_question_ids: askedQuestionIds,
        step: 4,
      });
      setSessionId(data.session_id || sessionId);
      setSummary(data.summary ?? fallbackSummary);
      if (data.notice) setNotice(data.notice);
      setPopoverState(data.fallback ? "fallback" : "complete");
    } catch {
      setSummary(fallbackSummary);
      setNotice("Продолжим с базовыми настройками.");
      setPopoverState("fallback");
    }
    setScreen("summary");
  };

  const startLesson = async () => {
    if (!goal || !resultType || !level || !durationMinutes || !summary) return;
    setConfirming(true);
    const localPlan = buildLessonPlan({
      topic: topic.trim(),
      goal,
      resultType,
      level,
      durationMinutes,
      difficulties: summary.focus ? [summary.focus] : [],
      successCriteria: summary.success_criteria,
    });

    try {
      if (!sessionId) throw new Error("No planning session");
      const data = await postPlanning({
        type: "confirm_planning_intake",
        session_id: sessionId,
        answers: baseAnswers({ level, durationMinutes }),
      });
      onCreate(isLessonPlan(data.plan) ? data.plan : localPlan);
    } catch {
      onCreate(localPlan);
    } finally {
      setConfirming(false);
    }
  };

  const editAnswers = () => {
    requestCounterRef.current += 1;
    setScreen("topic");
    setPopoverState("idle");
    setAdaptiveQuestion(null);
    setAdaptiveAnswers({});
    setAskedQuestionIds([]);
    setSelectedChoiceId("");
    setOtherOpen(false);
    setOtherValue("");
    setSummary(null);
    setNotice("");
    setError("");
    setConfirming(false);
    onResetEvents?.();
  };

  const step =
    screen === "topic"
      ? 1
      : screen === "intent"
        ? 2
        : screen === "adaptive"
          ? 3
          : 4;

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center py-4">
      <PlanningQuestionPopover
        key={screen}
        className="w-full max-w-[640px] self-center"
        step={step}
        totalSteps={4}
        state={popoverState}
        notice={notice}
        eyebrow={screen === "summary" ? "План готов" : "Настройка урока"}
        question={
          screen === "topic"
            ? "Что разберём?"
            : screen === "intent"
              ? "Какой результат нужен?"
              : screen === "adaptive"
                ? adaptiveQuestion?.text ?? "Уточняю фокус…"
                : screen === "context"
                  ? "Уровень и время"
                  : "Проверь цель урока"
        }
        description={
          screen === "topic"
            ? "Одна тема или конкретная задача — без длинного описания."
            : screen === "intent"
              ? "Выбери, к какому результату идём — доска настроится под него."
              : screen === "context"
                ? "Можно выбрать ориентировочно — план останется гибким."
                : screen === "summary"
                  ? "После запуска откроется обычный чат, а этапы появятся над ним."
                  : undefined
        }
      >
        {screen === "topic" && (
          <form onSubmit={submitTopic}>
            <label className="block">
              <span className="sr-only">Тема урока</span>
              <input
                autoFocus
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="Например: второй закон Ньютона"
                maxLength={240}
                className="h-11 w-full rounded-[13px] border border-[#d8d2c9] bg-white/72 px-3.5 font-serif text-[14px] text-[#3c3630] outline-none transition-colors placeholder:text-[#aaa49b] focus:border-[#b98545]"
              />
            </label>
            {error && (
              <p className="mt-2 text-[10px] text-[#a44f45]" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={topic.trim().length < 3}
              className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[#302d2a] text-[11px] font-medium text-white outline-none transition-colors hover:bg-[#1f1d1b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 disabled:cursor-not-allowed disabled:bg-[#dfdbd4] disabled:text-[#a7a097]"
            >
              Продолжить
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </form>
        )}

        {screen === "intent" && (
          <div className="grid gap-1.5">
            {GOAL_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                option={option}
                selected={
                  selectedChoiceId === `goal:${option.value}` ||
                  goal === option.value
                }
                disabled={
                  Boolean(selectedChoiceId) &&
                  selectedChoiceId !== `goal:${option.value}`
                }
                onClick={() => chooseGoal(option.value)}
              />
            ))}
          </div>
        )}

        {screen === "adaptive" && adaptiveQuestion && (
          <div className="space-y-1.5">
            {adaptiveQuestion.options.slice(0, 3).map((option) => (
              <ChoiceCard
                key={option.id}
                option={option}
                selected={selectedChoiceId === option.id}
                disabled={
                  popoverState === "answering" &&
                  selectedChoiceId !== option.id
                }
                onClick={() => commitAdaptiveAnswer(option.label, option.id)}
              />
            ))}

            {!otherOpen ? (
              <button
                type="button"
                disabled={popoverState === "answering"}
                onClick={() => {
                  setOtherOpen(true);
                  setSelectedChoiceId("other");
                }}
                className="w-full rounded-[12px] border border-dashed border-[#d5cfc6] px-3 py-2 text-left text-[11px] text-[#837c73] outline-none transition-colors hover:border-[#bda47e] hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/25 disabled:opacity-35"
              >
                Другое — напишу сам
              </button>
            ) : (
              <form
                className="flex gap-1.5 pt-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitAdaptiveAnswer(otherValue, "other");
                }}
              >
                <input
                  autoFocus
                  value={otherValue}
                  onChange={(event) => setOtherValue(event.target.value)}
                  placeholder="Короткий ответ"
                  maxLength={120}
                  className="h-9 min-w-0 flex-1 rounded-[11px] border border-[#d8d2c9] bg-white/75 px-3 font-serif text-[12px] outline-none placeholder:text-[#aaa49b] focus:border-[#b98545]"
                />
                <button
                  type="submit"
                  disabled={!otherValue.trim()}
                  aria-label="Сохранить свой ответ"
                  className="grid h-9 w-9 place-items-center rounded-[11px] bg-[#302d2a] text-white disabled:bg-[#ded9d1] disabled:text-[#aaa49b]"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </form>
            )}
          </div>
        )}

        {screen === "context" && (
          <div className="space-y-3.5">
            <fieldset>
              <legend className="mb-1.5 text-[10px] font-medium text-[#756e66]">
                Текущий уровень
              </legend>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-1.5">
                {LEVEL_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    option={option}
                    selected={level === option.value}
                    compact
                    onClick={() => setLevel(option.value)}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-1.5 text-[10px] font-medium text-[#756e66]">
                Сколько времени есть?
              </legend>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-1.5">
                {DURATION_OPTIONS.map((duration) => (
                  <button
                    key={duration}
                    type="button"
                    onClick={() => setDurationMinutes(duration)}
                    aria-pressed={durationMinutes === duration}
                    className={`h-9 rounded-[11px] border text-[11px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/25 ${
                      durationMinutes === duration
                        ? "border-[#b9803b] bg-[#fff8ec] text-[#80521d]"
                        : "border-[#ddd8d0] bg-white/62 text-[#817a71] hover:bg-white"
                    }`}
                  >
                    {duration} мин
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              onClick={() => void showSummary()}
              disabled={!level || !durationMinutes}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[#302d2a] text-[11px] font-medium text-white outline-none transition-colors hover:bg-[#1f1d1b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 disabled:cursor-not-allowed disabled:bg-[#dfdbd4] disabled:text-[#a7a097]"
            >
              Показать итог
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {screen === "summary" && summary && (
          <div>
            <dl className="divide-y divide-[#e5e0d8] rounded-[13px] border border-[#ded8cf] bg-white/55 px-3">
              {[
                ["Тема", summary.topic],
                ["Цель", summary.goal],
                ["Фокус", summary.focus],
                [
                  "Формат",
                  `${summary.level} · ${summary.duration_minutes} мин`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[72px_1fr] gap-2 py-2 text-[10px]"
                >
                  <dt className="text-[#9a938a]">{label}</dt>
                  <dd className="font-medium text-[#504940]">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-3">
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#9b7548]">
                Урок завершён, когда
              </span>
              <ul className="mt-1.5 space-y-1">
                {summary.success_criteria.map((criterion) => (
                  <li
                    key={criterion}
                    className="flex items-start gap-2 text-[10px] leading-relaxed text-[#756e66]"
                  >
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#a56e2f]" />
                    {criterion}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 grid grid-cols-[0.8fr_1.2fr] gap-1.5">
              <button
                type="button"
                onClick={editAnswers}
                className="h-9 rounded-[12px] border border-[#d7d1c8] bg-white/60 text-[11px] text-[#6f675e] outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-[#c9a16c]/25"
              >
                Изменить
              </button>
              <button
                type="button"
                onClick={() => void startLesson()}
                disabled={confirming}
                className="flex h-9 items-center justify-center gap-1.5 rounded-[12px] bg-[#302d2a] text-[11px] font-medium text-white outline-none transition-colors hover:bg-[#1f1d1b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 disabled:bg-[#78726b]"
              >
                {confirming ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                    Запускаю…
                  </>
                ) : (
                  <>
                    Начать урок
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </PlanningQuestionPopover>
    </div>
  );
}

function visibleTaskIndexes(
  total: number,
  activeTaskIndex: number,
  maxVisible: number,
) {
  if (total <= maxVisible) return Array.from({ length: total }, (_, index) => index);

  const half = Math.floor(maxVisible / 2);
  const start = Math.min(
    Math.max(activeTaskIndex - half, 0),
    Math.max(0, total - maxVisible),
  );
  return Array.from({ length: maxVisible }, (_, index) => start + index);
}

export function LessonPlanProgress({
  plan,
  activeTaskIndex,
  onOpen,
  maxVisible = 3,
  floating = false,
  className = "",
}: {
  plan: LessonPlan;
  activeTaskIndex: number;
  onOpen: () => void;
  maxVisible?: number;
  floating?: boolean;
  className?: string;
}) {
  const indexes = useMemo(
    () =>
      visibleTaskIndexes(
        plan.tasks.length,
        Math.min(Math.max(activeTaskIndex, 0), plan.tasks.length - 1),
        maxVisible,
      ),
    [activeTaskIndex, maxVisible, plan.tasks.length],
  );
  const hasBefore = indexes[0] > 0;
  const hasAfter = indexes[indexes.length - 1] < plan.tasks.length - 1;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Открыть подробный план урока «${plan.topic}»`}
      className={`flex min-w-0 items-center gap-1 rounded-[14px] border border-[#ded9d1] bg-[#fbfaf7]/96 p-1 text-left outline-none backdrop-blur-xl transition-[border-color,box-shadow] hover:border-[#cdb184] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30 ${
        floating
          ? "w-[min(680px,calc(100vw-160px))] shadow-[0_10px_34px_rgba(61,49,36,0.12)]"
          : "w-full"
      } ${className}`}
    >
      {hasBefore && (
        <span className="grid h-7 w-6 shrink-0 place-items-center text-[12px] text-[#aaa49b]">
          …
        </span>
      )}

      {indexes.map((taskIndex) => {
        const task = plan.tasks[taskIndex];
        const isCurrent = taskIndex === activeTaskIndex;
        const isComplete = taskIndex < activeTaskIndex;

        return (
          <span
            key={task.id}
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[9px] px-2 text-[10px] ${
              isCurrent
                ? "bg-[#302d2a] font-medium text-[#fffdf9] shadow-[0_3px_10px_rgba(47,44,40,0.12)]"
                : isComplete
                  ? "text-[#8a5b24]"
                  : "text-[#aaa49b]"
            }`}
          >
            {isComplete ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <span className="shrink-0 tabular-nums">{taskIndex + 1}</span>
            )}
            <span className="truncate">{task.title}</span>
          </span>
        );
      })}

      {hasAfter && (
        <span className="grid h-7 w-6 shrink-0 place-items-center text-[12px] text-[#aaa49b]">
          …
        </span>
      )}
    </button>
  );
}

export function LessonPlanDetailsDialog({
  plan,
  activeTaskIndex,
  onSelectTask,
  onClose,
}: {
  plan: LessonPlan;
  activeTaskIndex: number;
  onSelectTask: (index: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[135] grid place-items-center bg-[#2f2c28]/18 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-plan-title"
        className="relative max-h-[min(720px,calc(100vh-32px))] w-full max-w-[560px] overflow-y-auto rounded-[22px] border border-[#d8d3ca] bg-[#fbfaf7] p-5 shadow-[0_24px_80px_rgba(47,44,40,0.22)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть подробный план"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[#928c83] outline-none transition-colors hover:bg-[#efede8] hover:text-[#302d2a] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
        >
          <X className="h-4 w-4" />
        </button>

        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9c7a50]">
          План урока
        </span>
        <h2
          id="lesson-plan-title"
          className="mt-1 pr-10 font-serif text-[22px] font-medium tracking-[-0.025em] text-[#302d2a]"
        >
          {plan.topic}
        </h2>

        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-[#756e65]">
          <span className="flex items-center gap-1.5 rounded-full border border-[#ddd8cf] bg-white/60 px-2.5 py-1.5">
            <Target className="h-3 w-3" />
            {plan.goalLabel}
          </span>
          <span className="rounded-full border border-[#ddd8cf] bg-white/60 px-2.5 py-1.5">
            {plan.levelLabel}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-[#ddd8cf] bg-white/60 px-2.5 py-1.5 tabular-nums">
            <Clock3 className="h-3 w-3" />
            {plan.durationMinutes} мин
          </span>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-[#817a71]">
          {plan.objective}
        </p>

        {plan.successCriteria && plan.successCriteria.length > 0 && (
          <div className="mt-4 rounded-[14px] border border-[#e0dbd3] bg-white/48 px-3 py-2.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#9c7a50]">
              Критерии успеха
            </span>
            <ul className="mt-1.5 space-y-1">
              {plan.successCriteria.map((criterion) => (
                <li
                  key={criterion}
                  className="flex items-start gap-2 text-[10px] leading-relaxed text-[#7e776e]"
                >
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#a56e2f]" />
                  {criterion}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 space-y-1.5">
          {plan.tasks.map((task, index) => {
            const isCurrent = index === activeTaskIndex;
            const isComplete = index < activeTaskIndex;

            return (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  onSelectTask(index);
                  onClose();
                }}
                className={`flex w-full items-start gap-3 rounded-[14px] border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/25 ${
                  isCurrent
                    ? "border-[#c89a5c] bg-[#fff8ed]"
                    : "border-[#dfdad2] bg-white/50 hover:bg-white"
                }`}
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                    isComplete
                      ? "bg-[#9d6b2e] text-white"
                      : isCurrent
                        ? "border border-[#b87c35] text-[#9d6b2e]"
                        : "text-[#b5aea5]"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Circle className="h-2.5 w-2.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-serif text-[13px] font-semibold text-[#484139]">
                      {index + 1}. {task.title}
                    </span>
                    <span className="shrink-0 text-[9px] tabular-nums text-[#a39c93]">
                      {task.durationMinutes} мин
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[#918a81]">
                    {task.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-[#aaa39a]">
          Активный этап меняется автоматически после законченного ответа. При
          необходимости можно выбрать этап вручную.
        </p>
      </section>
    </div>
  );
}
