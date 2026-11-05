// Меню «⋯» и действие в два нажатия: общее у полки и страницы курса.

"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { paperPopover } from "./paper";

/**
 * Разрушающие действия живут под «⋯», а не в строке: рядом с главным действием они
 * спорили бы с ним за внимание.
 */
export function OverflowMenu({
  label,
  triggerClassName = "icon-btn",
  children,
}: {
  label: string;
  triggerClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className={triggerClassName}>
          <Icon name="more" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={`${paperPopover} min-w-[188px] max-w-[280px]`}>
        <div className="cur-menu">{children(() => setOpen(false))}</div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Опасное действие в два нажатия.
 *
 * Модального окна нет намеренно: удаляется своё, и второе нажатие ровно там же, где
 * первое, честнее диалога, который закрывают не глядя. Отказ сервера виден на месте,
 * поэтому меню остаётся открытым, пока действие не удалось.
 */
export function ConfirmingAction({
  label,
  confirm,
  onRun,
  onDone,
}: {
  label: string;
  confirm: string;
  onRun: () => Promise<void>;
  onDone?: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onRun();
      onDone?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      className={armed || failed ? "is-danger" : undefined}
      aria-live="polite"
      onClick={() => {
        if (armed) void run();
        else {
          setFailed(false);
          setArmed(true);
        }
      }}
    >
      {busy ? "Секунду…" : failed ? "Не удалось. Ещё раз?" : armed ? confirm : label}
    </button>
  );
}
