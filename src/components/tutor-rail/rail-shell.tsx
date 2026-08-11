"use client";

// Оболочка панели справа: закладка, выезд, шапка, лента, поле.
//
// Панель работает в двух режимах — вопросы по книге и помощник по расписанию, —
// и оболочка у них общая. Разъезжается только содержимое: плашка в шапке, лента
// и поле. Копировать эти шестьдесят строк во второй компонент нельзя: здесь
// сидят z-index'ы, `inert` и правила выезда, которые чинились по одному и
// разъехались бы на первой же правке.

import type { MutableRefObject, ReactNode } from "react";
import { PanelRightClose, Plus } from "lucide-react";

import { useAskRail } from "@/contexts/ask-rail";
import { EdgeTab } from "./edge-tab";
import { RailResizer } from "./rail-resizer";

export function RailShell({
  edgeLabel,
  title,
  onNew,
  newLabel = "Новый чат",
  feedRef,
  children,
  footer,
}: {
  /** Подпись закладки у свёрнутой панели. Называет, что за разговор внутри. */
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
  const { open, toggle, isMobile, width, dragging } = useAskRail();

  return (
    <>
      {/* ── Закладка ────────────────────────────────────────────────────── */}
      {/* Только открывает. Свернуть можно из шапки, рядом с «Новым чатом»:
          две кнопки одного назначения в разных углах экрана — это лишний
          поиск глазами.

          Стоит по центру правого края — там же, где у открытой панели засечка
          сгиба, и уезжает за край ровно тем движением, каким панель выезжает
          из-за него. */}
      <EdgeTab
        side="right"
        hidden={open}
        label={edgeLabel}
        onClick={toggle}
        // Половина шапки: панель начинается под ней, и без сдвига закладка
        // встала бы выше засечки сгиба, в которую превращается.
        offsetY={24}
        // Выше страницы (`z-[95]`), но ниже самой панели (`z-[115]`): уезжая,
        // закладка должна скрыться ЗА её кромкой, а не поверх неё.
        className="z-[110]"
      />

      {/* ── Затемнение на узком экране ──────────────────────────────────── */}
      {isMobile && open && (
        <div
          className="fixed inset-0 top-12 z-[110] bg-black/40 backdrop-blur-sm"
          onClick={toggle}
        />
      )}

      {/* ── Панель ──────────────────────────────────────────────────────── */}
      <aside
        style={{ width: isMobile ? "100%" : width || undefined }}
        className={`fixed bottom-0 right-0 top-12 z-[115] border-l border-[#dedbd4] ${
          dragging ? "" : "transition-transform duration-300 ease-in-out"
        } ${
          // Тень слева: лист, приподнятый над страницей, а не приклеенный к
          // ней встык. Закрытой она не нужна — панель за краем экрана.
          open
            ? "translate-x-0 shadow-[-18px_0_40px_-24px_rgba(67,57,45,0.25)]"
            : "translate-x-full"
        }`}
        aria-hidden={!open}
        // Панель уезжает трансформацией и остаётся в DOM. Без этого её поле
        // ввода ловило бы фокус по Tab со страницы, где панели не видно.
        //
        // Атрибут именно ОТСУТСТВУЕТ, когда панель открыта: `inert` булев по
        // спецификации, и `inert="false"` браузер считает включённым.
        inert={open ? undefined : true}
      >
        {open && !isMobile && <RailResizer />}
        <div className="flex h-full min-h-0 flex-col bg-[#f8f6f2] text-[#37322c]">
          <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-[#dedbd4] bg-[#fbfaf7] px-3.5">
            {title}
            <div className="flex items-center gap-0.5 text-[#918b82]">
              {onNew ? (
                <button
                  type="button"
                  onClick={onNew}
                  aria-label={newLabel}
                  title={newLabel}
                  className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={toggle}
                aria-label="Свернуть панель"
                title="Свернуть панель"
                className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
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
  "flex min-w-0 flex-1 items-center gap-1 rounded-full border border-[#e0dcd4] bg-[#f4f1ea] px-2.5 py-[3px] text-[11px] font-medium text-[#6d665d] outline-none transition-colors";

/** То же, но кликабельное: с подсветкой при наведении. */
export const railPillButtonClass = `${railPillClass} hover:border-[#d3cdc2] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30`;
