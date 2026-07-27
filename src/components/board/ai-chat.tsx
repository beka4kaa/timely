"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  History,
  Lightbulb,
  Loader2,
  PanelRightClose,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LessonFlow, type BoardData } from "./AITutorBoard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StyleSelectorDropdown, PaletteSelectorDropdown } from "./style-controls/StyleSelectors";
import {
  useWhiteboardStore,
  type IllustrationLabel,
  type Position,
} from "@/stores/whiteboard";
import {
  buildLectureWhiteboardActions,
  type PendingIllustration,
} from "@/lib/whiteboard-lecture-layout";
import {
  LessonPlanningForm,
  LessonPlanProgress,
  type LessonPlan,
} from "./lesson-plan";
import { authFetch } from "@/lib/auth-fetch";
import {
  AIUsageIndicator,
  type AIUsageSummary,
} from "./usage-tracker";
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  updateChatSession,
  type ChatSessionDetail,
  type ChatSessionSummary,
} from "./chat-sessions-api";
import {
  DEFAULT_TUTOR_MODE,
  PRIMARY_TUTOR_MODES,
  tutorModeTitle,
  type HelpPolicySnapshot,
  type TutorModeSlug,
} from "./tutor-modes";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * Optional structured "lesson board" data returned by the AI for this
   * message (tables, formulas, charts, diagrams) — rendered inline via
   * <AITutorBoard/> using pixel-perfect macro widgets instead of the model
   * trying (and failing) to hand-draw grids out of primitive lines.
   */
  board?: BoardData | null;
  /**
   * Уточняющий вопрос от скилла `ask_clarification`: ассистент не угадывает
   * размытый запрос, а предлагает готовые варианты (первый — рекомендуемый).
   * Ответ одним кликом дешевле неверной иллюстрации: та стоит ~25 секунд.
   */
  clarify?: ClarifyPrompt | null;
  /** Вопрос уже отвечен — кнопки гасим, чтобы история не «кликалась» заново. */
  clarifyAnswered?: boolean;
  /** Короткая строка intake, а не обычный диалоговый bubble. */
  planningEvent?: boolean;
}

export interface ClarifyOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface ClarifyPrompt {
  question: string;
  options: ClarifyOption[];
}

export interface ChatContextSnapshot {
  lastUserMessage: string;
  contextPercent: number;
  usedTokens: number;
  limitTokens: number;
  userMessageCount: number;
}

export interface AIChatProps {
  className?: string;
  lessonPlan?: LessonPlan | null;
  activeLessonTaskIndex?: number;
  onLessonPlanChange?: (plan: LessonPlan | null) => void;
  onActiveLessonTaskChange?: (index: number) => void;
  onOpenLessonPlan?: () => void;
  onContextChange?: (snapshot: ChatContextSnapshot) => void;
  usageSummary?: AIUsageSummary | null;
  usageLoading?: boolean;
  onUsageChange?: () => void;
  onClose?: () => void;
}

const ESTIMATED_CONTEXT_TOKEN_LIMIT = 128_000;
const ACTIVE_SESSION_STORAGE_KEY = "timely:whiteboard-active-chat-session:v1";

/** Falls back to the first user message when there's no lesson topic yet
 * (e.g. autosave firing before the planning wizard finished). */
function deriveSessionTitle(
  plan: LessonPlan | null,
  messages: ChatMessage[],
): string {
  if (plan?.topic) return plan.topic;
  const firstUserMessage = messages.find((m) => m.role === "user")?.content.trim();
  if (!firstUserMessage) return "Новый чат";
  return firstUserMessage.length > 60
    ? `${firstUserMessage.slice(0, 60)}…`
    : firstUserMessage;
}

/** Stable serialization of everything autosave writes, used to tell an
 * actual change from a re-render that produced identical content. */
function serializeSessionPayload(input: {
  title: string;
  topic: string;
  messages: ChatMessage[];
  lesson_plan: LessonPlan | null;
  mode: string;
  hint_level: number;
  attempt_count: number;
}): string {
  return JSON.stringify(input);
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Сохраняет вручную расставленные подписи при доезде растра.
 *
 * Вторая фаза приходит отдельным запросом и заменяет `labels` целиком. Если
 * пользователь успел утащить подпись, пока на её месте был плейсхолдер, его
 * `manual_position` молча терялась. Переносим по совпадению текста, а не по
 * индексу: бэкенд может вернуть другое число подписей, и тогда позиция
 * приклеилась бы к чужой строке.
 */
function mergeManualLabelPositions(
  elementId: string,
  incoming: IllustrationLabel[],
): IllustrationLabel[] {
  const element = useWhiteboardStore
    .getState()
    .elements.find((candidate) => candidate.id === elementId);
  if (!element || element.type !== "ILLUSTRATION") return incoming;

  const manualByContent = new Map<string, Position>();
  for (const label of element.labels) {
    if (label.manual_position) manualByContent.set(label.content, label.manual_position);
  }
  if (manualByContent.size === 0) return incoming;

  return incoming.map((label) => {
    const manual = manualByContent.get(label.content);
    return manual ? { ...label, manual_position: manual } : label;
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AIChat({
  className,
  lessonPlan,
  activeLessonTaskIndex,
  onLessonPlanChange,
  onActiveLessonTaskChange,
  onOpenLessonPlan,
  onContextChange,
  usageSummary = null,
  usageLoading = false,
  onUsageChange,
  onClose,
}: AIChatProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Пустой список = экран приветствия по центру (как в Claude), а не пузырь
  // от ассистента. Приветствие исчезает с первым сообщением само собой.
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Приветствие зависит от времени суток; считается один раз на маунт,
  // чтобы фраза не менялась под курсором на границе часа.
  const [greeting] = useState(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Доброе утро! Что разберём?";
    if (h >= 12 && h < 18) return "Что разберём сегодня?";
    if (h >= 18 && h < 23) return "Добрый вечер! Что разберём?";
    return "Поздняя сессия? Давай разберём";
  });
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [generationStyle, setGenerationStyle] = useState("flat");
  const [internalLessonPlan, setInternalLessonPlan] =
    useState<LessonPlan | null>(null);
  const [internalActiveTaskIndex, setInternalActiveTaskIndex] = useState(0);
  // Saved-chat-history bookkeeping: null until the first message creates a
  // session, then every later change PATCHes the same row.
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const hasRestoredSessionRef = useRef(false);
  const sessionCreateInFlightRef = useRef(false);
  // Serialized copy of what the server already holds. Autosave compares
  // against it and skips a no-op request — otherwise loading a chat from
  // history would immediately PATCH it straight back, and messages carry
  // whole BoardData payloads.
  const lastSavedPayloadRef = useRef<string | null>(null);
  // Mirrors `messages` for the restore race: the mount-restore request must
  // not overwrite a conversation the user started while it was in flight.
  const messagesRef = useRef<ChatMessage[]>([]);
  // Bumped whenever the active chat is replaced or cleared; a load whose
  // epoch is stale by the time it resolves drops its result on the floor.
  const sessionEpochRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ChatSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [planningResetKey, setPlanningResetKey] = useState(0);
  // Set when the user bypasses the lesson-plan intake via "Пропустить" — the
  // chat opens immediately with no plan, and no plan is ever sent as context.
  const [planningSkipped, setPlanningSkipped] = useState(false);
  // Дефолтная палитра — natural-earth: естественные/географические тона.
  // Раньше дефолт был he_inspired (медицинский H&E), из-за чего гео-схемы
  // генерились в красно-«мясных» оттенках.
  const [generationPalette, setGenerationPalette] = useState("natural-earth");

  // ── Режим тьютора (PRODUCT.md §5.2) ────────────────────────────────────────
  // Клиент хранит ВЫБОР режима и достигнутую ступень подсказок, но не правила:
  // `policy` целиком приходит из ответа сервера, и только по ней решается,
  // показывать ли кнопку подсказки. Пока ни одного ответа не было, политика
  // null — кнопка скрыта, что честнее, чем угадать права заранее.
  const [tutorMode, setTutorMode] = useState<TutorModeSlug>(DEFAULT_TUTOR_MODE);
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [helpPolicy, setHelpPolicy] = useState<HelpPolicySnapshot | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  // Самостоятельные попытки: считаем обычные сообщения ученика, потому что
  // именно они и есть попытка. Сервер сверяет счётчик с `required_attempts`.
  const [attemptCount, setAttemptCount] = useState(0);

  const executeActions = useWhiteboardStore((s) => s.executeActions);
  const camera = useWhiteboardStore((s) => s.camera);
  const selectedElementId = useWhiteboardStore((s) => s.selectedElementId);
  const elements = useWhiteboardStore((s) => s.elements);
  const currentLessonPlan =
    lessonPlan === undefined ? internalLessonPlan : lessonPlan;
  const currentTaskIndex =
    activeLessonTaskIndex === undefined
      ? internalActiveTaskIndex
      : activeLessonTaskIndex;
  const currentLessonTask = currentLessonPlan?.tasks[currentTaskIndex] ?? null;
  const hasChatAccess = Boolean(currentLessonPlan) || planningSkipped;

  const updateLessonPlan = useCallback(
    (plan: LessonPlan | null) => {
      if (onLessonPlanChange) onLessonPlanChange(plan);
      else setInternalLessonPlan(plan);
    },
    [onLessonPlanChange],
  );

  const updateActiveTask = useCallback(
    (index: number) => {
      if (onActiveLessonTaskChange) onActiveLessonTaskChange(index);
      else setInternalActiveTaskIndex(index);
    },
    [onActiveLessonTaskChange],
  );

  // Keeps messagesRef in step with the rendered conversation.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** Loads a saved chat into view — used both by mount-restore and by the
   * history picker. Replaces whatever's currently on screen, unless
   * `skipIfDirty` is set and the user has meanwhile started typing into a
   * conversation of their own. Returns null when the load was skipped. */
  const loadChatSession = useCallback(
    async (
      id: string,
      { skipIfDirty = false }: { skipIfDirty?: boolean } = {},
    ): Promise<ChatSessionDetail | null> => {
      const epoch = ++sessionEpochRef.current;
      const session = await getChatSession(id);
      // Both checks happen AFTER the await: the whole point is the request
      // being slow. A newer load (or clearChat) wins over this one, and a
      // restore never overwrites messages the user typed meanwhile.
      if (epoch !== sessionEpochRef.current) return null;
      if (skipIfDirty && messagesRef.current.length > 0) return null;
      setMessages(session.messages);
      updateLessonPlan(session.lesson_plan);
      updateActiveTask(0);
      setCurrentSessionId(session.id);
      // Возобновляем режим и лестницу помощи. Сессии, сохранённые до появления
      // режимов, приходят с пустым `mode` — берём режим по умолчанию, то есть
      // ровно то поведение, которым эта сессия и велась.
      const restoredMode = (PRIMARY_TUTOR_MODES.find(
        (option) => option.slug === session.mode,
      )?.slug ?? DEFAULT_TUTOR_MODE) as TutorModeSlug;
      setTutorMode(restoredMode);
      setHintLevel(session.hint_level ?? 0);
      setAttemptCount(session.attempt_count ?? 0);
      setHelpPolicy(session.policy ?? null);
      // The server already holds exactly this, so autosave must not PATCH it
      // straight back — see lastSavedPayloadRef.
      lastSavedPayloadRef.current = serializeSessionPayload({
        title: session.title,
        topic: session.topic,
        messages: session.messages,
        lesson_plan: session.lesson_plan,
        mode: restoredMode,
        hint_level: session.hint_level ?? 0,
        attempt_count: session.attempt_count ?? 0,
      });
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, session.id);
      return session;
    },
    [updateLessonPlan, updateActiveTask],
  );

  // Resume the last active chat on mount, so a refresh/relogin doesn't lose
  // the conversation. Runs once; a stale/deleted id is dropped silently.
  useEffect(() => {
    if (hasRestoredSessionRef.current) return;
    hasRestoredSessionRef.current = true;
    const savedId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (!savedId) return;
    loadChatSession(savedId, { skipIfDirty: true }).catch(() => {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    });
  }, [loadChatSession]);

  // Best-effort autosave: debounced so a burst of streaming updates doesn't
  // fire a request per keystroke-equivalent. Creates the session on the
  // first message, then PATCHes the same row as the conversation grows.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const payload = {
        title: deriveSessionTitle(currentLessonPlan, messages),
        topic: currentLessonPlan?.topic ?? "",
        messages,
        lesson_plan: currentLessonPlan,
        // Режим и состояние лестницы — часть сессии: без них возобновлённый
        // разговор терял бы правила и начинал подсказки с первой ступени.
        mode: tutorMode,
        hint_level: hintLevel,
        attempt_count: attemptCount,
      };
      // Nothing actually changed since the last successful save — skip the
      // round trip. Messages carry whole BoardData objects, so a redundant
      // save is not cheap.
      const serialized = serializeSessionPayload(payload);
      if (serialized === lastSavedPayloadRef.current) return;

      if (!currentSessionId) {
        if (sessionCreateInFlightRef.current) return;
        sessionCreateInFlightRef.current = true;
        createChatSession({ id: crypto.randomUUID(), ...payload })
          .then((created) => {
            lastSavedPayloadRef.current = serialized;
            setCurrentSessionId(created.id);
            window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, created.id);
          })
          .catch(() => {
            // Best-effort: the ref stays put, so the next edit retries.
          })
          .finally(() => {
            sessionCreateInFlightRef.current = false;
          });
      } else {
        updateChatSession(currentSessionId, payload)
          .then(() => {
            lastSavedPayloadRef.current = serialized;
          })
          .catch(() => {
            // Best-effort: the ref stays put, so the next edit retries.
          });
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    messages,
    currentLessonPlan,
    currentSessionId,
    tutorMode,
    hintLevel,
    attemptCount,
  ]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      setHistoryItems(await listChatSessions());
    } catch {
      setHistoryError("Не удалось загрузить историю чатов");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleHistoryOpenChange = (open: boolean) => {
    setHistoryOpen(open);
    setConfirmDeleteId(null);
    if (open) void refreshHistory();
  };

  const handleSelectHistorySession = async (id: string) => {
    if (id === currentSessionId) {
      setHistoryOpen(false);
      return;
    }
    try {
      await loadChatSession(id);
      setHistoryOpen(false);
    } catch {
      setHistoryError("Не удалось открыть этот чат");
    }
  };

  const handleDeleteHistorySession = async (id: string) => {
    try {
      await deleteChatSession(id);
      setHistoryItems((current) => current.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
      if (id === currentSessionId) clearChat();
    } catch {
      setHistoryError("Не удалось удалить чат");
    }
  };

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const contextSnapshot = useMemo<ChatContextSnapshot>(() => {
    const userMessages = messages.filter((message) => message.role === "user");
    const characterCount = messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    const estimatedTokens = Math.ceil(characterCount / 3.5);
    const estimatedPercent = Math.round(
      (estimatedTokens / ESTIMATED_CONTEXT_TOKEN_LIMIT) * 100,
    );

    return {
      lastUserMessage: userMessages.at(-1)?.content ?? "",
      contextPercent: Math.min(
        100,
        Math.max(userMessages.length > 0 ? 1 : 0, estimatedPercent),
      ),
      usedTokens: estimatedTokens,
      limitTokens: ESTIMATED_CONTEXT_TOKEN_LIMIT,
      userMessageCount: userMessages.length,
    };
  }, [messages]);

  useEffect(() => {
    onContextChange?.(contextSnapshot);
  }, [contextSnapshot, onContextChange]);

  /**
   * Догружает растры для иллюстраций, поставленных плейсхолдерами.
   *
   * Каждая картинка — отдельный запрос: они приходят по одной и сразу
   * подставляются на холст, вместо того чтобы держать пустой экран все ~25
   * секунд на каждую. Ошибка одной иллюстрации не мешает остальным — на её
   * месте останется плейсхолдер с текстом ошибки.
   */
  const loadPendingIllustrations = useCallback(
    async (pending: PendingIllustration[], topicHint?: string) => {
      const state = useWhiteboardStore.getState();

      await Promise.all(
        pending.map(async ({ elementId, command }) => {
          try {
            const res = await authFetch("/api/ai/illustration", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command,
                topic_hint: topicHint ?? "",
                style: generationStyle,
                palette: generationPalette,
              }),
            });
            const raw = await res.text();
            const data = raw ? JSON.parse(raw) : {};
            if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);

            const enriched = data.command ?? {};
            const src: string | undefined = enriched.base_image_url || enriched.image_url;
            if (!src) {
              throw new Error(
                typeof enriched.image_error === "string"
                  ? enriched.image_error
                  : "Не удалось сгенерировать иллюстрацию"
              );
            }

            state.executeActions([
              {
                type: "UPDATE_ELEMENT",
                payload: {
                  id: elementId,
                  src,
                  labels: mergeManualLabelPositions(
                    elementId,
                    Array.isArray(enriched.labels) ? enriched.labels : []
                  ),
                  masks: Array.isArray(enriched.masks) ? enriched.masks : null,
                  pending: false,
                },
              },
            ]);
            onUsageChange?.();
          } catch (e: any) {
            state.executeActions([
              {
                type: "UPDATE_ELEMENT",
                payload: {
                  id: elementId,
                  pending: false,
                  error: e?.message || "Иллюстрация не сгенерировалась",
                },
              },
            ]);
          }
        })
      );
    },
    [generationStyle, generationPalette, onUsageChange]
  );

  // `overrideText` — ответ, выбранный кликом по варианту уточняющего вопроса:
  // он не проходит через поле ввода, но в остальном это обычное сообщение.
  const sendMessage = async (
    overrideText?: string,
    { requestHint = false }: { requestHint?: boolean } = {},
  ) => {
    const text = (overrideText ?? inputValue).trim();
    if (!text || isLoading || !hasChatAccess) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);

    // Попытка — это обычное сообщение ученика. Просьба о подсказке попыткой не
    // является, иначе «подскажи» дважды открывало бы готовое решение в режиме,
    // который требует двух самостоятельных попыток.
    const attemptsForRequest = requestHint ? attemptCount : attemptCount + 1;
    if (!requestHint) setAttemptCount(attemptsForRequest);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      // Build history for context (exclude welcome message)
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      // Референс для смены стиля: выделенная иллюстрация, иначе — ПОСЛЕДНЯЯ
      // на доске. Шлём ВСЕГДА (вместе с её подписями) как кандидата;
      // использовать его или нет, решает бэкенд классификацией intent от Llama:
      //   restyle («do sketch», «теперь в 3d») → i2i с сохранением композиции
      //     + ТЕ ЖЕ подписи с теми же координатами (текст не переезжает);
      //   new (новая тема) → референс игнорируется, чистая генерация.
      const selectedEl = elements.find((e) => e.id === selectedElementId);
      const refEl =
        selectedEl && (selectedEl.type === "ILLUSTRATION" || selectedEl.type === "IMAGE")
          ? selectedEl
          : [...elements].reverse().find((e) => e.type === "ILLUSTRATION");
      const referenceImageUrl = refEl ? (refEl as { src: string }).src : undefined;
      const referenceLabels =
        refEl && refEl.type === "ILLUSTRATION" && Array.isArray(refEl.labels) && refEl.labels.length > 0
          ? refEl.labels
          : undefined;

      // Роутер скиллов на бэкенде (ai_engine.skills): сам решает, нужен ли
      // обычный ответ или отрисовка. Раньше здесь был прямой /api/ai/draw, и
      // каждое сообщение тащило board-DSL промпт — простой вопрос отвечался
      // ~137 секунд и рисовал непрошеную доску.
      const res = await authFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          // Режим — пожелание клиента; сервер его валидирует и сам решает права.
          mode: tutorMode,
          hint_level: hintLevel,
          attempts: attemptsForRequest,
          ...(requestHint && { request_hint: true }),
          style: generationStyle,
          palette: generationPalette,
          // Картинки не ждём: доска с текстом и подписями приходит за ~18с,
          // а растры догружаются отдельными запросами (loadPendingIllustrations).
          defer_images: true,
          lesson_plan: currentLessonPlan,
          active_lesson_task:
            currentLessonPlan?.tasks[currentTaskIndex] ?? null,
          ...(referenceImageUrl && { reference_image_url: referenceImageUrl }),
          ...(referenceLabels && { reference_labels: referenceLabels }),
        }),
      });

      // The body may be non-JSON (e.g. a proxy 500 / "Internal Server Error"
      // when the model is slow), so parse defensively.
      const rawBody = await res.text();
      let data: any = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        throw new Error(
          data.error ||
            (res.status === 504
              ? "Модель долго отвечает. Попробуйте упростить запрос или повторить."
              : `Сервер вернул ${res.status}. Возможно, модель перегружена — попробуйте ещё раз.`)
        );
      }

      // Права всегда берём из ответа: политика могла ужесточиться (сменился
      // режим, кончилась лестница), и держать свою копию правил на клиенте
      // значило бы рисовать кнопку подсказки, которой сервер уже откажет.
      if (data.policy) setHelpPolicy(data.policy as HelpPolicySnapshot);
      if (typeof data.hint_level === "number") setHintLevel(data.hint_level);

      // Отказ по политике — нормальная реплика тьютора, а не ошибка: доски и
      // разбора в нём нет, поэтому дальше по обработке идти незачем.
      if (data.policy_blocked) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: data.reply || "Сейчас эта помощь недоступна.",
          },
        ]);
        return;
      }

      // The AI may return structured "lesson board" data (board_steps with
      // table/formula/barchart/text/line commands) — rendered inline as a
      // pixel-perfect AITutorBoard widget instead of drawn by the model.
      let board: BoardData | null =
        data.board && Array.isArray(data.board.board_steps) && data.board.board_steps.length > 0
          ? (data.board as BoardData)
          : null;

      // Extract visual commands and place them directly on the whiteboard
      if (board) {
        const state = useWhiteboardStore.getState();
        const zoom = Math.max(0.25, state.camera.zoom || 1);
        const baseX = (120 + state.camera.x) / zoom;
        const baseY = (115 + state.camera.y) / zoom;
        const maxColumnHeight =
          typeof window !== "undefined" ? (window.innerHeight - 190) / zoom : 640;

        const { actions: actionsToExecute, pendingIllustrations } =
          buildLectureWhiteboardActions({
            boardSteps: board.board_steps,
            baseX,
            baseY,
            maxColumnHeight,
            generationStyle,
          });

        if (actionsToExecute.length > 0) {
          state.executeActions(actionsToExecute);
        }

        // Прогрессивная выдача: места под иллюстрации уже заняты
        // плейсхолдерами, теперь догружаем растры по одному. Намеренно НЕ
        // ждём их здесь — сообщение с текстом должно появиться сразу.
        if (pendingIllustrations.length > 0) {
          void loadPendingIllustrations(pendingIllustrations, board.topic);
        }

        // Filter out ALL visual commands from board_steps so they don't show in the chat at all!
        // We only leave semantic data like tables or barcharts (if any).
        const typesToMove = [
          "image_with_labels",
          "circle",
          "rect",
          "line",
          "text",
          "formula",
          "table",
          "barchart",
        ];
        board.board_steps = board.board_steps.map((step) => ({
          ...step,
          commands: step.commands.filter((cmd: any) => !typesToMove.includes(cmd.type))
        })).filter((step) => step.commands.length > 0);
        
        // If board_steps is empty after filtering, set board to null
        if (board.board_steps.length === 0) {
          board = null;
        }
      }

      // Уточняющий вопрос от скилла ask_clarification — приходит вместо доски.
      const clarify: ClarifyPrompt | null =
        data.clarify && Array.isArray(data.clarify.options) && data.clarify.options.length > 0
          ? (data.clarify as ClarifyPrompt)
          : null;

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || (board ? "Вот разбор:" : "Готово."),
        board,
        clarify,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      onUsageChange?.();

      if (
        !clarify &&
        currentLessonPlan &&
        currentTaskIndex < currentLessonPlan.tasks.length - 1
      ) {
        updateActiveTask(currentTaskIndex + 1);
      }
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ ${e.message || "Произошла ошибка. Попробуйте ещё раз."}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInputValue("");
    setPlanningResetKey((value) => value + 1);
    setPlanningSkipped(false);
    updateLessonPlan(null);
    updateActiveTask(0);
    // The old conversation stays saved in history; this just stops treating
    // it as the active one so the next message starts a fresh session.
    setCurrentSessionId(null);
    lastSavedPayloadRef.current = null;
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    // Новый разговор — новая лестница и новый счёт попыток. Режим оставляем:
    // ученик только что его выбрал, и сбрасывать этот выбор на «Новый чат»
    // означало бы молча менять правила занятия.
    setHintLevel(0);
    setAttemptCount(0);
    setHelpPolicy(null);
    // Invalidates any load still in flight, so a slow restore can't
    // resurrect the chat the user just cleared.
    sessionEpochRef.current += 1;
  };

  const handleCreateLessonPlan = (plan: LessonPlan) => {
    setMessages((current) => [
      ...current,
      {
        id: `planning-ready-${Date.now()}`,
        role: "assistant",
        content: "План принят · можно начинать",
        planningEvent: true,
      },
    ]);
    setInputValue("");
    updateLessonPlan(plan);
    updateActiveTask(0);
  };

  const handlePlanningEvent = (content: string) => {
    setMessages((current) => [
      ...current,
      {
        id: `planning-${Date.now()}-${current.length}`,
        role: "assistant",
        content,
        planningEvent: true,
      },
    ]);
  };

  const resetPlanningEvents = () => {
    setMessages((current) =>
      current.filter((message) => !message.planningEvent),
    );
  };

  const handleSkipPlanning = () => {
    resetPlanningEvents();
    setPlanningSkipped(true);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const preparePrompt = (prompt: string) => {
    setInputValue(prompt);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-[#f8f6f2] text-[#37322c] ${className ?? ""}`}
    >
      {/* ── Compact header: режим тьютора + история. ── */}
      <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-[#dedbd4] bg-[#fbfaf7] px-3.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="shrink-0 font-serif text-[14px] font-semibold tracking-[-0.015em] text-[#37322c]">
            AI тьютор
          </h2>
          {/* Переключатель режима (§5.2). Правила режима применяет сервер —
              здесь только выбор, поэтому кнопка ничего не «включает» локально. */}
          <Popover open={modePickerOpen} onOpenChange={setModePickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Режим занятия"
                className="flex min-w-0 items-center gap-1 rounded-full border border-[#e0dcd4] bg-[#f4f1ea] px-2 py-[3px] text-[10px] font-medium text-[#6d665d] outline-none transition-colors hover:border-[#d3cdc2] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
              >
                <span className="truncate">{tutorModeTitle(tutorMode)}</span>
                <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 border-[#dcd7cf] bg-[#fbfaf7] p-0 text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
            >
              <div className="border-b border-[#e4e0d8] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
                Режим занятия
              </div>
              <div className="py-1">
                {PRIMARY_TUTOR_MODES.map((option) => (
                  <button
                    key={option.slug}
                    type="button"
                    onClick={() => {
                      // Смена режима начинает лестницу помощи заново: ступени,
                      // полученные по прежним правилам, к новым не относятся.
                      if (option.slug !== tutorMode) {
                        setTutorMode(option.slug);
                        setHintLevel(0);
                        setHelpPolicy(null);
                      }
                      setModePickerOpen(false);
                    }}
                    className={`block w-full px-3 py-2 text-left transition-colors hover:bg-[#f1ede6] ${
                      option.slug === tutorMode ? "bg-[#f4f0e9]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium text-[#37322c]">
                        {option.title}
                      </span>
                      {option.slug === tutorMode && (
                        <Check className="h-3 w-3 text-[#8a7a5e]" />
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] leading-snug text-[#8f887f]">
                      {option.goal}
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-0.5 text-[#918b82]">
          {messages.length > 0 && (
            <span className="mr-1 text-[10px] tabular-nums text-[#aaa49b]">
              {messages.filter((message) => message.role === "user").length}
            </span>
          )}
          <Popover open={historyOpen} onOpenChange={handleHistoryOpenChange}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="История чатов"
                title="История чатов"
                className="grid h-7 w-7 place-items-center rounded-full outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
              >
                <History className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-72 border-[#dcd7cf] bg-[#fbfaf7] p-0 text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
            >
              <div className="border-b border-[#e4e0d8] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
                История чатов
              </div>
              <div className="max-h-80 overflow-y-auto">
                {historyLoading && (
                  <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-[#8f887f]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Загружаем…
                  </div>
                )}
                {!historyLoading && historyError && (
                  <div className="px-3 py-4 text-[12px] text-[#b0473e]">
                    {historyError}
                  </div>
                )}
                {!historyLoading && !historyError && historyItems.length === 0 && (
                  <div className="px-3 py-4 text-[12px] text-[#8f887f]">
                    Пока нет сохранённых чатов
                  </div>
                )}
                {!historyLoading &&
                  !historyError &&
                  historyItems.map((item) => (
                    <div
                      key={item.id}
                      className={`group flex items-start gap-1.5 border-b border-[#efece5] px-3 py-2.5 last:border-b-0 ${
                        item.id === currentSessionId ? "bg-[#f4f0e9]" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSelectHistorySession(item.id)}
                        className="min-w-0 flex-1 text-left outline-none"
                      >
                        <div className="truncate text-[12px] font-medium text-[#4a433b]">
                          {item.title || "Новый чат"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#a39c93]">
                          <span>{formatSessionDate(item.updated_at)}</span>
                          {/* Бейдж режима: по нему видно, чем была сессия —
                              объяснением темы или контестом. Сессии, сохранённые
                              до появления режимов, приходят с пустым `mode`, и
                              бейджа у них просто нет. */}
                          {tutorModeTitle(item.mode) && (
                            <span className="rounded-full bg-[#efece5] px-1.5 py-[1px] text-[9px] text-[#8b8479]">
                              {tutorModeTitle(item.mode)}
                            </span>
                          )}
                        </div>
                      </button>
                      {confirmDeleteId === item.id ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => void handleDeleteHistorySession(item.id)}
                            aria-label="Подтвердить удаление"
                            title="Подтвердить удаление"
                            className="grid h-6 w-6 place-items-center rounded-full text-[#b0473e] outline-none transition-colors hover:bg-[#f6e4e1]"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            aria-label="Отменить удаление"
                            title="Отменить удаление"
                            className="grid h-6 w-6 place-items-center rounded-full text-[#8f887f] outline-none transition-colors hover:bg-[#efece5]"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          aria-label="Удалить чат"
                          title="Удалить чат"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#c2bcb2] opacity-0 outline-none transition-colors hover:bg-[#efece5] hover:text-[#8f887f] focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={clearChat}
            aria-label="Новый чат"
            title="Новый чат"
            className="grid h-7 w-7 place-items-center rounded-full outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Скрыть AI Tutor"
              title="Скрыть AI Tutor"
              className="grid h-7 w-7 place-items-center rounded-full outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {currentLessonPlan && (
        <div className="shrink-0 border-b border-[#e4e0d8] bg-[#fbfaf7]/72 px-3 py-2">
          <LessonPlanProgress
            plan={currentLessonPlan}
            activeTaskIndex={currentTaskIndex}
            onOpen={onOpenLessonPlan ?? (() => undefined)}
            maxVisible={3}
          />
        </div>
      )}

      {/* ── Messages ── */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {!hasChatAccess ? (
          <div className="flex h-full min-h-0 flex-col gap-2">
            {messages
              .filter((message) => message.planningEvent)
              .map((message) => (
                <div
                  key={message.id}
                  className="flex items-center gap-2 px-1 text-[10px] text-[#8e877e]"
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-[#b98343]" />
                  <span className="truncate">{message.content}</span>
                </div>
              ))}
            <LessonPlanningForm
              key={planningResetKey}
              onCreate={handleCreateLessonPlan}
              onPlanningEvent={handlePlanningEvent}
              onResetEvents={resetPlanningEvents}
              onSkip={handleSkipPlanning}
            />
          </div>
        ) : (
          <>
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col gap-3 py-1">
                <div>
                  <h3 className="font-serif text-[18px] font-medium tracking-[-0.025em] text-[#38332d]">
                    {currentLessonTask
                      ? `Начнём: ${currentLessonTask.title}`
                      : greeting}
                  </h3>
                  <p className="mt-1 max-w-[310px] text-[11px] leading-relaxed text-[#908a81]">
                    {currentLessonTask?.description ??
                      (currentLessonPlan
                        ? "План готов. Задай первый вопрос, и мы пройдём его по шагам."
                        : "Спрашивай что угодно — план не обязателен.")}
                  </p>
                </div>

                {currentLessonPlan && (
                  <div className="space-y-1.5">
                    {[
                      [
                        "Начать этап",
                        currentLessonTask?.description ??
                          `Начнём урок по теме «${currentLessonPlan.topic}»`,
                      ],
                      [
                        "Показать на доске",
                        `Покажи на доске текущий этап «${currentLessonTask?.title ?? currentLessonPlan.topic}»`,
                      ],
                      [
                        "Проверить знания",
                        `Задай короткий проверочный вопрос по теме «${currentLessonPlan.topic}»`,
                      ],
                    ].map(([title, description]) => (
                      <button
                        key={title}
                        type="button"
                        onClick={() => preparePrompt(description)}
                        className="block w-full rounded-[12px] border border-[#ddd9d1] bg-white/55 px-3 py-2.5 text-left outline-none transition-colors hover:border-[#c8a877] hover:bg-[#fffaf1] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/25"
                      >
                        <span className="block font-serif text-[13px] font-semibold text-[#49423a]">
                          {title}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-[#9b958c]">
                          {description}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {messages.map((msg) =>
              msg.planningEvent ? (
                <div
                  key={msg.id}
                  className="flex items-center gap-2 px-1 text-[10px] text-[#8e877e]"
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-[#b98343]" />
                  <span className="truncate">{msg.content}</span>
                </div>
              ) : (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex max-w-[94%] flex-col gap-3 whitespace-pre-wrap px-3.5 py-2.5 text-[13px] leading-[1.55] ${
                      msg.role === "assistant"
                        ? "rounded-[16px] border border-[#dedad3] bg-white/62 text-[#514b43]"
                        : "rounded-[16px] rounded-tr-[5px] bg-[#302d2a] text-[#fffdf9]"
                    }`}
                  >
                    {msg.content}

                    {msg.board && (
                      <LessonFlow
                        data={msg.board}
                        showHeader={!!(msg.board.subject || msg.board.topic)}
                      />
                    )}

                    {msg.clarify && (
                      <div className="flex flex-col gap-1.5 not-prose">
                        {msg.clarify.options.map((opt, i) => (
                        <button
                          key={i}
                          type="button"
                          disabled={msg.clarifyAnswered || isLoading}
                          onClick={() => {
                            setMessages((prev) =>
                              prev.map((message) =>
                                message.id === msg.id
                                  ? { ...message, clarifyAnswered: true }
                                  : message,
                              ),
                            );
                            sendMessage(opt.label);
                          }}
                          className={`rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-50 ${
                            opt.recommended
                              ? "border-[#c8944d] bg-[#fff7e9] hover:bg-[#fff1d9]"
                              : "border-[#d8d3cb] bg-white/55 hover:bg-white"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="font-medium">{opt.label}</span>
                            {opt.recommended && (
                              <span className="text-[10px] text-[#a56820]">
                                рекомендуется
                              </span>
                            )}
                          </span>
                          {opt.description && (
                            <span className="mt-0.5 block text-[11px] opacity-70">
                              {opt.description}
                            </span>
                          )}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={msg.clarifyAnswered || isLoading}
                          onClick={() => textareaRef.current?.focus()}
                          className="rounded-xl border border-dashed border-[#d2cdc5] px-3 py-2 text-left text-[12px] opacity-70 transition-opacity hover:opacity-100 disabled:cursor-default disabled:opacity-40"
                        >
                          Другое — напишу сам
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}

            {isLoading && (
              // Honest, single generic status only — the backend picks the
              // actual skill (plain reply / board / clarifying question)
              // inside one opaque POST, so nothing about "understood the
              // topic" or "building a diagram" is knowable yet, and showing
              // it anyway would just be a fabricated claim.
              <div className="flex items-center gap-2 rounded-[16px] border border-[#dedad3] bg-white/62 px-3.5 py-2.5 text-[13px] text-[#7c746a]">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#b7792d]" />
                Думаю над ответом…
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
          </div>

          {hasChatAccess && (
          <div className="shrink-0 px-3 pb-1">
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {/* Лестница помощи (§5.5). Кнопка появляется, только если сервер
                  прислал политику, где подсказки разрешены: гадать о правах на
                  клиенте нельзя, а показывать кнопку, которой откажут, — обман.
                  Ступень выдаёт backend, здесь лишь отображается прогресс. */}
              {helpPolicy?.hints_allowed && (
                <button
                  type="button"
                  onClick={() => sendMessage("Подскажи", { requestHint: true })}
                  disabled={isLoading || hintLevel >= helpPolicy.max_hint_level}
                  title={
                    hintLevel >= helpPolicy.max_hint_level
                      ? "Подсказки на этом этапе закончились"
                      : "Следующая подсказка"
                  }
                  className="flex shrink-0 items-center gap-1 rounded-full border border-[#d9d4cc] bg-[#fbfaf7] px-3 py-1.5 font-serif text-[12px] text-[#7e776e] transition-colors hover:border-[#c5a474] hover:text-[#6f481c] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-[#d9d4cc] disabled:hover:text-[#7e776e]"
                >
                  <Lightbulb className="h-3 w-3 shrink-0" />
                  Подсказка
                  <span className="tabular-nums opacity-60">
                    {hintLevel}/{helpPolicy.max_hint_level}
                  </span>
                </button>
              )}
              {[
                "Объясни проще",
                "Дай задачу",
                "Построй график",
                "Добавь пример",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => preparePrompt(prompt)}
                  className="shrink-0 rounded-full border border-[#d9d4cc] bg-[#fbfaf7] px-3 py-1.5 font-serif text-[12px] text-[#7e776e] transition-colors hover:border-[#c5a474] hover:text-[#6f481c]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* ── Input area ── */}
          {hasChatAccess && (
          <div
            className="shrink-0 px-3 pt-2"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            <div className="flex flex-col rounded-[17px] border border-[#d8d3cb] bg-[#fbfaf7] px-3 pb-2 pt-3 shadow-[0_8px_24px_rgba(67,57,45,0.06)] transition-[border-color,box-shadow] focus-within:border-[#c79a5b] focus-within:shadow-[0_10px_30px_rgba(138,91,36,0.10)]">
              <textarea
                ref={textareaRef}
                placeholder="Спроси или попроси нарисовать…"
                rows={1}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                className="mb-2 min-h-[30px] max-h-[160px] w-full resize-none bg-transparent px-1 font-serif text-[14px] leading-relaxed text-[#3b352f] outline-none placeholder:text-[#aaa49b]"
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <PaletteSelectorDropdown
                    value={generationPalette}
                    onChange={setGenerationPalette}
                  />
                </div>

                <div className="flex items-center gap-1">
                  <AIUsageIndicator
                    summary={usageSummary}
                    isLoading={usageLoading}
                    context={{
                      usedTokens: contextSnapshot.usedTokens,
                      limitTokens: contextSnapshot.limitTokens,
                      percent: contextSnapshot.contextPercent,
                    }}
                  />

                  <StyleSelectorDropdown
                    value={generationStyle}
                    onChange={setGenerationStyle}
                  />

                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => sendMessage()}
                          disabled={isLoading || !inputValue.trim()}
                          className="ml-1 h-8 w-8 rounded-full bg-[#c9a16c] text-white transition-colors hover:bg-[#af7d3d] disabled:bg-[#e5dfd6] disabled:text-[#aaa49b]"
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowUp className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        Отправить (Enter)
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </div>
          </div>
          )}
    </div>
  );
}
