import type { ReactNode } from "react";

/**
 * Оболочка раздела: фон и контейнер. Цвета — токены tm-* из globals.css,
 * поэтому оболочка следует светлой и тёмной теме вместе с остальным
 * приложением (раньше здесь жила своя светлая палитра shadcn).
 *
 * Заголовка здесь больше нет. Он был буквальным дублем: `SiteHeader` печатает
 * название раздела из `dashboard-navigation.ts` в закреплённой панели, а
 * оболочка повторяла его же тремя сантиметрами ниже — вместе с надстрочником,
 * иконкой в скруглённом квадрате и описанием. На двенадцати разделах.
 *
 * `actions` остался: это единственное, что в шапке было содержанием, а не
 * подписью к самой себе.
 */
interface CoffeePageShellProps {
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  /**
   * Ширина колонки содержимого.
   *
   * Отдельным свойством, а не через `contentClassName`: у Tailwind порядок
   * классов в атрибуте ничего не решает, и `max-w-none`, дописанный следом,
   * с `max-w-[1240px]` не спорил бы — выигрывал бы тот, что позже в CSS.
   * Календарю нужна вся ширина, остальным разделам — колонка для чтения.
   */
  maxWidthClassName?: string;
  /** Занять всю высоту экрана: страница-приложение, а не страница-документ. */
  fillHeight?: boolean;
}

export function CoffeePageShell({
  actions,
  children,
  contentClassName = "",
  maxWidthClassName = "max-w-[1240px]",
  fillHeight = false,
}: CoffeePageShellProps) {
  return (
    <div
      className={`relative overflow-hidden bg-tm-bg text-tm-ink ${
        fillHeight ? "flex h-full min-h-full flex-col" : "min-h-full"
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-55"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(var(--tm-dot) / 0.08) 1px, transparent 0)",
          backgroundSize: "30px 30px",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-tm-surface via-tm-bg/80 to-transparent" />

      <div
        className={`relative mx-auto w-full ${maxWidthClassName} px-5 sm:px-8 lg:px-10 ${
          fillHeight ? "flex min-h-0 flex-1 flex-col pb-5 pt-5" : "pb-16 pt-8"
        } ${contentClassName}`}
      >
        {actions && (
          <div className="mb-6 flex justify-end border-b border-tm-line pb-5">
            {actions}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export const coffeePanelClass =
  "rounded-[20px] border border-tm-line bg-tm-surface/95 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.12)]";

export const coffeeButtonClass =
  "inline-flex items-center justify-center rounded-full border border-tm-line bg-tm-surface text-tm-ink-2 transition-colors hover:border-tm-accent hover:bg-tm-bg hover:text-tm-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tm-accent/35";
