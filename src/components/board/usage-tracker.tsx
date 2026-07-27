"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  CalendarDays,
  CircleGauge,
  Clock3,
  Coins,
  ImageIcon,
  MessagesSquare,
} from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface UsageWindow {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  reset_at: string;
}

export interface AIPlanSummary {
  id: "free" | "pro" | "max";
  label: string;
  price_usd: number;
  usage_multiplier: number;
  is_admin_grant: boolean;
}

export interface AIUsageSummary {
  authenticated: boolean;
  updated_at: string;
  plan?: AIPlanSummary;
  context: {
    used: number;
    limit: number;
    percent: number;
    model: string;
  };
  windows: {
    five_hour: UsageWindow;
    weekly: UsageWindow;
  };
  totals: {
    billable_tokens: number;
    provider_tokens: number;
    images: number;
    requests: number;
    cost_usd: number;
  };
  by_model: Array<{
    model: string;
    tokens: number;
    cost_usd: number;
  }>;
  by_feature: Array<{
    feature: string;
    tokens: number;
  }>;
  daily: Array<{
    date: string;
    tokens: number;
  }>;
}

export interface ContextUsageOverride {
  usedTokens: number;
  limitTokens: number;
  percent: number;
}

const FALLBACK_CONTEXT_LIMIT = 32_000;
const FALLBACK_FIVE_HOUR_LIMIT = 25_000;
const FALLBACK_WEEKLY_LIMIT = 100_000;

const chartConfig = {
  tokens: {
    label: "Timely-токены",
    color: "#b77a2d",
  },
} satisfies ChartConfig;

const featureLabels: Record<string, string> = {
  board_router: "Маршрутизация",
  board_layout: "Схема доски",
  diagram_planner: "Планировщик",
  diagram_critic: "Проверка схемы",
  image_generation: "Изображения",
  label_grounding: "Размещение подписей",
  object_labeling: "Подписи объектов",
  vision_analysis: "Анализ изображения",
  nutrition_photo: "Анализ питания",
  solve: "Решение задач",
  chat: "Чат",
  illustration: "Иллюстрации",
};

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value || 0)));
}

export function compactUsageNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function shortModelName(model: string) {
  const name = model.split("/").at(-1) || model;
  return name
    .replace("bytedance-seed/", "")
    .replace("mlx-community/", "")
    .replace(/-\d{4}-\d{2}-\d{2}$/i, "");
}

function resetLabel(value: string) {
  if (!value) return "";
  const delta = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(delta) || delta <= 0) return "обновляется";
  const totalMinutes = Math.max(1, Math.ceil(delta / 60_000));
  if (totalMinutes < 60) return `через ${totalMinutes} мин`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `через ${hours} ч${minutes ? ` ${minutes} мин` : ""}`;
  return `через ${Math.ceil(hours / 24)} дн`;
}

function fallbackWindow(limit: number): UsageWindow {
  return {
    used: 0,
    limit,
    remaining: limit,
    percent: 0,
    reset_at: "",
  };
}

function mergedContext(
  summary: AIUsageSummary | null,
  override: ContextUsageOverride,
) {
  const providerUsed = summary?.context.used ?? 0;
  const providerLimit = summary?.context.limit || override.limitTokens;
  const used = Math.max(providerUsed, override.usedTokens);
  const limit = providerLimit || FALLBACK_CONTEXT_LIMIT;
  return {
    used,
    limit,
    percent: clampPercent(
      Math.max(summary?.context.percent ?? 0, override.percent),
    ),
  };
}

export function useAIUsageSummary() {
  const [summary, setSummary] = useState<AIUsageSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await authFetch("/api/ai/usage", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;
      setSummary((await response.json()) as AIUsageSummary);
    } catch {
      // Accounting is deliberately fail-open: the board remains usable.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { summary, isLoading, refresh };
}

function UsageBar({
  label,
  value,
  detail,
  percent,
  accent = false,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  percent: number;
  accent?: boolean;
  icon: React.ReactNode;
}) {
  const safePercent = clampPercent(percent);
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="mt-0.5 text-[#9b7a50]">{icon}</span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-[#484139]">
              {label}
            </p>
            {detail && (
              <p className="truncate text-[10px] text-[#a39b91]">{detail}</p>
            )}
          </div>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-[#736b62]">
          {value}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e9e4dc]">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            accent ? "bg-[#bd7c29]" : "bg-[#62584d]"
          }`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
    </div>
  );
}

function UsageLimits({
  summary,
  context,
}: {
  summary: AIUsageSummary | null;
  context: ContextUsageOverride;
}) {
  const currentContext = mergedContext(summary, context);
  const fiveHour =
    summary?.windows.five_hour ?? fallbackWindow(FALLBACK_FIVE_HOUR_LIMIT);
  const weekly =
    summary?.windows.weekly ?? fallbackWindow(FALLBACK_WEEKLY_LIMIT);

  return (
    <div className="space-y-4">
      <UsageBar
        label="Контекст"
        value={`${compactUsageNumber(currentContext.used)} / ${compactUsageNumber(currentContext.limit)}`}
        percent={currentContext.percent}
        icon={<CircleGauge className="h-3.5 w-3.5" />}
      />
      <UsageBar
        label="Лимит на 5 часов"
        detail={resetLabel(fiveHour.reset_at)}
        value={`${fiveHour.percent}%`}
        percent={fiveHour.percent}
        icon={<Clock3 className="h-3.5 w-3.5" />}
      />
      <UsageBar
        label="Недельный лимит"
        detail={resetLabel(weekly.reset_at)}
        value={`${weekly.percent}%`}
        percent={weekly.percent}
        accent
        icon={<CalendarDays className="h-3.5 w-3.5" />}
      />
    </div>
  );
}

export function AIUsageIndicator({
  summary,
  context,
  isLoading = false,
}: {
  summary: AIUsageSummary | null;
  context: ContextUsageOverride;
  isLoading?: boolean;
}) {
  const currentContext = mergedContext(summary, context);
  const fiveHour =
    summary?.windows.five_hour ?? fallbackWindow(FALLBACK_FIVE_HOUR_LIMIT);
  const weekly =
    summary?.windows.weekly ?? fallbackWindow(FALLBACK_WEEKLY_LIMIT);
  const ringPercent = Math.max(
    currentContext.percent,
    fiveHour.percent,
    weekly.percent,
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Показать лимиты AI"
          title="Лимиты"
          className="relative grid h-8 w-8 place-items-center rounded-full outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
          style={{
            background: `conic-gradient(#b7792d ${ringPercent * 3.6}deg, #e5dfd6 0deg)`,
          }}
        >
          <span className="grid h-[25px] w-[25px] place-items-center rounded-full bg-[#fbfaf7] text-[#7a6751]">
            <Coins
              className={`h-3.5 w-3.5 ${isLoading ? "animate-pulse" : ""}`}
            />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        className="z-[160] w-[310px] rounded-[18px] border-[#d8d1c7] bg-[#fbfaf7] p-4 text-[#3d3832] shadow-[0_24px_70px_rgba(58,47,34,0.18)]"
      >
        <UsageLimits summary={summary} context={context} />
      </PopoverContent>
    </Popover>
  );
}

export function UsageAnalyticsPanel({
  summary,
  context,
  isLoading = false,
}: {
  summary: AIUsageSummary | null;
  context: ContextUsageOverride;
  isLoading?: boolean;
}) {
  const chartData = useMemo(
    () =>
      (summary?.daily ?? []).map((item) => ({
        day: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(
          new Date(`${item.date}T12:00:00`),
        ),
        tokens: item.tokens,
      })),
    [summary?.daily],
  );
  const maxModelTokens = Math.max(
    1,
    ...(summary?.by_model ?? []).map((item) => item.tokens),
  );
  const hasUsage = (summary?.totals.requests ?? 0) > 0;

  return (
    <div className={isLoading ? "animate-pulse" : ""}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <AnalyticsStat
          label="Тариф"
          value={summary?.plan?.label ?? "Free"}
          detail={summary?.plan?.is_admin_grant ? "Доступ администратора" : "Текущий план"}
          icon={<CircleGauge className="h-4 w-4" />}
        />
        <AnalyticsStat
          label="Timely-токены"
          value={compactUsageNumber(summary?.totals.billable_tokens ?? 0)}
          detail={`${summary?.totals.requests ?? 0} запросов`}
          icon={<Coins className="h-4 w-4" />}
        />
        <AnalyticsStat
          label="Изображения"
          value={String(summary?.totals.images ?? 0)}
          detail="Фактические генерации"
          icon={<ImageIcon className="h-4 w-4" />}
        />
        <AnalyticsStat
          label="Стоимость"
          value={`$${(summary?.totals.cost_usd ?? 0).toFixed(4)}`}
          detail="Учтено провайдером"
          icon={<MessagesSquare className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[18px] border border-[#ded8cf] bg-white/55 p-4">
          <p className="mb-4 font-serif text-[15px] font-semibold text-[#403a34]">
            Текущие лимиты
          </p>
          <UsageLimits summary={summary} context={context} />
        </section>

        <section className="rounded-[18px] border border-[#ded8cf] bg-white/55 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-serif text-[15px] font-semibold text-[#403a34]">
              Последние 7 дней
            </p>
            <span className="text-[10px] text-[#9b9389]">
              по фактическим вызовам
            </span>
          </div>
          {hasUsage ? (
            <ChartContainer config={chartConfig} className="h-[170px] w-full">
              <BarChart accessibilityLayer data={chartData}>
                <CartesianGrid vertical={false} stroke="#e4ded5" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={7}
                  fontSize={10}
                />
                <ChartTooltip
                  cursor={{ fill: "#f3ede4" }}
                  content={<ChartTooltipContent hideLabel />}
                />
                <Bar
                  dataKey="tokens"
                  fill="var(--color-tokens)"
                  radius={[5, 5, 1, 1]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="grid h-[170px] place-items-center rounded-[13px] border border-dashed border-[#ddd6cc] bg-[#fbfaf7]/65 text-center">
              <div>
                <p className="text-[12px] text-[#756d64]">Пока нет данных</p>
                <p className="mt-1 text-[10px] text-[#aaa198]">
                  График появится после первого AI-запроса
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-[18px] border border-[#ded8cf] bg-white/55 p-4">
          <p className="mb-3 font-serif text-[15px] font-semibold text-[#403a34]">
            Модели
          </p>
          {summary?.by_model.length ? (
            <div className="space-y-3">
              {summary.by_model.map((item) => (
                <div key={item.model}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
                    <span className="truncate text-[#625b53]">
                      {shortModelName(item.model)}
                    </span>
                    <span className="shrink-0 tabular-nums text-[#978f85]">
                      {compactUsageNumber(item.tokens)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#ebe6df]">
                    <div
                      className="h-full rounded-full bg-[#b98546]"
                      style={{
                        width: `${Math.max(3, Math.round((item.tokens / maxModelTokens) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[#9c948a]">Вызовов моделей пока нет.</p>
          )}
        </section>

        <section className="rounded-[18px] border border-[#ded8cf] bg-white/55 p-4">
          <p className="mb-3 font-serif text-[15px] font-semibold text-[#403a34]">
            По функциям
          </p>
          {summary?.by_feature.length ? (
            <div className="flex flex-wrap gap-2">
              {summary.by_feature.map((item) => (
                <span
                  key={item.feature}
                  className="rounded-full border border-[#ded7ce] bg-[#fbfaf7] px-2.5 py-1.5 text-[10px] text-[#756c62]"
                >
                  {featureLabels[item.feature] ?? item.feature} ·{" "}
                  {compactUsageNumber(item.tokens)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[#9c948a]">Разбивки пока нет.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function AnalyticsStat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[16px] border border-[#ded8cf] bg-white/55 p-3.5">
      <div className="flex items-center gap-2 text-[#a1733a]">
        {icon}
        <span className="text-[10px] uppercase tracking-[0.09em]">{label}</span>
      </div>
      <p className="mt-2 font-serif text-[20px] font-semibold tabular-nums text-[#3e3933]">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[9px] text-[#9c948a]">{detail}</p>
    </div>
  );
}

export function CollapsedUsageMeters({
  summary,
  context,
}: {
  summary: AIUsageSummary | null;
  context: ContextUsageOverride;
}) {
  const currentContext = mergedContext(summary, context);
  const fiveHour =
    summary?.windows.five_hour ?? fallbackWindow(FALLBACK_FIVE_HOUR_LIMIT);
  const weekly =
    summary?.windows.weekly ?? fallbackWindow(FALLBACK_WEEKLY_LIMIT);
  const meters = [
    { label: "Контекст", percent: currentContext.percent },
    { label: "5 часов", percent: fiveHour.percent },
    { label: "Неделя", percent: weekly.percent },
  ];

  return (
    <span
      className="mb-3 flex h-[126px] w-full shrink-0 items-end justify-center gap-[3px]"
      aria-label="Лимиты AI"
    >
      {meters.map((meter) => (
        <span
          key={meter.label}
          className="flex h-full w-[15px] flex-col items-center justify-end gap-1.5"
          title={`${meter.label}: ${meter.percent}%`}
        >
          <span
            className="min-h-0 flex-1 truncate text-[8px] tracking-[0.04em] text-[#958d83]"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {meter.label}
          </span>
          <span className="relative block h-14 w-1.5 shrink-0 overflow-hidden rounded-full bg-[#e6e0d8]">
            <span
              className="absolute inset-x-0 bottom-0 block rounded-full bg-[#b47a35] transition-[height] duration-500"
              style={{ height: `${clampPercent(meter.percent)}%` }}
            />
          </span>
        </span>
      ))}
    </span>
  );
}
