"use client";

// Окно настроек поверх любой страницы кабинета: затемнение, разделы слева.
// Escape и клик по затемнению закрывают его, фокус возвращается туда, откуда открыли.

import { useEffect, useRef } from "react";

import { useSettingsDialog } from "@/stores/settings-dialog";

import { SettingsPanel } from "./settings-panel";

export function SettingsDialog() {
  const { open, section, hide, pick } = useSettingsDialog();
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="st-modal"
      aria-label="Настройки"
      onClose={() => {
        hide();
        returnTo.current?.focus?.();
      }}
      onClick={(event) => {
        // Клик по затемнению: само окно лежит внутри, а затемнение — это сам dialog.
        if (event.target === event.currentTarget) hide();
      }}
    >
      {open ? <SettingsPanel section={section} onPick={pick} onClose={hide} /> : null}
    </dialog>
  );
}
