"use client";

// Мини-окно внизу: быстрый запрос, ответ и дело.
//
// Закрытое оно капсула с двумя кнопками: написать и сказать голосом. Открытое стоит на
// том же месте, поэтому страница под ним не двигается. Режимов два, вопросы по книге и
// помощник по плану, а оболочка у них общая: здесь клавиши, фокус и правила закрытия.

import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";

import { Icon } from "@/components/shell/icons";
import { useQuick } from "@/components/shell/quick/quick-context";
import { useAskRail } from "@/contexts/ask-rail";

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
  /** Вид окна: просьбу о фокусе забирает только окно своего вида. */
  mode: "book" | "schedule";
  /** Как называть окно вслух: подпись для скринридера. */
  edgeLabel: string;
  /** Верхняя строка окна, например выбор расписания. */
  title?: ReactNode;
  /** Начать заново. Без него кнопки нет. */
  onNew?: () => void;
  newLabel?: string;
  feedRef?: MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { open, toggle, openRail, focusRequest, consumeFocus } = useAskRail();
  const quick = useQuick();
  const hostRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const state = quick.picking ? "picking" : open ? "open" : "closed";

  // Открыли извне: фокус в поле ввода. Поле может появиться не сразу (помощник по плану
  // рисует его, когда страница сообщит расписание), поэтому ждём его до двух с половиной
  // секунд, потом просьбу снимаем, чтобы она не украла фокус через минуту.
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
      const field = winRef.current?.querySelector<HTMLElement>(
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

  // Вернулись из указания курсором: снова в поле, там уже чип.
  const wasPicking = useRef(false);
  useEffect(() => {
    if (wasPicking.current && !quick.picking) {
      winRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    }
    wasPicking.current = quick.picking;
  }, [quick.picking]);

  const { picking, stopPick, attached, clearAttached } = quick;
  useEffect(() => {
    if (!open && attached.length) clearAttached();
  }, [open, attached.length, clearAttached]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (picking) stopPick();
        else if (open) toggle();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = /INPUT|TEXTAREA|SELECT/.test(target?.tagName ?? "") || Boolean(target?.isContentEditable);
      if (open || picking) return;
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        openRail();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, picking, toggle, openRail, stopPick]);

  // Нажатие мимо закрывает пустое окно. Если там текст или ответ, ничего не теряем.
  // Нажатия на слайма и его плашку окно не закрывают. Путь события, а не closest: кнопка
  // ответа к этому моменту уже могла исчезнуть из окна.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-quick-open]")) {
        if (!open) openRail();
        return;
      }
      if (!open || !hostRef.current || event.composedPath().includes(hostRef.current)) return;
      if (target instanceof Element && target.closest(".mascot, [data-radix-popper-content-wrapper]")) return;
      const field = winRef.current?.querySelector<HTMLTextAreaElement>("textarea");
      const hasAnswer = Boolean(feedRef?.current?.childElementCount);
      if (!field?.value.trim() && !hasAnswer && !attached.length) toggle();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open, openRail, toggle, attached.length, feedRef]);

  // Широко: окно ужимается, и справа хватает места слайму с плашкой. Узко: слайм садится
  // на верхний край окна, над его правым концом.
  useEffect(() => {
    const host = hostRef.current;
    const slime = document.querySelector<HTMLElement>("[data-mascot]");
    if (!host || !slime) return;
    const narrow = window.matchMedia("(max-width: 1079px)");
    const perch = () => {
      const win = winRef.current;
      if (state !== "open" || !narrow.matches || !win) {
        slime.style.removeProperty("bottom");
        slime.style.removeProperty("right");
        return;
      }
      const stack = host.getBoundingClientRect();
      const box = win.getBoundingClientRect();
      const width = slime.offsetWidth;
      // По бокам рисунка запас в шестую часть ширины, земля на 196 из 220.
      slime.style.right = `${Math.round(window.innerWidth - box.right + 14 - width / 6)}px`;
      slime.style.bottom = `${Math.round(window.innerHeight - stack.top - slime.offsetHeight * (24 / 220))}px`;
    };
    perch();
    const observer = new ResizeObserver(perch);
    observer.observe(host);
    window.addEventListener("resize", perch);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", perch);
      slime.style.removeProperty("bottom");
      slime.style.removeProperty("right");
    };
  }, [state]);

  return (
    <div className={`quick${quick.listening ? " listening" : ""}`} data-state={state} ref={hostRef}>
      <div className="q-suggest" aria-label="Подсказки" ref={quick.setSuggestSlot} />
      <div className="q-win glass" role="dialog" aria-label={edgeLabel} ref={winRef}>
        {title || onNew ? (
          <div className="q-top">
            {title}
            {onNew ? (
              <button className="q-tool q-new" type="button" title={newLabel} onClick={onNew}>
                <Icon name="plus" />
                <span>{newLabel}</span>
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="q-answer" ref={feedRef} aria-live="polite">
          {children}
        </div>
        {footer}
        <button className="q-close" type="button" aria-label="Закрыть" title="Закрыть" onClick={toggle}>
          <Icon name="x" />
        </button>
      </div>
      <div className="q-pickbar glass">
        <Icon name="cursor" />
        <span>Нажми на урок</span>
        <button className="btn btn-text q-pick-cancel" type="button" onClick={quick.stopPick}>
          Отмена
        </button>
      </div>
      <div className="q-pill glass">
        <button className="q-pill-btn q-open" type="button" title="Быстрый запрос" aria-label="Быстрый запрос" onClick={openRail}>
          <Icon name="compose" />
        </button>
        {quick.voiceSupported ? (
          <>
            <span className="q-div" aria-hidden="true" />
            <button
              className="q-pill-btn q-voice"
              type="button"
              title="Сказать голосом"
              aria-label="Сказать голосом"
              onClick={() => {
                openRail();
                quick.listen();
              }}
            >
              <Icon name="wave" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
