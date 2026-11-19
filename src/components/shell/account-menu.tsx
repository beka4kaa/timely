"use client";

// Меню аккаунта: нажатие на имя внизу левой панели открывает над ним короткий список.
// Закрывается мимо и по Escape, стрелки ходят по пунктам. «Друзья» пока только пункт:
// страницы ещё нет, и он честно помечен «скоро».

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { openSettings } from "@/stores/settings-dialog";

export function AccountMenu({
  initials,
  name,
  current,
}: {
  initials: string;
  name: string;
  /** Открыт профиль или настройки: имя подсвечено, как пункт меню. */
  current: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      wrapRef.current?.querySelector<HTMLElement>(".me")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onItemsKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a, button:not(:disabled)"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="me-wrap" ref={wrapRef}>
      <button
        className="me"
        type="button"
        title={t("Профиль и настройки")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-current={current || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="me-name">{name}</span>
      </button>
      {open ? (
        <div className="menu me-menu" role="menu" aria-label={t("Аккаунт")} onKeyDown={onItemsKey}>
          <Link className="menu-item" href="/dashboard/profile" role="menuitem" onClick={close}>
            <Icon name="user" />
            {t("Профиль")}
          </Link>
          <button
            className="menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              openSettings("profile");
            }}
          >
            <Icon name="gear" />
            {t("Настройки")}
          </button>
          <button className="menu-item" type="button" role="menuitem" disabled aria-disabled="true">
            <Icon name="users" />
            {t("Друзья")}
            <small className="menu-note">{t("скоро")}</small>
          </button>
          <hr className="menu-sep" />
          <button
            className="menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void signOut({ callbackUrl: "/auth/signin" });
            }}
          >
            <Icon name="logout" />
            {t("Выйти")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
