"use client";

// Оболочка панели справа: выезд, шапка, лента, поле.
//
// Панель работает в двух режимах — вопросы по книге и помощник по расписанию, —
// и оболочка у них общая. Разъезжается только содержимое: плашка в шапке, лента
// и поле. Копировать эти шестьдесят строк во второй компонент нельзя: здесь
// сидят z-index'ы, `inert` и правила выезда, которые чинились по одному и
// разъехались бы на первой же правке.

import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { PanelRightClose, Plus } from "lucide-react";

import { useAskRail } from "@/contexts/ask-rail";
import { RailResizer } from "./rail-resizer";

export function RailShell({
  mode,
  edgeLabel,
  title,
  onNew,
  newLabel = "Новый чат",
  feedRef,
  children,
  footer,
}: {
  /** Вид панели: просьбу о фокусе забирает только панель своего вида. */
  mode: "book" | "schedule";
  /** Как называть панель вслух: её подпись для скринридера. */
  edgeLabel: string;
  /** Левая часть шапки: выбор предмета или название режима. */
  title: ReactNode;
  /** Начать заново. Без него кнопки в шапке нет. */
  onNew?: () => void;
  newLabel?: string;
  feedRef?: MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { open, toggle, isMobile, width, dragging, focusRequest, consumeFocus } = useAskRail();
  const asideRef = useRef<HTMLElement>(null);

  // Открыли извне — фокус в поле ввода. Панель стоит в разметке после
  // страницы, и без этого с клавиатуры до неё пришлось бы идти через всю
  // страницу, а на телефоне фокус остался бы на кнопке под панелью.
  //
  // Поле может появиться не сразу: помощник по расписанию рисует его, только
  // когда страница сообщит расписание. Поэтому ждём его до пары секунд, а
  // потом просьбу снимаем — чтобы она не украла фокус через минуту.
  useEffect(() => {
    if (!open || !focusRequest) return;
    if (focusRequest.target !== "any" && focusRequest.target !== mode) return;
    const { id } = focusRequest;
    if (Date.now() - id > 5000) {
      consumeFocus(id);
      return;
    }
    let frame = 0;
    const attempt = () => {
      const field = asideRef.current?.querySelector<HTMLElement>(
        "textarea:not([disabled]), input:not([type=hidden]):not([disabled])",
      );
      if (field) {
        field.focus();
        consumeFocus(id);
        return;
      }
      if (Date.now() - id > 2500) {
        consumeFocus(id);
        return;
      }
      frame = window.requestAnimationFrame(attempt);
    };
    frame = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(frame);
  }, [open, focusRequest, mode, consumeFocus]);

  // На телефоне панель — лист поверх всего экрана: Escape его закрывает.
  useEffect(() => {
    if (!open || !isMobile) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, isMobile, toggle]);

  return (
    <>
      {/* Закладки у края больше нет: панель открывает «Спросить» в рейле
          слева и в нижней панели телефона. Безымянная стрелка 20×56 у правого
          края на телефоне закрывала колонку оценок, а на компьютере ничего не
          говорила о том, что за ней спрятано. */}

      {/* ── Затемнение на узком экране ──────────────────────────────────── */}
      {isMobile && open && (
        <div
          className="fixed inset-0 top-14 z-[110] bg-black/40 backdrop-blur-sm"
          onClick={toggle}
        />
      )}

      {/* ── Панель ──────────────────────────────────────────────────────── */}
      <aside
        ref={asideRef}
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile && open ? true : undefined}
        style={{ width: isMobile ? "100%" : width || undefined }}
        className={`fixed bottom-0 right-0 top-14 z-[115] border-l border-tm-line ${
          dragging ? "" : "transition-transform duration-300 ease-in-out"
        } ${
          // Тень слева: лист, приподнятый над страницей, а не приклеенный к
          // ней встык. Закрытой она не нужна — панель за краем экрана.
          open
            ? "translate-x-0 shadow-[-18px_0_40px_-24px_rgba(67,57,45,0.25)]"
            : "translate-x-full"
        }`}
        aria-label={edgeLabel}
        aria-hidden={!open}
        // Панель уезжает трансформацией и остаётся в DOM. Без этого её поле
        // ввода ловило бы фокус по Tab со страницы, где панели не видно.
        //
        // Атрибут именно ОТСУТСТВУЕТ, когда панель открыта: `inert` булев по
        // спецификации, и `inert="false"` браузер считает включённым.
        inert={open ? undefined : true}
      >
        {open && !isMobile && <RailResizer />}
        <div className="flex h-full min-h-0 flex-col bg-tm-bg text-tm-ink">
          <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-tm-line bg-tm-surface px-3.5">
            {title}
            <div className="flex items-center gap-0.5 text-tm-faint">
              {onNew ? (
                <button
                  type="button"
                  onClick={onNew}
                  aria-label={newLabel}
                  title={newLabel}
                  className="grid h-7 w-7 place-items-center rounded-full text-tm-faint outline-none transition-colors hover:bg-tm-surface-2 hover:text-tm-ink active:scale-95 focus-visible:ring-2 focus-visible:ring-tm-accent/30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={toggle}
                aria-label="Свернуть панель"
                title="Свернуть панель"
                className="grid h-7 w-7 place-items-center rounded-full text-tm-faint outline-none transition-colors hover:bg-tm-surface-2 hover:text-tm-ink active:scale-95 focus-visible:ring-2 focus-visible:ring-tm-accent/30"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          <div
            ref={feedRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          >
            {children}
          </div>

          <div
            className="shrink-0 px-3 pt-2"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            {footer}
          </div>
        </div>
      </aside>
    </>
  );
}

/** Плашка в шапке — общий вид для обоих режимов. */
export const railPillClass =
  "flex min-w-0 flex-1 items-center gap-1 rounded-full border border-tm-line bg-tm-surface-2 px-2.5 py-[3px] text-[11px] font-medium text-tm-muted outline-none transition-colors";

/** То же, но кликабельное: с подсветкой при наведении. */
export const railPillButtonClass = `${railPillClass} hover:border-tm-line-strong hover:text-tm-ink focus-visible:ring-2 focus-visible:ring-tm-accent/30`;
