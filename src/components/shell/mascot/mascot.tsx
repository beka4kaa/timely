"use client";

// Разметка маскота и связь движка с остальным приложением.

import { useEffect, useRef } from "react";

import { Icon } from "@/components/shell/icons";
import { dashboardViewOf } from "@/config/dashboard-navigation";
import { useDashboardPath } from "@/lib/use-dashboard-path";

import { createMascot, type MascotEngine, type MascotExpression } from "./engine";
import { MascotArt } from "./mascot-art";

let engine: MascotEngine | null = null;
/** Запрос, начатый раньше, чем маскот смонтировался, не должен потеряться молча. */
let pendingThink: { title: string; onStop?: () => void } | null = null;

/**
 * Маскот для всего приложения. Вызывать можно откуда угодно: пока его нет на экране
 * (страницы входа, первый кадр), вызовы просто ничего не делают.
 */
export const mascot = {
  hop: (power?: number, kind?: "quiet") => engine?.hop(power, kind),
  wiggle: () => engine?.wiggle(),
  say: (text?: string) => engine?.say(text),
  thinkStart: (title: string, onStop?: () => void) => {
    if (engine) engine.thinkStart(title, onStop);
    else pendingThink = { title, onStop };
  },
  thought: (text: string) => engine?.thought(text),
  thinkEnd: (ready?: string) => {
    pendingThink = null;
    engine?.thinkEnd(ready);
  },
  remind: (title: string, text: string, go: () => void, options?: { long?: boolean; stay?: boolean }) =>
    engine?.remind(title, text, go, options),
  remindOff: () => engine?.remindOff(),
  hideCard: () => engine?.hideCard(),
  mood: (name: MascotExpression) => engine?.mood(name),
  react: (name: MascotExpression, seconds?: number) => engine?.react(name, seconds),
  focus: (on: boolean) => engine?.focus(on),
};

export function Mascot() {
  const hostRef = useRef<HTMLDivElement>(null);
  const path = useDashboardPath();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const created = createMascot(host);
    engine = created;
    if (pendingThink) {
      created.thinkStart(pendingThink.title, pendingThink.onStop);
      pendingThink = null;
    }
    return () => {
      created.destroy();
      if (engine === created) engine = null;
    };
  }, []);

  useEffect(() => {
    engine?.setView(dashboardViewOf(path));
  }, [path]);

  return (
    <div className="mascot" data-mascot ref={hostRef}>
      <div className="mascot-bubble is-off" role="status">
        <p className="mascot-say" />
        <button className="mascot-ask" type="button" data-quick-open>
          Спросить
        </button>
      </div>
      <div className="m-thoughts" data-state="off">
        <span className="m-dot" aria-hidden="true" />
        <span className="m-dot" aria-hidden="true" />
        <span className="m-dot" aria-hidden="true" />
        <div className="m-card glass">
          <button className="m-card-x" type="button" title="Скрыть" aria-label="Скрыть">
            <Icon name="x" />
          </button>
          <div className="m-card-text">
            <p className="m-card-title">
              <Icon name="check" className="m-card-ok" />
              <span />
            </p>
            <p className="m-card-step" aria-live="polite" />
          </div>
          <button className="m-card-stop" type="button" title="Остановить" aria-label="Остановить">
            <span />
          </button>
          <button className="m-card-go" type="button" title="Открыть" aria-label="Открыть">
            <Icon name="return" />
          </button>
        </div>
      </div>
      <button
        className="mascot-hit"
        type="button"
        aria-label="Маскот Timely, нажми, чтобы попросить о помощи"
      />
      <MascotArt />
    </div>
  );
}
