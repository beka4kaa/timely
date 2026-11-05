"use client";

// Поле вопроса: плавающее стекло в две строки. Сверху текст, снизу слева режим и книга,
// справа отправка.
//
// Черновик живёт здесь, а не у страницы: иначе на каждую букву перерисовывалась бы вся
// переписка. Снаружи поле заполняют через `fill`: вопрос из адреса, подсказка с пустого
// экрана.

import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "@/components/shell/icons";
import { useSmoothInput } from "@/components/shell/smooth-input";

import { CHAT_MODES, type ChatMode, type ChatModeKey } from "./chat-modes";

const MAX_HEIGHT = 200;

export interface ComposerHandle {
  /** Подставить текст в поле и поставить туда курсор. */
  fill: (text: string) => void;
  focus: () => void;
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    onSubmit: (text: string) => void;
    /** Идёт ответ: кнопка отправки становится кнопкой «стоп». */
    busy: boolean;
    /** Отправить пока нельзя: например, ещё открывается разговор. */
    disabled?: boolean;
    placeholder: string;
    onStop: () => void;
    /** Shift+Tab в поле. */
    onCycleMode: () => void;
    /** Левый угол: режим и книга. */
    tools: ReactNode;
  }
>(function Composer({ onSubmit, busy, disabled = false, placeholder, onStop, onCycleMode, tools }, ref) {
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  useSmoothInput(fieldRef);

  // Поле растёт под текст, дальше прокручивается.
  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  useImperativeHandle(
    ref,
    () => ({
      fill: (text) => {
        setDraft(text);
        window.requestAnimationFrame(() => {
          const node = fieldRef.current;
          if (!node) return;
          node.focus();
          node.setSelectionRange(text.length, text.length);
        });
      },
      focus: () => fieldRef.current?.focus(),
    }),
    [],
  );

  const send = () => {
    const question = draft.trim();
    if (!question || busy || disabled) return;
    setDraft("");
    onSubmit(question);
  };

  return (
    <form
      className="composer glass chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <span className="ti-host">
        <textarea
          id="chat-input"
          ref={fieldRef}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label="Сообщение"
          autoComplete="off"
          style={{ maxHeight: MAX_HEIGHT }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Пока идёт набор через IME, Enter выбирает слово, а не отправляет.
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
            if (event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              onCycleMode();
            }
          }}
        />
      </span>
      <div className="cmp-tools">
        {tools}
        {/* Разные узлы, а не один с другим `type`: кнопка, ставшая `submit` прямо во время
            нажатия, отправила бы форму. */}
        {busy ? (
          <button
            key="stop"
            className="send"
            type="button"
            aria-label="Остановить"
            title="Остановить"
            onClick={onStop}
          >
            <span className="q-stop" />
          </button>
        ) : (
          <button
            key="send"
            className="send"
            type="submit"
            aria-label="Отправить"
            disabled={disabled || !draft.trim()}
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </div>
    </form>
  );
});

/** Всплывающий выбор над полем: закрывается мимо и по Escape, стрелки ходят по пунктам. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      wrapRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    // Клавиатурой сразу на текущий пункт: иначе до него пришлось бы идти через Tab.
    const currentItem = wrapRef.current?.querySelector<HTMLElement>(
      '[aria-checked="true"], [aria-pressed="true"]',
    );
    currentItem?.focus({ preventScroll: true });
    currentItem?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onItemsKey = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button, a"),
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  }, []);

  return { open, close, toggle, wrapRef, onItemsKey };
}

export function ModePicker({
  mode,
  onPick,
}: {
  mode: ChatMode;
  onPick: (key: ChatModeKey) => void;
}) {
  const menu = useMenu();
  return (
    <div className="mode-wrap" ref={menu.wrapRef}>
      <button
        className="mode-pick"
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title="Режим, Shift+Tab переключает"
        onClick={menu.toggle}
      >
        <Icon name={mode.icon} />
        <span>{mode.name}</span>
        <Icon name="chev-d" className="chev" />
      </button>
      {menu.open ? (
        <div className="mode-menu" role="menu" aria-label="Режим тьютора" onKeyDown={menu.onItemsKey}>
          {CHAT_MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={item.key === mode.key}
              onClick={() => {
                menu.close();
                onPick(item.key);
              }}
            >
              <Icon name={item.icon} />
              <span>
                <b>{item.name}</b>
                <small>{item.note}</small>
              </span>
              <Icon name="check" className="ok" />
            </button>
          ))}
          <p className="mode-hint">Shift + Tab переключает</p>
        </div>
      ) : null}
    </div>
  );
}

export interface BookOption {
  goalId: string;
  title: string;
  /** Подпись под названием: автор книги или почему отвечать не по чему. */
  note: string;
}

/** Выбор книги: там, где у чат-ботов стоит выбор модели. */
export function BookPicker({
  options,
  selected,
  failed,
  onPick,
}: {
  options: BookOption[];
  selected: string | null;
  /** Список не загрузился: честно говорим об этом в меню. */
  failed: boolean;
  onPick: (goalId: string | null) => void;
}) {
  const menu = useMenu();
  const current = options.find((item) => item.goalId === selected);
  const pick = (goalId: string | null) => {
    menu.close();
    onPick(goalId);
  };

  return (
    <div className="book-wrap" ref={menu.wrapRef}>
      <button
        className="book-pick"
        type="button"
        aria-haspopup="true"
        aria-expanded={menu.open}
        title="По какой книге отвечать. Смена книги начинает новый разговор"
        onClick={menu.toggle}
      >
        {/* Книга есть, а списка нет, если он не загрузился: «без книги» было бы неправдой. */}
        <span>{current?.title ?? (selected ? "Книга" : "Без книги")}</span>
        <Icon name="chev-d" />
      </button>
      {menu.open ? (
        <div className="book-menu" onKeyDown={menu.onItemsKey}>
          <button type="button" aria-pressed={selected === null} onClick={() => pick(null)}>
            Без книги
            <small>Обычный разговор</small>
          </button>
          {options.map((item) => (
            <button
              key={item.goalId}
              type="button"
              aria-pressed={item.goalId === selected}
              onClick={() => pick(item.goalId)}
            >
              {item.title}
              <small>{item.note}</small>
            </button>
          ))}
          {failed ? <p className="book-note">Книги не загрузились</p> : null}
          <Link className="book-add" href="/dashboard/curriculum">
            Добавить книгу
          </Link>
        </div>
      ) : null}
    </div>
  );
}
