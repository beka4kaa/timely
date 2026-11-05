"use client";

// Меню на карточке: кнопка с тремя точками и окошко в верхнем слое браузера. Верхний
// слой нужен, потому что плашки цели режут всё, что выходит за их края, а соседняя
// карточка привычки легла бы поверх. Клик мимо и Esc закрывают его сами.

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/shell/icons";

const EDGE = 8;
const GAP = 6;

export function CardMenu({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Клик мимо закрывает окно раньше, чем кнопка получит свой: без этого она открыла бы его снова.
  const closedAt = useRef(0);

  const close = useCallback(() => {
    const element = pop.current;
    if (element?.matches(":popover-open")) element.hidePopover();
    else setOpen(false);
    trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const element = pop.current;
    const button = trigger.current;
    if (!open || !element || !button) return;

    const place = () => {
      const anchor = button.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(anchor.right - box.width, window.innerWidth - box.width - EDGE));
      const below = anchor.bottom + GAP;
      const top = below + box.height > window.innerHeight - EDGE ? Math.max(EDGE, anchor.top - GAP - box.height) : below;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    };

    const onBeforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") closedAt.current = performance.now();
    };
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") setOpen(false);
    };
    const hide = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target)) return;
      if (element.matches(":popover-open")) element.hidePopover();
    };

    element.addEventListener("beforetoggle", onBeforeToggle);
    element.addEventListener("toggle", onToggle);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    if (!element.matches(":popover-open")) element.showPopover();
    place();
    // Внутри меню есть подстраницы разной высоты.
    const watcher = new ResizeObserver(place);
    watcher.observe(element);
    element.querySelector<HTMLElement>("button, input")?.focus();

    return () => {
      watcher.disconnect();
      element.removeEventListener("beforetoggle", onBeforeToggle);
      element.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  return (
    <span className={className ? `gm ${className}` : "gm"} onClick={(event) => event.stopPropagation()}>
      <button
        ref={trigger}
        className="gm-btn"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (performance.now() - closedAt.current < 250) return;
          setOpen((value) => !value);
        }}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div ref={pop} {...{ popover: "auto" }} className="gm-pop" aria-label={label}>
          {children(close)}
        </div>
      ) : null}
    </span>
  );
}
