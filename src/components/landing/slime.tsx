"use client";

import { useEffect, useRef } from "react";
import { createMascot, type MascotEngine } from "@/components/shell/mascot/engine";
import { MascotArt, STAGE_VIEWBOX } from "@/components/shell/mascot/mascot-art";
import "@/styles/timely/mascot-art.css";
import styles from "./slime.module.css";

// Слайм лендинга и страниц входа — тот же белый слайм, что живёт в углу приложения:
// рисунок и движок у них общие (components/shell/mascot). Здесь он стоит в вёрстке,
// без реплик и плашки над головой, а кадры считаются, только пока его видно.

type SlimeProps = {
  className?: string;
  /** Падает сверху при первом показе. */
  drop?: boolean;
  /** Глаза следят за курсором, наведение радует, клик — прыжок. */
  interactive?: boolean;
  /** Каждое новое значение — повод подпрыгнуть (например, смена вкладки). */
  hop?: number;
  /** Без подписи слайм — украшение и скрыт от скринридеров. */
  label?: string;
  /** Чем он сопит, если заснёт: «з» на русской странице, «z» на английской. */
  sleepGlyph?: string;
};

export function Slime({
  className,
  drop = false,
  interactive = false,
  hop = 0,
  label,
  sleepGlyph,
}: SlimeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MascotEngine | null>(null);
  const lastHop = useRef(hop);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = createMascot(host, { drop, sleepGlyph });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // `interactive` меняет разметку (есть кнопка или нет), движок надо пересоздать.
  }, [drop, interactive, sleepGlyph]);

  useEffect(() => {
    if (lastHop.current === hop) return;
    lastHop.current = hop;
    engineRef.current?.hop(0.8);
  }, [hop]);

  // С подписью слайм — кнопка, которую можно нажать и с клавиатуры. Без подписи это
  // украшение: нажать можно, но для скринридера и Tab его нет.
  const hit = !interactive ? null : label ? (
    <button type="button" className={`mascot-hit ${styles.hit}`} aria-label={label} />
  ) : (
    <span className={`mascot-hit ${styles.hit}`} aria-hidden="true" />
  );

  return (
    <div
      ref={hostRef}
      className={`${styles.slime} ${className ?? ""}`}
      data-drop={drop ? "true" : undefined}
      role={label && !interactive ? "img" : undefined}
      aria-label={label && !interactive ? label : undefined}
      aria-hidden={label ? undefined : true}
    >
      <MascotArt viewBox={STAGE_VIEWBOX} />
      {hit}
    </div>
  );
}
