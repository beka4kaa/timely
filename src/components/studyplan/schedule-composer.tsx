"use client";

// Поле помощника по расписанию в мини-окне: та же разметка, что у быстрого запроса, плюс
// меню команд. Обычное сообщение готовит изменение, совет остаётся за `/advice`.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/shell/icons";
import { QuickChips, QuickTools } from "@/components/shell/quick/quick-composer";
import { useQuick, withAttached } from "@/components/shell/quick/quick-context";
import { useSmoothInput } from "@/components/shell/smooth-input";

import {
  DEFAULT_SCHEDULE_MODE,
  matchingScheduleCommands,
  moveCommandSelection,
  resolveScheduleSubmission,
  slashQuery,
  type ScheduleAssistantMode,
  type ScheduleCommand,
} from "./schedule-commands";

const MAX_HEIGHT = 160;

const SUGGESTIONS = [
  "Сегодня освобожусь в семь",
  "Перенеси физику на завтра",
  "Сделай занятия короче",
  "Добавь подготовку к контрольной",
];

/** Когда указано занятие, подсказки про него. */
const ATTACHED_SUGGESTIONS = ["Перенеси на завтра", "Сделай короче"];

export function ScheduleComposer({
  hasSchedule,
  busy = false,
  disabled = false,
  showSuggestions = false,
  resetKey = 0,
  focusKey = 0,
  initialDraft,
  onSubmit,
  onStart,
  onStop,
}: {
  hasSchedule: boolean;
  busy?: boolean;
  disabled?: boolean;
  showSuggestions?: boolean;
  resetKey?: number;
  /** Меняется, когда фокус должен вернуться в поле. */
  focusKey?: number;
  /** Текст, подставленный в поле извне. */
  initialDraft?: { text: string; nonce: number } | null;
  onSubmit: (text: string, mode: ScheduleAssistantMode) => void;
  onStart: () => void;
  onStop?: () => void;
}) {
  const { attached, clearAttached, listening, heard, suggestSlot } = useQuick();
  const [draft, setDraft] = useState("");
  const [adviceArmed, setAdviceArmed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [error, setError] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const menuId = useId();
  useSmoothInput(fieldRef);

  const query = slashQuery(draft);
  const matches = useMemo(() => matchingScheduleCommands(draft), [draft]);
  const menuOpen = query !== null && !menuDismissed && !busy && !disabled;
  const selected = activeIndex >= 0 ? matches[activeIndex] : undefined;

  const fit = useCallback(() => {
    const node = fieldRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, []);
  useEffect(fit, [draft, fit]);

  const focusField = useCallback(() => {
    window.requestAnimationFrame(() => fieldRef.current?.focus());
  }, []);

  useEffect(() => {
    setActiveIndex(matches.length ? 0 : -1);
  }, [draft, matches]);

  useEffect(() => {
    setDraft("");
    setAdviceArmed(false);
    setMenuDismissed(false);
    setError("");
  }, [hasSchedule, resetKey]);

  useEffect(() => {
    if (focusKey > 0) focusField();
  }, [focusField, focusKey]);

  // Пока выбирается другое расписание, поле выключено, а выключенное теряет фокус. Вернуть
  // его надо, только если он был здесь: чужую кнопку дёргать незачем.
  const hadFocus = useRef(false);
  const wasDisabled = useRef(disabled);
  useEffect(() => {
    if (wasDisabled.current && !disabled && hadFocus.current) focusField();
    wasDisabled.current = disabled;
  }, [disabled, focusField]);

  useEffect(() => {
    if (!initialDraft?.text) return;
    setDraft(initialDraft.text);
    focusField();
  }, [focusField, initialDraft]);

  const execute = useCallback(
    (value: string) => {
      if (busy || disabled) return;
      const mode = adviceArmed ? "advice" : DEFAULT_SCHEDULE_MODE;
      const result = resolveScheduleSubmission(value, mode);
      if (result.kind === "empty") return;
      if (result.kind === "error") {
        setError(result.message);
        return;
      }

      setError("");
      setMenuDismissed(false);
      setDraft("");
      if (result.kind === "start") {
        setAdviceArmed(false);
        onStart();
        return;
      }
      if (result.kind === "arm_plan" || result.kind === "arm_advice") {
        setAdviceArmed(result.kind === "arm_advice");
        focusField();
        return;
      }

      // `/advice` одноразовый: следующее сообщение снова готовит изменение.
      setAdviceArmed(false);
      onSubmit(withAttached(result.message, attached), result.mode);
      clearAttached();
    },
    [adviceArmed, attached, busy, clearAttached, disabled, focusField, onStart, onSubmit],
  );

  const chooseCommand = (item: ScheduleCommand) => execute(item.command);

  const handled = useRef(0);
  useEffect(() => {
    if (!heard || heard.id === handled.current) return;
    handled.current = heard.id;
    setDraft(heard.text);
    if (heard.final && heard.text) execute(heard.text);
  }, [execute, heard]);

  const suggestions = attached.length ? ATTACHED_SUGGESTIONS : SUGGESTIONS;
  const showSuggest = showSuggestions && hasSchedule && !draft.trim() && !busy && !disabled && !listening;

  let placeholder = "Что поменять?";
  if (!hasSchedule) placeholder = "Что поставить в план?";
  if (adviceArmed) placeholder = "О чём совет?";
  if (listening) placeholder = "Слушаю…";

  return (
    <>
      {suggestSlot && showSuggest
        ? createPortal(
            suggestions.map((text, index) => (
              <button
                key={text}
                className="q-sug"
                type="button"
                style={{ animationDelay: `${index * 36}ms` }}
                onClick={() => execute(text)}
              >
                {text}
              </button>
            )),
            suggestSlot,
          )
        : null}

      {menuOpen ? (
        <div id={menuId} className="ps-cmds" role="listbox" aria-label="Команды помощника">
          {matches.length ? (
            matches.map((item, index) => (
              <button
                key={item.id}
                id={`${menuId}-${item.id}`}
                className="ps-cmd"
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseCommand(item)}
              >
                <b>{item.command}</b>
                <span>{item.description}</span>
              </button>
            ))
          ) : (
            <p className="q-cite">Такой команды нет. Есть /start, /plan и /advice.</p>
          )}
        </div>
      ) : null}

      <QuickChips />
      {adviceArmed ? (
        <div className="q-chips">
          <span className="q-chip">
            <span>Только совет, без изменений</span>
            <button
              type="button"
              aria-label="Обычный режим: подготовить изменение"
              onClick={() => {
                setAdviceArmed(false);
                focusField();
              }}
            >
              <Icon name="x" />
            </button>
          </span>
        </div>
      ) : null}

      <form
        className="q-form"
        onSubmit={(event) => {
          event.preventDefault();
          execute(draft);
        }}
      >
        <span className="ti-host">
          <textarea
            ref={fieldRef}
            className="q-input"
            role="combobox"
            rows={1}
            value={draft}
            disabled={disabled}
            placeholder={placeholder}
            aria-label="Что поменять в плане"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-activedescendant={menuOpen && selected ? `${menuId}-${selected.id}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            style={{ maxHeight: MAX_HEIGHT }}
            onFocus={() => {
              hadFocus.current = true;
            }}
            onBlur={(event) => {
              // Выключение поля тоже снимает фокус, и это не уход с поля.
              if (!event.currentTarget.disabled) hadFocus.current = false;
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setMenuDismissed(false);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                const direction = event.key as "ArrowDown" | "ArrowUp";
                setActiveIndex((current) => moveCommandSelection(current, direction, matches.length));
                return;
              }
              if (menuOpen && event.key === "Escape") {
                // Сначала закрывается меню, а не всё окно.
                event.preventDefault();
                event.stopPropagation();
                event.nativeEvent.stopImmediatePropagation();
                setMenuDismissed(true);
                return;
              }
              if (menuOpen && selected && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
                event.preventDefault();
                chooseCommand(selected);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                execute(draft);
              }
            }}
          />
        </span>
      </form>

      {error ? (
        <p className="q-cite" role="alert">
          {error}
        </p>
      ) : null}

      <div className="q-tools">
        {!hasSchedule ? (
          <button className="q-tool" type="button" disabled={disabled} onClick={onStart}>
            <Icon name="plan" />
            <span>Настроить расписание</span>
          </button>
        ) : null}
        <QuickTools />
        <span className="q-hint">Esc, чтобы закрыть</span>
        {busy && onStop ? (
          <button className="send q-send" type="button" aria-label="Остановить" title="Остановить" onClick={onStop}>
            <span className="q-stop" />
          </button>
        ) : (
          <button
            className="send q-send"
            type="button"
            aria-label="Отправить"
            disabled={busy || disabled || !draft.trim()}
            onClick={() => execute(draft)}
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </div>
    </>
  );
}
