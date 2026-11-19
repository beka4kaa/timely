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
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { Icon } from "@/components/shell/icons";
import { useSmoothInput } from "@/components/shell/smooth-input";
import { BOOKS_ENABLED } from "@/config/features";
import { chatContextHint } from "@/lib/curriculum-books";
import { ASK_LEVELS, gaugeAngle, type AskLevel } from "@/lib/ask-level";
import { withHeard } from "@/lib/dictation";
import { t } from "@/lib/i18n";

import { CHAT_MODES, type ChatMode, type ChatModeKey } from "./chat-modes";
import { contextPercent, contextUsed, countLabel, shortCount, type AskUsage } from "./chat-usage";
import { useDictation } from "./use-dictation";

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
    /** Справа в строке инструментов, перед отправкой. */
    status?: ReactNode;
  }
>(function Composer({ onSubmit, busy, disabled = false, placeholder, onStop, onCycleMode, tools, status }, ref) {
  const [draft, setDraft] = useState("");
  // На телефоне, пока в поле не пишут, оно сжато в одну строку; нажатие раскрывает его
  // вместе с режимом и переключателем Instant / Medium / High. На компьютере всегда раскрыто.
  const [active, setActive] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  // Голосовой ввод дописывает сказанное к тому, что было набрано до нажатия.
  const spokenFrom = useRef("");
  const dictation = useDictation((text) => setDraft(withHeard(spokenFrom.current, text)));
  const compact = !active && !draft && !dictation.listening;
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
      data-compact={compact || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        // Фокус ушёл на кнопку или меню внутри поля — оно остаётся раскрытым.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
      }}
      onClick={(event) => {
        // Сжатое поле целиком — одна кнопка: нажатие мимо текста всё равно ставит курсор.
        if (compact && event.target === event.currentTarget) fieldRef.current?.focus();
      }}
    >
      <span className="ti-host">
        <textarea
          id="chat-input"
          ref={fieldRef}
          rows={1}
          value={draft}
          placeholder={dictation.listening ? t("Слушаю…") : placeholder}
          aria-label={t("Сообщение")}
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
        {status}
        {/* Микрофон отдельной кнопкой: браузер слушает фразу и дописывает её в поле */}
        {dictation.supported ? (
          <button
            className="mic-btn"
            type="button"
            aria-label={dictation.listening ? t("Хватит слушать") : t("Сказать голосом")}
            aria-pressed={dictation.listening}
            title={dictation.listening ? t("Хватит слушать") : t("Сказать голосом")}
            disabled={disabled}
            onClick={() => {
              if (dictation.listening) {
                dictation.stop();
                return;
              }
              spokenFrom.current = draft;
              dictation.start();
            }}
          >
            <Icon name="mic" />
          </button>
        ) : null}
        {/* Круг цвета акцента со стрелкой; во время ответа — стоп. Разные узлы, а не один
            с другим `type`: кнопка, ставшая `submit` прямо во время нажатия, отправила бы форму. */}
        {busy ? (
          <button
            key="stop"
            className="send"
            type="button"
            aria-label={t("Остановить")}
            title={t("Остановить")}
            onClick={onStop}
          >
            <span className="q-stop" />
          </button>
        ) : (
          <button
            key="send"
            className="send"
            type="submit"
            aria-label={t("Отправить")}
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
  // Под списком одна строка пояснения: к режиму под пальцем или курсором, иначе к текущему.
  const [hovered, setHovered] = useState<ChatModeKey | null>(null);
  const noted = CHAT_MODES.find((item) => item.key === (hovered ?? mode.key)) ?? mode;
  return (
    <div className="mode-wrap" ref={menu.wrapRef}>
      <button
        className="mode-pick"
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={t("Режим: {name}", { name: t(mode.name) })}
        title={t("Режим, Shift+Tab переключает")}
        onClick={menu.toggle}
      >
        <Icon name={mode.icon} />
        <span>{t(mode.name)}</span>
        <Icon name="chev-d" className="chev" />
      </button>
      {menu.open ? (
        <div
          className="menu mode-menu"
          role="menu"
          aria-label={t("Режим тьютора")}
          onKeyDown={menu.onItemsKey}
          onPointerLeave={() => setHovered(null)}
        >
          {CHAT_MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitemradio"
              aria-checked={item.key === mode.key}
              aria-label={`${t(item.name)}. ${t(item.note)}`}
              onPointerEnter={() => setHovered(item.key)}
              onFocus={() => setHovered(item.key)}
              onClick={() => {
                menu.close();
                onPick(item.key);
              }}
            >
              <Icon name={item.icon} />
              <b>{t(item.name)}</b>
              <Icon name="check" className="ok" />
            </button>
          ))}
          <p className="mode-note" aria-hidden="true">{t(noted.note)}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Насколько глубоко думать: Instant, Medium или High. Один переключатель вместо выбора модели
 * и рассуждения (что за ними стоит — в lib/ask-level). Подложка выбранного положения едет.
 */
export function LevelToggle({ level, onPick }: { level: AskLevel; onPick: (level: AskLevel) => void }) {
  const index = Math.max(0, ASK_LEVELS.findIndex((row) => row.key === level));
  const move = (step: number) => {
    const next = ASK_LEVELS[(index + step + ASK_LEVELS.length) % ASK_LEVELS.length];
    onPick(next.key);
  };
  return (
    <div
      className="lvl"
      role="radiogroup"
      aria-label={t("Насколько глубоко думать")}
      style={{ "--i": index } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        move(event.key === "ArrowRight" ? 1 : -1);
        const group = event.currentTarget;
        window.requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      }}
    >
      {ASK_LEVELS.map((row) => (
        <button
          key={row.key}
          type="button"
          role="radio"
          aria-checked={row.key === level}
          tabIndex={row.key === level ? 0 : -1}
          title={t(row.note)}
          onClick={() => onPick(row.key)}
        >
          {row.name}
        </button>
      ))}
    </div>
  );
}

/** Спидометр: стрелка показывает, насколько глубоко думает тьютор. */
function Gauge({ level }: { level: AskLevel }) {
  return (
    <svg className="gauge" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.64 17.25A8.5 8.5 0 1 1 19.36 17.25" />
      <path className="gauge-needle" d="M12 13V7.2" style={{ transform: `rotate(${gaugeAngle(level)}deg)` }} />
      <circle cx="12" cy="13" r="1.7" />
    </svg>
  );
}

/**
 * Кнопка-спидометр цвета акцента; нажатие открывает над полем переключатель Instant /
 * Medium / High. Окошко остаётся открытым, пока не нажмёшь мимо или Escape.
 */
export function LevelPicker({ level, onPick }: { level: AskLevel; onPick: (level: AskLevel) => void }) {
  const menu = useMenu();
  const current = ASK_LEVELS.find((row) => row.key === level) ?? ASK_LEVELS[1];
  return (
    <div className="mode-wrap lvl-wrap" ref={menu.wrapRef}>
      <button
        className="gauge-btn"
        type="button"
        aria-haspopup="true"
        aria-expanded={menu.open}
        aria-label={t("Насколько глубоко думать: {name}", { name: current.name })}
        title={current.name}
        onClick={menu.toggle}
      >
        <Gauge level={level} />
      </button>
      {menu.open ? (
        <div className="menu lvl-menu">
          {/* Окошко не закрывается после выбора: можно сразу передумать. Закрывает нажатие мимо. */}
          <LevelToggle level={level} onPick={onPick} />
        </div>
      ) : null}
    </div>
  );
}

/** Сколько контекстного окна занял разговор. */
export function ContextMeter({ usage }: { usage: AskUsage }) {
  const used = contextUsed(usage);
  const percent = contextPercent(usage);
  return (
    <span
      className="ctx"
      title={t("Контекст: {used} из {total} токенов. В него идут {hint}.", {
        used: countLabel(used),
        total: countLabel(usage.context_window),
        hint: chatContextHint(BOOKS_ENABLED),
      })}
    >
      {/* Заметная точка даже на доле процента: ноль выглядел бы как поломка. */}
      <span className="ring xs" style={{ "--p": Math.max(percent, 4) } as CSSProperties} aria-hidden="true">
        <span className="ring-arc" />
      </span>
      <span className="ctx-text">
        {t("{used} из {total}", { used: shortCount(used), total: shortCount(usage.context_window) })}
      </span>
    </span>
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
        title={t("По какой книге отвечать. Смена книги начинает новый разговор")}
        onClick={menu.toggle}
      >
        {/* Книга есть, а списка нет, если он не загрузился: «без книги» было бы неправдой. */}
        <span>{current?.title ?? (selected ? t("Книга") : t("Без книги"))}</span>
        <Icon name="chev-d" />
      </button>
      {menu.open ? (
        <div className="menu book-menu" onKeyDown={menu.onItemsKey}>
          <button type="button" aria-pressed={selected === null} onClick={() => pick(null)}>
            {t("Без книги")}
            <small>{t("Обычный разговор")}</small>
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
          {failed ? <p className="book-note">{t("Книги не загрузились")}</p> : null}
          {BOOKS_ENABLED ? (
            <Link className="book-add" href="/dashboard/curriculum">
              {t("Добавить книгу")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
