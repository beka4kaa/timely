"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Loader2, Square, X } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  matchingScheduleCommands,
  moveCommandSelection,
  resolveScheduleSubmission,
  slashQuery,
  type ScheduleAssistantMode,
  type ScheduleCommand,
} from "./schedule-commands";

const ADVICE_SUGGESTIONS = [
  "Оцени нагрузку на этой неделе",
  "Где план слишком плотный?",
  "Что можно улучшить?",
];

const PLAN_SUGGESTIONS = [
  "Разгрузи среду",
  "Я пропустил три дня, восстанови план",
  "По вторникам с 16:00 секция на два часа",
];

export function ScheduleComposer({
  hasSchedule,
  busy = false,
  disabled = false,
  showSuggestions = false,
  resetKey = 0,
  armPlanKey = 0,
  onSubmit,
  onStart,
  onStop,
}: {
  hasSchedule: boolean;
  busy?: boolean;
  disabled?: boolean;
  showSuggestions?: boolean;
  resetKey?: number;
  /** Клик по синему /plan в пустом состоянии активирует следующий запрос. */
  armPlanKey?: number;
  onSubmit: (text: string, mode: ScheduleAssistantMode) => void;
  onStart: () => void;
  onStop?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [pendingMode, setPendingMode] =
    useState<ScheduleAssistantMode>("advice");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const menuId = useId();

  const query = slashQuery(draft);
  const matches = useMemo(
    () => matchingScheduleCommands(draft, hasSchedule),
    [draft, hasSchedule],
  );
  const menuOpen = query !== null && !menuDismissed && !busy && !disabled;

  useEffect(() => {
    const firstAvailable = matches.findIndex((item) => item.available);
    setActiveIndex(firstAvailable >= 0 ? firstAvailable : matches.length ? 0 : -1);
  }, [draft, matches]);

  useEffect(() => {
    setDraft("");
    setPendingMode("advice");
    setMenuDismissed(false);
    setError("");
  }, [hasSchedule, resetKey]);

  useEffect(() => {
    if (armPlanKey <= 0 || !hasSchedule) return;
    setDraft("");
    setPendingMode("plan");
    setMenuDismissed(false);
    setError("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [armPlanKey, hasSchedule]);

  const resetTextarea = () => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const execute = (value: string) => {
    if (busy || disabled) return;
    const result = resolveScheduleSubmission(
      value,
      pendingMode,
      hasSchedule,
    );
    if (result.kind === "empty") return;
    if (result.kind === "error") {
      setError(result.message);
      return;
    }

    setError("");
    setMenuDismissed(false);
    if (result.kind === "start") {
      setDraft("");
      setPendingMode("advice");
      resetTextarea();
      onStart();
      return;
    }
    if (result.kind === "arm_plan") {
      setDraft("");
      setPendingMode("plan");
      resetTextarea();
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    // /plan всегда одноразовый: после отправки следующий обычный вопрос снова
    // становится безопасной оценкой расписания.
    setDraft("");
    setPendingMode("advice");
    resetTextarea();
    onSubmit(result.message, result.mode);
  };

  const chooseCommand = (item: ScheduleCommand) => execute(item.command);
  const selected = activeIndex >= 0 ? matches[activeIndex] : undefined;
  const suggestions = pendingMode === "plan" ? PLAN_SUGGESTIONS : ADVICE_SUGGESTIONS;

  return (
    <div className="relative w-full">
      {menuOpen ? (
        <div
          id={menuId}
          role="listbox"
          aria-label="Команды помощника по расписанию"
          className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-30 overflow-hidden rounded-[15px] border border-[#d9dde7] bg-[#fffefa] p-1.5 shadow-[0_16px_42px_rgba(38,52,77,0.16)]"
        >
          <div className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9299a8]">
            Навыки расписания
          </div>
          {matches.length ? (
            matches.map((item, index) => (
              <button
                key={item.id}
                id={`${menuId}-${item.id}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                aria-disabled={!item.available}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseCommand(item)}
                className={`group flex w-full items-start gap-3 rounded-[11px] px-2.5 py-2 text-left outline-none transition-colors ${
                  index === activeIndex ? "bg-[#eef4ff]" : "hover:bg-[#f4f6fa]"
                } ${item.available ? "" : "opacity-55"}`}
              >
                <span className="min-w-[54px] pt-px font-mono text-[12px] font-semibold text-[#2563eb] decoration-[#2563eb] decoration-dotted underline-offset-4 group-hover:underline group-focus-visible:underline">
                  {item.command}
                </span>
                <span className="min-w-0">
                  <span className="block font-serif text-[12px] font-semibold text-[#3f4652]">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-[#858c98]">
                    {item.available ? item.description : item.unavailableReason}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="px-2.5 py-2 text-[11.5px] text-[#8a6a5d]">
              Такой команды нет. Доступны <CommandWord>/start</CommandWord> и{" "}
              <CommandWord>/plan</CommandWord>.
            </div>
          )}
        </div>
      ) : null}

      {showSuggestions && hasSchedule ? (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {suggestions.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => execute(prompt)}
              disabled={busy || disabled}
              className="shrink-0 rounded-full border border-[#d9d4cc] bg-[#fbfaf7] px-3 py-1.5 font-serif text-[12px] text-[#7e776e] transition-colors hover:border-[#8caaf1] hover:text-[#2459bd] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 rounded-[17px] border border-[#d8d3cb] bg-[#fbfaf7] px-3 py-2 shadow-[0_8px_24px_rgba(67,57,45,0.06)] transition-[border-color,box-shadow] focus-within:border-[#6f95e8] focus-within:shadow-[0_10px_30px_rgba(43,96,190,0.10)]">
        {pendingMode === "plan" ? (
          <button
            type="button"
            onClick={() => {
              setPendingMode("advice");
              setError("");
              textareaRef.current?.focus();
            }}
            aria-label="Отключить навык /plan"
            className="mb-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[#b8caf5] bg-[#edf3ff] px-2 font-mono text-[11px] font-semibold text-[#2563eb] outline-none hover:underline hover:decoration-dotted hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-[#6f95e8]/35"
          >
            /plan
            <X className="h-3 w-3" aria-hidden />
          </button>
        ) : null}

        <textarea
          ref={textareaRef}
          role="combobox"
          placeholder={
            pendingMode === "plan"
              ? "Что изменить в плане?"
              : hasSchedule
                ? "Оцени расписание или введи /"
                : "Введи /start"
          }
          rows={1}
          value={draft}
          disabled={disabled}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={
            menuOpen && selected ? `${menuId}-${selected.id}` : undefined
          }
          aria-autocomplete="list"
          onChange={(event) => {
            setDraft(event.target.value);
            setMenuDismissed(false);
            setError("");
          }}
          onInput={(event) => {
            const node = event.currentTarget;
            node.style.height = "auto";
            node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (
              menuOpen &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              const direction = event.key as "ArrowDown" | "ArrowUp";
              setActiveIndex((current) =>
                moveCommandSelection(current, direction, matches.length),
              );
              return;
            }
            if (menuOpen && event.key === "Escape") {
              event.preventDefault();
              setMenuDismissed(true);
              return;
            }
            if (
              menuOpen &&
              selected &&
              (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))
            ) {
              event.preventDefault();
              chooseCommand(selected);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              execute(draft);
            }
          }}
          style={{ maxHeight: 160 }}
          className="min-h-[24px] min-w-0 flex-1 resize-none self-center bg-transparent py-1 font-serif text-[14px] leading-relaxed text-[#3b352f] outline-none placeholder:text-[#aaa49b]"
        />

        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => (busy && onStop ? onStop() : execute(draft))}
                disabled={busy ? !onStop : !draft.trim() || disabled}
                aria-label={busy && onStop ? "Остановить" : "Отправить"}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#567fd8] text-white outline-none transition-colors hover:bg-[#3d67c2] disabled:bg-[#e5dfd6] disabled:text-[#aaa49b]"
              >
                {busy ? (
                  onStop ? (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {busy && onStop ? "Остановить" : "Отправить (Enter)"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {error ? (
        <p className="mt-1.5 px-1 text-[11px] leading-snug text-[#a2543a]" role="alert">
          {error}
        </p>
      ) : pendingMode === "plan" ? (
        <p className="mt-1.5 px-1 text-[10.5px] text-[#7787a8]">
          Следующее сообщение подготовит изменение, но не применит его само.
        </p>
      ) : null}
    </div>
  );
}

export function CommandWord({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono font-semibold text-[#2563eb] decoration-[#2563eb] decoration-dotted underline-offset-4 hover:underline">
      {children}
    </span>
  );
}
