"use client";

// Разметка маскота и связь движка с остальным приложением.

import { useEffect, useRef } from "react";

import { Icon } from "@/components/shell/icons";
import { dashboardViewOf } from "@/config/dashboard-navigation";
import { useDashboardPath } from "@/lib/use-dashboard-path";

import { createMascot, type MascotEngine, type MascotExpression } from "./engine";

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
  remind: (title: string, text: string, go: () => void) => engine?.remind(title, text, go),
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
      <svg className="mascot-art" viewBox="0 0 240 220" aria-hidden="true">
        <defs>
          <clipPath id="m-clip">
            <path data-m="clip" />
          </clipPath>
          <linearGradient id="m-lit" x1="0.18" y1="0" x2="0.72" y2="1">
            <stop className="m-lit-a" offset="0" />
            <stop className="m-lit-b" offset="0.42" />
            <stop className="m-lit-c" offset="1" />
          </linearGradient>
          <radialGradient id="m-aura" cx="0.5" cy="0.5" r="0.5">
            <stop className="m-aura-a" offset="0" />
            <stop className="m-aura-b" offset="1" />
          </radialGradient>
          <radialGradient id="m-floor" cx="0.5" cy="0.5" r="0.5">
            <stop className="m-floor-a" offset="0" />
            <stop className="m-floor-b" offset="1" />
          </radialGradient>
        </defs>
        <ellipse className="m-aura" data-m="aura" cx="120" cy="140" rx="112" ry="84" fill="url(#m-aura)" />
        <ellipse className="m-floor" data-m="floor" cx="120" cy="198" rx="74" ry="9" fill="url(#m-floor)" />
        <g data-m="all">
          <path className="m-body" data-m="body" />
          <g clipPath="url(#m-clip)">
            <path className="m-lit" data-m="lit" fill="url(#m-lit)" />
            <path className="m-core" data-m="core" />
            <path className="m-rim" data-m="rim" />
            <g className="m-gloss" data-m="gloss">
              <ellipse cx="-40" cy="-84" rx="17" ry="8.8" transform="rotate(-28 -40 -84)" />
              <ellipse cx="-12" cy="-99" rx="4.6" ry="3" transform="rotate(-8 -12 -99)" />
            </g>
          </g>
          <g data-m="face">
            <g className="m-blush" data-m="blush">
              <g transform="translate(-56 14)">
                <ellipse className="m-blush-fill" rx="10.5" ry="6.4" />
                <path className="m-blush-hatch" d="M-5.5 3.2 -2.6 -3.2M-1.4 3.2 1.4 -3.2M2.6 3.2 5.5 -3.2" />
              </g>
              <g transform="translate(56 14)">
                <ellipse className="m-blush-fill" rx="10.5" ry="6.4" />
                <path className="m-blush-hatch" d="M-5.5 3.2 -2.6 -3.2M-1.4 3.2 1.4 -3.2M2.6 3.2 5.5 -3.2" />
              </g>
            </g>
            <path className="m-eye" data-m="eyeL" />
            <path className="m-eye" data-m="eyeR" />
            <path className="m-lash" data-m="lash" />
            <path className="m-mouth" data-m="mouth" />
            <ellipse className="m-o" data-m="o" cx="0" cy="17" rx="3.4" ry="4.2" />
          </g>
        </g>
        <g className="m-fx" data-m="fx" />
      </svg>
    </div>
  );
}
