import type { CSSProperties, ReactNode } from "react";

const coffeeTheme = {
  "--background": "40 27% 96%",
  "--foreground": "28 12% 19%",
  "--card": "42 35% 99%",
  "--card-foreground": "28 12% 19%",
  "--popover": "42 35% 99%",
  "--popover-foreground": "28 12% 19%",
  "--primary": "32 45% 39%",
  "--primary-foreground": "40 33% 98%",
  "--secondary": "38 24% 91%",
  "--secondary-foreground": "28 14% 25%",
  "--muted": "38 20% 92%",
  "--muted-foreground": "30 8% 45%",
  "--accent": "36 26% 90%",
  "--accent-foreground": "28 14% 24%",
  "--destructive": "4 58% 46%",
  "--destructive-foreground": "40 33% 98%",
  "--border": "34 18% 84%",
  "--input": "34 18% 84%",
  "--ring": "32 45% 50%",
} as CSSProperties;

/**
 * Тёплая оболочка раздела: тема, фон, контейнер.
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
      className={`relative overflow-hidden bg-[#f7f5f1] text-[#302d29] [color-scheme:light] ${
        fillHeight ? "flex h-full min-h-full flex-col" : "min-h-full"
      }`}
      style={coffeeTheme}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-55"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(123,100,72,0.12) 1px, transparent 0)",
          backgroundSize: "30px 30px",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-[#fffdf8] via-[#fbf8f2]/80 to-transparent" />

      <div
        className={`relative mx-auto w-full ${maxWidthClassName} px-5 sm:px-8 lg:px-10 ${
          fillHeight ? "flex min-h-0 flex-1 flex-col pb-5 pt-5" : "pb-16 pt-8"
        } ${contentClassName}`}
      >
        {actions && (
          <div className="mb-6 flex justify-end border-b border-[#ded8ce] pb-5">
            {actions}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export const coffeePanelClass =
  "rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]";

export const coffeeButtonClass =
  "inline-flex items-center justify-center rounded-full border border-[#d8d1c7] bg-[#fffdfa] text-[#5f584f] transition-colors hover:border-[#c7aa82] hover:bg-[#fff8ec] hover:text-[#312c27] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35";
