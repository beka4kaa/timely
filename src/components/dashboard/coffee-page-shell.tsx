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

interface CoffeePageShellProps {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function CoffeePageShell({
  eyebrow,
  title,
  description,
  icon,
  actions,
  children,
  contentClassName = "",
}: CoffeePageShellProps) {
  return (
    <div
      className="relative min-h-full overflow-hidden bg-[#f7f5f1] text-[#302d29] [color-scheme:light]"
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
        className={`relative mx-auto w-full max-w-[1240px] px-5 pb-16 pt-8 sm:px-8 lg:px-10 ${contentClassName}`}
      >
        <header className="mb-8 flex flex-col gap-5 border-b border-[#ded8ce] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a4743f]">
                {eyebrow}
              </p>
            )}
            <div className="flex items-center gap-3">
              {icon && (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#dec9ab] bg-[#fffaf1] text-[#9a6630] shadow-[0_5px_18px_rgba(83,61,34,0.06)]">
                  {icon}
                </span>
              )}
              <h1 className="truncate font-serif text-[30px] font-medium tracking-[-0.035em] text-[#302b26] sm:text-[34px]">
                {title}
              </h1>
            </div>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#7f776e]">
              {description}
            </p>
          </div>

          {actions && <div className="shrink-0">{actions}</div>}
        </header>

        {children}
      </div>
    </div>
  );
}

export const coffeePanelClass =
  "rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]";

export const coffeeButtonClass =
  "inline-flex items-center justify-center rounded-full border border-[#d8d1c7] bg-[#fffdfa] text-[#5f584f] transition-colors hover:border-[#c7aa82] hover:bg-[#fff8ec] hover:text-[#312c27] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35";
