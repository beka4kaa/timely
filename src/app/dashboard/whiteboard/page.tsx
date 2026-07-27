"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  Clock3,
  Copy,
  Download,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Share2,
  UserRound,
  X,
} from "lucide-react";
import Whiteboard from "@/components/whiteboard/Whiteboard";
import {
  AIChat,
  type ChatContextSnapshot,
} from "@/components/board/ai-chat";
import {
  LessonPlanDetailsDialog,
  LessonPlanProgress,
  type LessonPlan,
} from "@/components/board/lesson-plan";
import {
  CollapsedUsageMeters,
  useAIUsageSummary,
} from "@/components/board/usage-tracker";
import { BoardSettingsDialog } from "@/components/board/settings-dialog";
import { MobileDashboardMenu } from "@/components/mobile-dashboard-menu";
import { useMe } from "@/lib/contest-api";
import { getDashboardNavigation } from "@/config/dashboard-navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MOBILE_BREAKPOINT = 768;
const HEADER_HEIGHT = 48;
const RAIL_WIDTH = 58;
const DEFAULT_TUTOR_WIDTH = 420;
const MIN_TUTOR_WIDTH = 320;
const MAX_TUTOR_WIDTH = 720;
const MIN_BOARD_WIDTH = 360;
const COLLAPSED_TUTOR_WIDTH = 58;
const TIMER_STORAGE_KEY = "timely:whiteboard-timer:v1";
const TUTOR_WIDTH_STORAGE_KEY = "timely:whiteboard-tutor-width:v1";

function getTutorWidthBounds(viewportWidth: number) {
  return {
    min: MIN_TUTOR_WIDTH,
    max: Math.max(
      MIN_TUTOR_WIDTH,
      Math.min(
        MAX_TUTOR_WIDTH,
        viewportWidth - RAIL_WIDTH - MIN_BOARD_WIDTH,
      ),
    ),
  };
}

function clampTutorWidth(width: number, viewportWidth: number) {
  const bounds = getTutorWidthBounds(viewportWidth);
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

function persistTutorWidth(width: number) {
  try {
    window.localStorage.setItem(TUTOR_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // The current width still works for this session when storage is unavailable.
  }
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function compactChatTopic(message: string) {
  const words = message
    .replace(/[.,!?;:()[\]{}"«»/\\|]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words.slice(0, 3).join(" ") || "Новый запрос";
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some embedded browsers expose Clipboard API but deny the permission.
      // Fall through to the selection-based copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

export default function WhiteboardPage() {
  const { me } = useMe();
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [tutorWidth, setTutorWidth] = useState(DEFAULT_TUTOR_WIDTH);
  const [tutorWidthBounds, setTutorWidthBounds] = useState(() =>
    getTutorWidthBounds(1440),
  );
  const [isTutorResizing, setIsTutorResizing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [hasTimerStarted, setHasTimerStarted] = useState(false);
  const [timerReady, setTimerReady] = useState(false);
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [activeLessonTaskIndex, setActiveLessonTaskIndex] = useState(0);
  const [isLessonPlanOpen, setIsLessonPlanOpen] = useState(false);
  const [chatContext, setChatContext] = useState<ChatContextSnapshot>({
    lastUserMessage: "",
    contextPercent: 0,
    usedTokens: 0,
    limitTokens: 128_000,
    userMessageCount: 0,
  });
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareCopyLabel, setShareCopyLabel] = useState("Скопировать ссылку");
  const shareInputRef = useRef<HTMLInputElement>(null);
  const viewportModeRef = useRef<boolean | null>(null);
  const tutorWidthRef = useRef(DEFAULT_TUTOR_WIDTH);
  const tutorResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const {
    summary: usageSummary,
    isLoading: usageLoading,
    refresh: refreshUsage,
  } = useAIUsageSummary();

  useEffect(() => {
    const initialBounds = getTutorWidthBounds(window.innerWidth);
    let storedWidth = Number.NaN;
    try {
      storedWidth = Number(
        window.localStorage.getItem(TUTOR_WIDTH_STORAGE_KEY),
      );
    } catch {
      storedWidth = Number.NaN;
    }
    const initialWidth = clampTutorWidth(
      Number.isFinite(storedWidth) && storedWidth > 0
        ? storedWidth
        : DEFAULT_TUTOR_WIDTH,
      window.innerWidth,
    );
    setTutorWidthBounds(initialBounds);
    tutorWidthRef.current = initialWidth;
    setTutorWidth(initialWidth);

    const checkViewport = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (mobile && viewportModeRef.current !== true) {
        setIsChatOpen(false);
      }
      viewportModeRef.current = mobile;

      const bounds = getTutorWidthBounds(window.innerWidth);
      setTutorWidthBounds(bounds);
      setTutorWidth((current) => {
        const nextWidth = clampTutorWidth(current, window.innerWidth);
        tutorWidthRef.current = nextWidth;
        return nextWidth;
      });
    };

    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  useEffect(() => {
    if (!isTutorResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isTutorResizing]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(TIMER_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as {
          elapsedSeconds?: number;
          isRunning?: boolean;
          updatedAt?: number;
        };
        const storedSeconds = Math.max(0, Number(stored.elapsedSeconds) || 0);
        const additionalSeconds =
          stored.isRunning && stored.updatedAt
            ? Math.max(0, Math.floor((Date.now() - stored.updatedAt) / 1000))
            : 0;
        setElapsedSeconds(storedSeconds + additionalSeconds);
        setIsTimerRunning(Boolean(stored.isRunning));
        setHasTimerStarted(storedSeconds > 0 || Boolean(stored.isRunning));
      }
    } catch {
      window.sessionStorage.removeItem(TIMER_STORAGE_KEY);
    } finally {
      setTimerReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isTimerRunning) return;
    const timer = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [isTimerRunning]);

  useEffect(() => {
    if (!timerReady) return;
    window.sessionStorage.setItem(
      TIMER_STORAGE_KEY,
      JSON.stringify({
        elapsedSeconds,
        isRunning: isTimerRunning,
        updatedAt: Date.now(),
      }),
    );
  }, [elapsedSeconds, isTimerRunning, timerReady]);

  useEffect(() => {
    if (!isShareDialogOpen) return;

    const focusTimer = window.setTimeout(() => {
      shareInputRef.current?.focus();
      shareInputRef.current?.select();
    }, 50);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsShareDialogOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isShareDialogOpen]);

  const boardFrameStyle = useMemo(
    () => ({
      top: HEADER_HEIGHT,
      left: isMobile ? 0 : RAIL_WIDTH,
      right: isChatOpen
        ? isMobile
          ? 0
          : tutorWidth
        : isMobile
          ? 0
          : COLLAPSED_TUTOR_WIDTH,
      bottom: 0,
    }),
    [isChatOpen, isMobile, tutorWidth],
  );

  const collapsedChatTopic = useMemo(
    () => compactChatTopic(chatContext.lastUserMessage),
    [chatContext.lastUserMessage],
  );
  const usageContext = useMemo(
    () => ({
      usedTokens: chatContext.usedTokens,
      limitTokens: chatContext.limitTokens,
      percent: chatContext.contextPercent,
    }),
    [
      chatContext.contextPercent,
      chatContext.limitTokens,
      chatContext.usedTokens,
    ],
  );

  const toggleChat = useCallback(() => setIsChatOpen((open) => !open), []);

  const beginTutorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        isMobile ||
        !isChatOpen ||
        !event.isPrimary ||
        (event.buttons & 1) !== 1
      ) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      tutorResizeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: tutorWidthRef.current,
      };
      setIsTutorResizing(true);
    },
    [isChatOpen, isMobile],
  );

  const moveTutorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = tutorResizeRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const nextWidth = clampTutorWidth(
        drag.startWidth + drag.startX - event.clientX,
        window.innerWidth,
      );
      tutorWidthRef.current = nextWidth;
      setTutorWidth(nextWidth);
    },
    [],
  );

  const endTutorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = tutorResizeRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      tutorResizeRef.current = null;
      setIsTutorResizing(false);
      persistTutorWidth(tutorWidthRef.current);
    },
    [],
  );

  const resizeTutorWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let nextWidth = tutorWidthRef.current;
      if (event.key === "ArrowLeft") nextWidth += 24;
      else if (event.key === "ArrowRight") nextWidth -= 24;
      else if (event.key === "Home") nextWidth = tutorWidthBounds.min;
      else if (event.key === "End") nextWidth = tutorWidthBounds.max;
      else return;

      event.preventDefault();
      nextWidth = clampTutorWidth(nextWidth, window.innerWidth);
      tutorWidthRef.current = nextWidth;
      setTutorWidth(nextWidth);
      persistTutorWidth(nextWidth);
    },
    [tutorWidthBounds.max, tutorWidthBounds.min],
  );

  const handleLessonPlanChange = useCallback((plan: LessonPlan | null) => {
    setLessonPlan(plan);
    setActiveLessonTaskIndex(0);
    if (!plan) setIsLessonPlanOpen(false);
  }, []);

  const toggleTimer = useCallback(() => {
    setHasTimerStarted(true);
    setIsTimerRunning((running) => !running);
  }, []);

  const resetTimer = useCallback(() => {
    setElapsedSeconds(0);
    setIsTimerRunning(false);
    setHasTimerStarted(false);
    window.sessionStorage.removeItem(TIMER_STORAGE_KEY);
  }, []);

  const openShareDialog = useCallback(() => {
    setShareUrl(window.location.href);
    setShareCopyLabel("Скопировать ссылку");
    setIsShareDialogOpen(true);
  }, []);

  const handleCopyShareLink = useCallback(async () => {
    try {
      await copyText(shareUrl);
      setShareCopyLabel("Ссылка скопирована");
    } catch {
      shareInputRef.current?.focus();
      shareInputRef.current?.select();
      setShareCopyLabel(
        navigator.platform.toLowerCase().includes("mac")
          ? "Нажмите ⌘C"
          : "Нажмите Ctrl+C",
      );
    }
  }, [shareUrl]);

  const handleExport = useCallback(() => {
    window.print();
  }, []);

  const handleCrop = useCallback((result: { boundingBox?: unknown }) => {
    console.log("📦 Crop callback received:", result.boundingBox);
  }, []);

  const navigationGroups = useMemo(
    () =>
      getDashboardNavigation({
        is_admin: me?.is_admin,
        is_moderator: me?.is_moderator,
        is_staff: me?.is_staff,
      }),
    [me?.is_admin, me?.is_moderator, me?.is_staff],
  );

  return (
    <div className="timely-whiteboard-shell fixed inset-0 z-[100] overflow-hidden bg-[#f7f5f1] text-[#2f2c28] [color-scheme:light]">
      <header className="absolute inset-x-0 top-0 z-[90] flex h-12 items-center border-b border-[#dedbd4] bg-[#fbfaf7]/95 px-2.5 backdrop-blur-xl md:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Image
            src="/logo.svg"
            alt="Timely"
            width={24}
            height={24}
            priority
            className="shrink-0"
          />
          <div className="hidden h-6 w-px bg-[#d8d4cc] sm:block" />
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-serif text-[15px] font-semibold tracking-[-0.02em] text-[#8a5b24]">
              Timely
            </span>
            <span className="hidden truncate font-serif text-[14px] text-[#34302b] sm:inline">
              Научная доска
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="hidden items-center sm:flex">
            <button
              type="button"
              onClick={toggleTimer}
              aria-label={
                isTimerRunning
                  ? "Поставить таймер на паузу"
                  : hasTimerStarted
                    ? "Продолжить таймер"
                    : "Начать таймер"
              }
              className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
                isTimerRunning
                  ? "border-[#c99a5a] bg-[#fff8eb] text-[#83561f]"
                  : "border-[#ddd9d1] bg-white/70 text-[#746f67] hover:border-[#c9c3b9] hover:bg-white"
              }`}
            >
              {isTimerRunning ? (
                <Pause className="h-3.5 w-3.5" />
              ) : hasTimerStarted ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Clock3 className="h-3.5 w-3.5" />
              )}
              <span className={hasTimerStarted ? "tabular-nums" : ""}>
                {hasTimerStarted ? formatElapsed(elapsedSeconds) : "Начать таймер"}
              </span>
            </button>
            {hasTimerStarted && (
              <button
                type="button"
                onClick={resetTimer}
                aria-label="Сбросить таймер"
                title="Сбросить таймер"
                className="-ml-1 grid h-8 w-7 place-items-center rounded-r-full text-[#9a9389] outline-none transition-colors hover:text-[#4c453d] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleExport}
            className="hidden h-8 items-center gap-1.5 rounded-full border border-[#ddd9d1] bg-white/70 px-2.5 text-[11px] text-[#746f67] outline-none transition-colors hover:border-[#c9c3b9] hover:bg-white hover:text-[#2f2c28] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 sm:flex"
          >
            <Download className="h-3.5 w-3.5" />
            Экспорт
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Открыть настройки"
            title="Настройки"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#ddd9d1] bg-white/70 text-[#817a71] outline-none transition-colors hover:bg-white hover:text-[#2f2c28] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 md:hidden"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={openShareDialog}
            className="flex h-8 items-center gap-1.5 rounded-full bg-[#302d2a] px-3 text-[11px] font-medium text-white outline-none transition-colors hover:bg-[#181715] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/40"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Поделиться</span>
          </button>

          <MobileDashboardMenu navigationGroups={navigationGroups} />
        </div>
      </header>

      <aside className="absolute bottom-0 left-0 top-12 z-[70] hidden w-[58px] flex-col items-center border-r border-[#dedbd4] bg-[#fbfaf7] py-2 md:flex">
        <TooltipProvider delayDuration={120}>
          <nav
            aria-label="Разделы Timely"
            className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto px-2 [scrollbar-width:none]"
          >
            {navigationGroups.map((group, groupIndex) => (
              <div
                key={group.label}
                aria-label={group.label}
                className="flex w-full flex-col items-center gap-0.5"
              >
                {group.items.map((item) => {
                  const active = item.url === "/dashboard/whiteboard";
                  const Icon = item.icon;
                  return (
                    <Tooltip key={item.url}>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.url}
                          aria-label={item.title}
                          aria-current={active ? "page" : undefined}
                          className={`grid h-8 w-10 shrink-0 place-items-center rounded-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
                            active
                              ? "border border-[#d9ad70] bg-[#fffaf1] text-[#a76b22] shadow-[0_3px_12px_rgba(116,75,28,0.07)]"
                              : "text-[#908a81] hover:bg-[#efede8] hover:text-[#34302b]"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        sideOffset={8}
                        className="border-[#302d2a] bg-[#302d2a] px-2.5 py-1.5 text-[11px] text-white"
                      >
                        {item.title}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {groupIndex < navigationGroups.length - 1 && (
                  <span className="my-1 h-px w-5 bg-[#e0dcd5]" />
                )}
              </div>
            ))}
          </nav>
        </TooltipProvider>

        <div className="mt-1 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Настройки"
            title="Настройки"
            className="grid h-9 w-10 place-items-center rounded-[10px] text-[#8f8a81] outline-none transition-colors hover:bg-[#efede8] hover:text-[#34302b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <Link
            href="/dashboard/profile"
            aria-label="Профиль"
            title="Профиль"
            className="grid h-9 w-10 place-items-center rounded-[10px] text-[#8f8a81] outline-none transition-colors hover:bg-[#efede8] hover:text-[#34302b] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
          >
            <UserRound className="h-4 w-4" />
          </Link>
        </div>
      </aside>

      <main
        className={`absolute overflow-hidden ${
          isTutorResizing
            ? ""
            : "transition-[right] duration-300 ease-out"
        }`}
        style={boardFrameStyle}
      >
        <Whiteboard onCrop={handleCrop} />

        {!isChatOpen && lessonPlan && (
          <div className="pointer-events-auto absolute left-1/2 top-4 z-40 -translate-x-1/2">
            <LessonPlanProgress
              plan={lessonPlan}
              activeTaskIndex={activeLessonTaskIndex}
              onOpen={() => setIsLessonPlanOpen(true)}
              maxVisible={4}
              floating
            />
          </div>
        )}
      </main>

      <aside
        className={`absolute bottom-0 top-12 z-[80] overflow-visible border-l border-[#dcd8d0] bg-[#f8f6f2] ${
          isTutorResizing
            ? ""
            : "transition-[width,transform] duration-300 ease-out"
        } ${
          isMobile ? "left-0 right-0 w-full" : "right-0"
        } ${
          isChatOpen
            ? "translate-x-0"
            : "pointer-events-none translate-x-full"
        }`}
        style={isMobile ? undefined : { width: tutorWidth }}
        aria-hidden={!isChatOpen}
      >
        {!isMobile && isChatOpen && (
          <div
            role="separator"
            aria-label="Изменить ширину AI Tutor"
            aria-orientation="vertical"
            aria-valuemin={tutorWidthBounds.min}
            aria-valuemax={tutorWidthBounds.max}
            aria-valuenow={tutorWidth}
            tabIndex={0}
            title="Потяните, чтобы изменить ширину"
            onPointerDown={beginTutorResize}
            onPointerMove={moveTutorResize}
            onPointerUp={endTutorResize}
            onPointerCancel={endTutorResize}
            onLostPointerCapture={endTutorResize}
            onKeyDown={resizeTutorWithKeyboard}
            className="group absolute bottom-0 left-0 top-0 z-30 hidden w-3 -translate-x-1/2 touch-none cursor-ew-resize items-center justify-center outline-none md:flex"
          >
            <span
              className={`h-14 w-[3px] rounded-full transition-[height,background-color,box-shadow] ${
                isTutorResizing
                  ? "h-20 bg-[#a9773b] shadow-[0_0_0_4px_rgba(185,133,70,0.12)]"
                  : "bg-[#d4cec4] group-hover:h-20 group-hover:bg-[#aa7a42] group-focus-visible:h-20 group-focus-visible:bg-[#aa7a42] group-focus-visible:shadow-[0_0_0_4px_rgba(185,133,70,0.12)]"
              }`}
            />
          </div>
        )}

        <div className="h-full overflow-hidden">
          <AIChat
            lessonPlan={lessonPlan}
            activeLessonTaskIndex={activeLessonTaskIndex}
            onLessonPlanChange={handleLessonPlanChange}
            onActiveLessonTaskChange={setActiveLessonTaskIndex}
            onOpenLessonPlan={() => setIsLessonPlanOpen(true)}
            onContextChange={setChatContext}
            usageSummary={usageSummary}
            usageLoading={usageLoading}
            onUsageChange={refreshUsage}
            onClose={toggleChat}
          />
        </div>
      </aside>

      {!isChatOpen && !isMobile && (
        <aside
          aria-label="Свернутый AI Tutor"
          className="absolute bottom-0 right-0 top-12 z-[82] border-l border-[#dcd8d0] bg-[#fbfaf7]"
          style={{ width: COLLAPSED_TUTOR_WIDTH }}
        >
          <button
            type="button"
            onClick={toggleChat}
            aria-label={`Открыть AI Tutor. Последний запрос: ${collapsedChatTopic}`}
            title={`Открыть AI Tutor · ${collapsedChatTopic}`}
            className="flex h-full w-full flex-col items-center text-[#8e877e] outline-none transition-colors hover:bg-[#f3f0ea] hover:text-[#4a433c] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#c9a16c]/35"
          >
            <span className="mt-4 shrink-0 font-serif text-[10px] font-semibold tracking-[0.08em] text-[#8b6436]">
              AI
            </span>

            <span className="my-3 h-px w-5 shrink-0 bg-[#dfdad2]" />

            <span className="flex min-h-0 flex-1 items-center overflow-hidden py-2">
              <span
                className="max-h-[220px] truncate font-serif text-[11px] tracking-[0.03em] text-[#746c63]"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                }}
              >
                {collapsedChatTopic}
              </span>
            </span>

            <CollapsedUsageMeters
              summary={usageSummary}
              context={usageContext}
            />
          </button>
        </aside>
      )}

      {!isChatOpen && isMobile && (
        <button
          type="button"
          onClick={toggleChat}
          aria-label={`Открыть AI Tutor. Последний запрос: ${collapsedChatTopic}`}
          title="Открыть AI Tutor"
          className="absolute right-2 top-[calc(50%+24px)] z-[82] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-[#d9d3ca] bg-[#fbfaf7]/96 text-[#756e65] shadow-[0_10px_30px_rgba(66,52,37,0.14)] outline-none backdrop-blur-xl transition-[background-color,color,transform] hover:bg-white hover:text-[#2f2c28] active:-translate-y-1/2 active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 md:hidden"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}

      {lessonPlan && isLessonPlanOpen && (
        <LessonPlanDetailsDialog
          plan={lessonPlan}
          activeTaskIndex={activeLessonTaskIndex}
          onSelectTask={setActiveLessonTaskIndex}
          onClose={() => setIsLessonPlanOpen(false)}
        />
      )}

      <BoardSettingsDialog
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        summary={usageSummary}
        context={usageContext}
        isLoading={usageLoading}
        userName={me?.name}
        userEmail={me?.email}
      />

      {isShareDialogOpen && (
        <div
          className="fixed inset-0 z-[140] grid place-items-center bg-[#2f2c28]/20 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsShareDialogOpen(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            className="relative w-full max-w-[460px] rounded-[22px] border border-[#d8d3ca] bg-[#fbfaf7] p-5 shadow-[0_24px_80px_rgba(47,44,40,0.22)]"
          >
            <button
              type="button"
              onClick={() => setIsShareDialogOpen(false)}
              aria-label="Закрыть окно «Поделиться»"
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[#928c83] outline-none transition-colors hover:bg-[#efede8] hover:text-[#302d2a] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
            >
              <X className="h-4 w-4" />
            </button>

            <h2
              id="share-dialog-title"
              className="pr-10 font-serif text-[20px] font-medium tracking-[-0.02em] text-[#302d2a]"
            >
              Поделиться доской
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[#817b72]">
              Отправьте эту ссылку — она уже выделена для копирования.
            </p>

            <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-[#d9d4cb] bg-white p-1.5">
              <input
                ref={shareInputRef}
                value={shareUrl}
                readOnly
                aria-label="Ссылка на научную доску"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent px-2 text-[12px] text-[#625c54] outline-none"
              />
              <button
                type="button"
                onClick={handleCopyShareLink}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[#302d2a] px-3 text-[11px] font-medium text-white outline-none transition-colors hover:bg-[#191816] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/40"
              >
                {shareCopyLabel === "Ссылка скопирована" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {shareCopyLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
