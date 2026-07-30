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
  ImageModelSelectorDropdown,
  QualitySelectorDropdown,
} from "./style-controls/ModelSelectors";
import {
  DEFAULT_IMAGE_QUALITY,
  FALLBACK_IMAGE_MODELS,
  IMAGE_MODEL_STORAGE_KEY,
  IMAGE_QUALITY_STORAGE_KEY,
  type ImageModelInfo,
  type ImageModelsResponse,
  type ImageQuality,
  buildImageRequestFields,
  defaultImageModelId,
  imageModelErrorMessage,
  imageModelLabel,
  resolveStoredModel,
  resolveStoredQuality,
} from "@/lib/image-model-selection";
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
import { ReasoningBlock } from "./reasoning-block";
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
import { hasUserAuthoredMessage } from "./chat-session-restore";
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
  /**
   * Цепочка рассуждений модели, пришедшая по SSE. Показывается свёрнутой
   * строкой «Думал N секунд» над ответом и раскрывается по клику.
   */
  reasoning?: string;
  /** Сколько модель думала, мс — для подписи свёрнутого блока. */
  reasoningMs?: number;
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
// Доска сохраняется реже сообщений: она тяжёлая, а рисование порождает поток
// мелких изменений. 4 секунды простоя — компромисс между «не потерять» и «не
// гнать мегабайты на каждый штрих».
const CANVAS_AUTOSAVE_DELAY_MS = 4000;
// Тот же предел, что и на сервере (serializers.MAX_CANVAS_BYTES). Дублирован
// осознанно: клиент обязан не отправлять заведомо отвергаемый запрос.
const MAX_CANVAS_BYTES = 12 * 1024 * 1024;

/**
 * Снимок доски для сохранения.
 *
 * Камера входит в снимок намеренно: без неё восстановленная доска открывалась
 * бы в произвольном месте, и ученик не нашёл бы собственные рисунки.
 */
function canvasSnapshot(): { elements: unknown[]; camera: unknown } {
  const state = useWhiteboardStore.getState();
  return { elements: state.elements, camera: state.camera };
}

/** Для сравнения «изменилось ли»: холст с картинками весит мегабайты, и
 * отправлять его повторно без изменений слишком дорого. */
function serializeCanvas(snapshot: unknown): string {
  return JSON.stringify(snapshot ?? { elements: [], camera: null });
}

/** Stable serialization of everything autosave writes, used to tell an
 * actual change from a re-render that produced identical content. */
function serializeSessionPayload(input: {
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
  // Живое состояние стрима: рассуждение и ответ накапливаются по мере прихода
  // SSE-дельт и рендерятся ещё до того, как запрос завершился.
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingStage, setStreamingStage] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [generationStyle, setGenerationStyle] = useState("flat");
  const [internalLessonPlan, setInternalLessonPlan] =
    useState<LessonPlan | null>(null);
  const [internalActiveTaskIndex, setInternalActiveTaskIndex] = useState(0);
  // Saved-chat-history bookkeeping: null until the first message creates a
  // session, then every later change PATCHes the same row.
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  const hasRestoredSessionRef = useRef(false);
  const sessionCreateInFlightRef = useRef(false);
  // Serialized copy of what the server already holds. Autosave compares
  // against it and skips a no-op request — otherwise loading a chat from
  // history would immediately PATCH it straight back, and messages carry
  // whole BoardData payloads.
  const lastSavedPayloadRef = useRef<string | null>(null);
  const lastSavedCanvasRef = useRef<string | null>(null);
  // Автосейв доски живёт вне React-цикла (store.subscribe), поэтому актуальный
  // id сессии он читает из ref, а не из замыкания эффекта.
  const currentSessionIdRef = useRef<string | null>(null);
  const [canvasSaveError, setCanvasSaveError] = useState("");
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

  // ── Выбор image-модели ────────────────────────────────────────────────────
  // Выбор персональный: живёт в localStorage этого браузера и НЕ меняет модель
  // для других пользователей — глобальный дефолт задаётся только на backend
  // через IMAGE_GEN_DEFAULT_MODEL.
  const [availableImageModels, setAvailableImageModels] =
    useState<ImageModelInfo[]>(FALLBACK_IMAGE_MODELS);
  const [imageModel, setImageModel] = useState(() =>
    defaultImageModelId(FALLBACK_IMAGE_MODELS)
  );
  const [imageQuality, setImageQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  // Актуальная модель вне React-цикла. Нужна асинхронной сверке с allowlist:
  // к моменту ответа сервера пользователь мог уже переключить модель сам, и
  // затирать его выбор значением из замыкания нельзя.
  const imageModelRef = useRef(imageModel);
  const imageQualityRef = useRef(imageQuality);

  // Модель и качество меняются ВМЕСТЕ и только в трёх местах: гидрация,
  // сверка с allowlist сервера и выбор пользователя. Отдельного эффекта-
  // нормализатора здесь намеренно нет: он срабатывал на монтировании со
  // значением первого рендера (Seedream, качества нет) и понижал прочитанное
  // из localStorage `high` до `medium`.
  const applyImageChoice = useCallback(
    (model: string, quality: string | null | undefined, models: ImageModelInfo[]) => {
      const nextQuality = resolveStoredQuality(quality, model, models);
      imageModelRef.current = model;
      imageQualityRef.current = nextQuality;
      setImageModel(model);
      setImageQuality(nextQuality);
      return nextQuality;
    },
    []
  );

  // Первая загрузка: сначала localStorage (мгновенно), затем сверка с реальным
  // allowlist сервера. Модель, выпавшая из allowlist, обязана сброситься —
  // иначе она уедет в запрос и вернётся 400 на каждой генерации.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedModel = window.localStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
    const storedQuality = window.localStorage.getItem(IMAGE_QUALITY_STORAGE_KEY);
    applyImageChoice(
      resolveStoredModel(storedModel, FALLBACK_IMAGE_MODELS),
      storedQuality,
      FALLBACK_IMAGE_MODELS
    );

    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/api/ai/image-models");
        if (!res.ok) return;
        const data = (await res.json()) as ImageModelsResponse;
        if (cancelled || !Array.isArray(data?.models) || data.models.length === 0) return;
        setAvailableImageModels(data.models);
        // Сверяем ТЕКУЩИЙ выбор (из ref, а не из замыкания): пока запрос летел,
        // пользователь мог переключить модель сам.
        applyImageChoice(
          resolveStoredModel(imageModelRef.current, data.models, data.default_model),
          imageQualityRef.current,
          data.models
        );
      } catch {
        // Список моделей — не критичный запрос: без него остаётся статический
        // fallback, и доска продолжает работать.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyImageChoice]);

  /**
   * Сохранение — в обработчиках выбора, а НЕ в эффекте на [imageModel].
   *
   * Эффект здесь уже ломался: состояние стартует с дефолта, прочитанное из
   * localStorage значение приезжает эффектом, и эффект-запись успевал
   * сохранить дефолт первого рендера раньше — выбор не переживал перезагрузку.
   * Запись по действию пользователя от порядка эффектов не зависит вовсе.
   */
  const persistImageChoice = useCallback(
    (model: string, quality: ImageQuality) => {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, model);
      window.localStorage.setItem(IMAGE_QUALITY_STORAGE_KEY, quality);
    },
    []
  );

  const handleImageModelChange = useCallback(
    (next: string) => {
      const nextQuality = applyImageChoice(
        next,
        imageQualityRef.current,
        availableImageModels
      );
      persistImageChoice(next, nextQuality);
    },
    [availableImageModels, applyImageChoice, persistImageChoice]
  );

  const handleImageQualityChange = useCallback(
    (next: ImageQuality) => {
      const nextQuality = applyImageChoice(
        imageModelRef.current,
        next,
        availableImageModels
      );
      persistImageChoice(imageModelRef.current, nextQuality);
    },
    [availableImageModels, applyImageChoice, persistImageChoice]
  );

  // Поля модели для ЛЮБОГО запроса генерации: обычной, отложенной догрузки,
  // рестайла и повтора. Одна точка сборки — чтобы выбор не потерялся ровно на
  // одном из путей.
  const imageRequestFields = useMemo(
    () => buildImageRequestFields(imageModel, imageQuality, availableImageModels),
    [imageModel, imageQuality, availableImageModels]
  );

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
      // «Грязно» — это то, что НАПИСАЛ пользователь, а не служебные баннеры
      // интейка плана. Почему не `messages.length > 0` — см. docstring
      // hasUserAuthoredMessage: та проверка отменяла восстановление всегда.
      if (skipIfDirty && hasUserAuthoredMessage(messagesRef.current)) {
        return null;
      }
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
      // Доска — часть сессии: открывать сохранённый чат без его рисунков
      // бессмысленно. Пустой canvas тоже применяем: это «доска была пуста», а
      // не «не сохраняли», иначе на экране остался бы холст прошлого чата.
      useWhiteboardStore.getState().restoreCanvas(session.canvas ?? null);
      lastSavedCanvasRef.current = serializeCanvas(session.canvas ?? null);
      // The server already holds exactly this, so autosave must not PATCH it
      // straight back — see lastSavedPayloadRef.
      lastSavedPayloadRef.current = serializeSessionPayload({
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

  // ── Автосейв ДОСКИ ────────────────────────────────────────────────────────
  // Отдельно от сообщений и заметно реже. Причина в объёме: одна иллюстрация
  // лежит в элементе как data-URI примерно на 590 КБ, и сохранять доску на том
  // же 1.2-секундном дебаунсе значило бы гнать мегабайты при каждом штрихе.
  //
  // Подписка идёт мимо React (store.subscribe): подписать компонент чата на
  // elements означало бы перерисовывать его на каждое движение карандаша.
  useEffect(() => {
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const snapshot = canvasSnapshot();
        const serialized = serializeCanvas(snapshot);
        // Ничего не изменилось с прошлого сохранения — не тратим сеть.
        if (serialized === lastSavedCanvasRef.current) return;
        const hasContent = Array.isArray(snapshot.elements) && snapshot.elements.length > 0;

        // Ученик может рисовать, не написав ни одного сообщения — тогда сессии
        // ещё нет, и создать её должен именно этот автосейв, иначе рисунки
        // просто некуда сохранить. Пустую доску не создаём: заход на страницу
        // не должен заводить пустой чат в истории.
        if (!currentSessionIdRef.current) {
          if (!hasContent) return;
          if (sessionCreateInFlightRef.current) return;
          sessionCreateInFlightRef.current = true;
          createChatSession({
            id: crypto.randomUUID(),
            topic: "",
            messages: [],
            lesson_plan: null,
            canvas: snapshot,
          })
            .then((created) => {
              lastSavedCanvasRef.current = serialized;
              setCurrentSessionId(created.id);
              currentSessionIdRef.current = created.id;
              window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, created.id);
              void refreshHistory();
            })
            .catch(() => {})
            .finally(() => {
              sessionCreateInFlightRef.current = false;
            });
          return;
        }

        if (serialized.length > MAX_CANVAS_BYTES) {
          // Сервер такой холст отвергнет (см. validate_canvas). Молча резать
          // рисунки нельзя, поэтому честно говорим и не отправляем.
          setCanvasSaveError(
            "Доска слишком большая для автосохранения — удалите часть иллюстраций",
          );
          return;
        }

        setCanvasSaveError("");
        updateChatSession(currentSessionIdRef.current, { canvas: snapshot })
          .then(() => {
            lastSavedCanvasRef.current = serialized;
          })
          .catch(() => {
            // Best-effort: ref не двигаем, следующая правка повторит попытку.
          });
      }, CANVAS_AUTOSAVE_DELAY_MS);
    };

    const unsubscribe = useWhiteboardStore.subscribe(schedule);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
    // refreshHistory стабилен (useCallback без зависимостей), подписка
    // ставится один раз на всё время жизни компонента.
  }, [refreshHistory]);

  // Список нужен не только внутри поповера: рядом с кнопкой стоит счётчик
  // сохранённых чатов, и без загрузки на монтировании он показывал бы 0 до
  // первого открытия истории.
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);


  // Best-effort autosave: debounced so a burst of streaming updates doesn't
  // fire a request per keystroke-equivalent. Creates the session on the
  // first message, then PATCHes the same row as the conversation grows.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const payload = {
        // Заголовок НЕ отправляем: его придумывает backend по первой реплике
        // (chat_title.py), один раз при создании. Пока его слал клиент, каждый
        // автосейв перезаписывал осмысленное имя обратно на кусок первой
        // фразы, и умное название жило до следующего сообщения.
        topic: currentLessonPlan?.topic ?? "",
        // Рассуждение — эфемерная деталь UI и весит порядка килобайта на
        // сообщение. В сохранённую историю оно не едет: иначе каждый автосейв
        // тащил бы килобайты, которые всё равно никто не перечитывает.
        messages: messages.map(({ reasoning, reasoningMs, ...rest }) => rest),
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
            // Появился новый чат — счётчик рядом с кнопкой истории должен это
            // показать сразу, а не после следующего открытия поповера.
            void refreshHistory();
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
    refreshHistory,
    messages,
    currentLessonPlan,
    currentSessionId,
    tutorMode,
    hintLevel,
    attemptCount,
  ]);

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
    async (
      pending: PendingIllustration[],
      topicHint?: string,
      referenceImageUrl?: string,
    ) => {
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
                ...imageRequestFields,
                // При рестайле отдаём прежнюю картинку как основу: i2i
                // сохраняет композицию, меняя только манеру рисунка.
                ...(referenceImageUrl
                  ? { reference_image_url: referenceImageUrl }
                  : {}),
              }),
            });
            const raw = await res.text();
            const data = raw ? JSON.parse(raw) : {};
            if (!res.ok) throw new Error(data.error || `Сервер вернул ${res.status}`);

            const enriched = data.command ?? {};
            const src: string | undefined = enriched.base_image_url || enriched.image_url;
            if (!src) {
              // Модель не отдала картинку. Называем ЕЁ и предлагаем вторую, но
              // не переключаем сами: пользователь сравнивает модели вручную, и
              // молчаливая подмена сделала бы сравнение бессмысленным.
              throw new Error(
                typeof enriched.image_error === "string"
                  ? enriched.image_error
                  : imageModelErrorMessage(imageModel, availableImageModels)
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
                  // A/B-метаданные: чем именно нарисована ЭТА картинка. Берём
                  // ответ сервера — векторный путь мог вернуть чистый
                  // детерминированный PNG и не звать image-модель вовсе.
                  imageModel:
                    typeof enriched.image_model === "string"
                      ? enriched.image_model
                      : undefined,
                  imageQuality:
                    typeof enriched.image_quality === "string"
                      ? enriched.image_quality
                      : undefined,
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
    // imageRequestFields/imageModel обязаны быть в зависимостях: без них
    // замыкание удержит модель, выбранную на момент прошлого рендера, и
    // отложенная догрузка нарисует не тем, что показано в селекторе.
    [
      generationStyle,
      generationPalette,
      imageRequestFields,
      imageModel,
      availableImageModels,
      onUsageChange,
    ]
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
    setStreamingReasoning("");
    setStreamingContent("");
    setStreamingStage("routing");
    const startedAt = Date.now();

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
      const res = await authFetch("/api/ai/chat/stream", {
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
          ...imageRequestFields,
          // Картинки не ждём: доска с текстом и подписями приходит за ~18с,
          // а растры догружаются отдельными запросами (loadPendingIllustrations).
          defer_images: true,
          lesson_plan: currentLessonPlan,
          active_lesson_task:
            currentLessonPlan?.tasks[currentTaskIndex] ?? null,
          ...(referenceImageUrl && { reference_image_url: referenceImageUrl }),
          ...(referenceLabels && { reference_labels: referenceLabels }),
          // Сюжет предыдущей картинки. С ним «сделай в стиле скетч»
          // перерисовывает ЕЁ ЖЕ, не поднимая board-модель и не генерируя
          // заново весь текст конспекта.
          ...(refEl?.type === "ILLUSTRATION" && refEl.imagePrompt
            ? { reference_prompt: refEl.imagePrompt }
            : {}),
        }),
      });

      // Ответ приходит одним из двух способов:
      //   text/event-stream — нормальный путь, читаем поток и показываем
      //                       рассуждение и ответ по мере генерации;
      //   что угодно другое — старый бэкенд без /chat/stream, либо прокси
      //                       свернул поток в обычный ответ. Тогда парсим
      //                       тело как JSON и работаем по-старому. Без этого
      //                       фолбэка любой сбой прокси дал бы пустой чат.
      const isEventStream = (res.headers.get("Content-Type") || "").includes(
        "text/event-stream"
      );

      let data: any = {};
      let streamedReasoning = "";

      if (isEventStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedContent = "";
        let streamError: string | null = null;

        // SSE-кадры разделены пустой строкой; кусок может оборваться на
        // середине кадра, поэтому хвост держим в buffer до следующего чтения.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            let event = "message";
            let raw = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event: ")) event = line.slice(7).trim();
              else if (line.startsWith("data: ")) raw += line.slice(6);
            }
            if (!raw) continue;

            let payload: any;
            try {
              payload = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event === "reasoning") {
              streamedReasoning += payload.delta ?? "";
              setStreamingReasoning(streamedReasoning);
            } else if (event === "content") {
              streamedContent += payload.delta ?? "";
              setStreamingContent(streamedContent);
            } else if (event === "stage") {
              setStreamingStage(payload.stage ?? null);
            } else if (event === "done") {
              data = payload;
            } else if (event === "error") {
              streamError = payload.error || "Не удалось получить ответ.";
            }
          }
        }

        if (streamError) throw new Error(streamError);
        if (!data.reply && streamedContent) data.reply = streamedContent;
      } else {
        // The body may be non-JSON (e.g. a proxy 500 / "Internal Server Error"
        // when the model is slow), so parse defensively.
        const rawBody = await res.text();
        try {
          data = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          data = {};
        }
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

      // Чистая смена стиля: бэкенд вернул доску из ОДНОЙ картинки с флагом
      // restyle. Раскладывать её как новую нельзя — иначе рядом появится
      // вторая копия иллюстрации. Перерисовываем ту же самую на месте: ставим
      // ей pending и догружаем растр в ТОТ ЖЕ элемент существующим механизмом
      // отложенных иллюстраций.
      if (board && (board as { restyle?: boolean }).restyle) {
        const restyleCommand = board.board_steps
          ?.flatMap((step) => step.commands ?? [])
          .find((command) => command?.type === "image_with_labels");

        if (refEl && restyleCommand) {
          const state = useWhiteboardStore.getState();
          state.executeActions([
            {
              type: "UPDATE_ELEMENT",
              payload: {
                id: refEl.id,
                pending: true,
                error: undefined,
                genStyle: generationStyle,
                // Рестайл идёт выбранной моделью — плейсхолдер должен назвать
                // именно её, а не ту, которой картинка была нарисована раньше.
                imageModel,
              },
            },
          ]);
          void loadPendingIllustrations(
            [{ elementId: refEl.id, command: restyleCommand }],
            board.topic,
            referenceImageUrl,
          );
        }
        // Дальше по общему пути не идём: текста в такой доске нет, а картинку
        // мы уже обработали.
        board = null;
      }

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
            imageModel,
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

      const reasoning = (data.reasoning || streamedReasoning || "").trim();
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || (board ? "Вот разбор:" : "Готово."),
        board,
        clarify,
        ...(reasoning && {
          reasoning,
          reasoningMs: Date.now() - startedAt,
        }),
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
      // Живой блок гасим только здесь: рассуждение уже переехало в сообщение,
      // и если оставить состояние, оно продублируется под ответом.
      setStreamingReasoning("");
      setStreamingContent("");
      setStreamingStage(null);
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
          {/* Счётчик стоит вплотную к иконке истории, поэтому и читается как
              «сколько сохранённых чатов». Раньше он показывал число реплик
              пользователя в ТЕКУЩЕМ чате — величину, которая рядом с этой
              кнопкой не значит ничего. Показываем то, чего от него ждут. */}
          {historyItems.length > 0 && (
            <span
              className="mr-1 text-[10px] tabular-nums text-[#aaa49b]"
              title={`Сохранённых чатов: ${historyItems.length}`}
            >
              {historyItems.length}
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
                  <div className="flex max-w-[94%] flex-col gap-1.5">
                    {msg.reasoning && (
                      <ReasoningBlock
                        reasoning={msg.reasoning}
                        streaming={false}
                        durationMs={msg.reasoningMs}
                      />
                    )}
                  <div
                    className={`flex flex-col gap-3 whitespace-pre-wrap px-3.5 py-2.5 text-[13px] leading-[1.55] ${
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
                </div>
              ),
            )}

            {/* Живой ход мысли модели вместо прежнего статичного чеклиста:
                тот показывал две захардкоженные строки и «понял запрос» с
                готовой галочкой в ту же миллисекунду, что и отправку. */}
            {isLoading && (
              // Прежний статус был одной обобщённой строкой «Думаю над
              // ответом…»: бэкенд отвечал одним непрозрачным POST, и знать,
              // что именно происходит, было нельзя. Теперь /chat/stream отдаёт
              // ход мысли и текст по мере генерации, поэтому показываем
              // реальное состояние, а не заглушку.
              <div className="flex flex-col gap-1.5">
                <ReasoningBlock
                  reasoning={streamingReasoning}
                  streaming
                  stage={streamingStage}
                />
                {streamingContent && (
                  <div className="max-w-[94%] whitespace-pre-wrap rounded-[16px] border border-[#dedad3] bg-white/62 px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#514b43]">
                    {streamingContent}
                  </div>
                )}
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

              {/* Настройки генерации собраны в одну группу и умеют переноситься:
                  панель AI Tutor узкая (~370px), и четыре пилюли в один ряд не
                  влезают — без wrap они наезжали друг на друга. */}
              <div className="flex flex-wrap items-center gap-1 gap-y-2">
                <>
                  <PaletteSelectorDropdown
                    value={generationPalette}
                    onChange={setGenerationPalette}
                  />
                  <StyleSelectorDropdown
                    value={generationStyle}
                    onChange={setGenerationStyle}
                  />
                  <ImageModelSelectorDropdown
                    value={imageModel}
                    models={availableImageModels}
                    onChange={handleImageModelChange}
                  />
                  <QualitySelectorDropdown
                    value={imageQuality}
                    modelId={imageModel}
                    models={availableImageModels}
                    onChange={handleImageQualityChange}
                  />
                </>

                {/* ml-auto прижимает отправку вправо на ТОЙ строке, куда она
                    попала после переноса настроек. */}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <AIUsageIndicator
                    summary={usageSummary}
                    isLoading={usageLoading}
                    context={{
                      usedTokens: contextSnapshot.usedTokens,
                      limitTokens: contextSnapshot.limitTokens,
                      percent: contextSnapshot.contextPercent,
                    }}
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
