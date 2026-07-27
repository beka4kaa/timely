"use client";

import Link from "next/link";
import {
  BarChart3,
  Check,
  ChevronRight,
  CreditCard,
  Crown,
  Database,
  Gauge,
  LockKeyhole,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  type AIUsageSummary,
  type ContextUsageOverride,
  UsageAnalyticsPanel,
} from "./usage-tracker";

type SettingsTab = "general" | "account" | "privacy" | "usage" | "plan";

interface BoardSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  summary: AIUsageSummary | null;
  context: ContextUsageOverride;
  isLoading?: boolean;
  userName?: string;
  userEmail?: string;
}

const settingsItems = [
  {
    id: "general",
    label: "Основные",
    description: "Интерфейс и рабочее пространство",
    group: "Настройки",
    icon: Settings2,
  },
  {
    id: "account",
    label: "Аккаунт",
    description: "Профиль и доступ",
    group: "Настройки",
    icon: UserRound,
  },
  {
    id: "privacy",
    label: "Конфиденциальность",
    description: "Данные и безопасность",
    group: "Настройки",
    icon: LockKeyhole,
  },
  {
    id: "usage",
    label: "Использование",
    description: "Лимиты, модели и токены",
    group: "AI и подписка",
    icon: BarChart3,
  },
  {
    id: "plan",
    label: "Тариф",
    description: "Планы и доступные лимиты",
    group: "AI и подписка",
    icon: CreditCard,
  },
] as const;

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    note: "Для знакомства",
    limits: "100 тыс. токенов в неделю",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19.90",
    note: "Для регулярной учёбы",
    limits: "1 млн токенов в неделю",
  },
  {
    id: "max",
    name: "Max",
    price: "$199",
    note: "20× лимиты Pro",
    limits: "20 млн токенов в неделю",
  },
] as const;

export function BoardSettingsDialog({
  open,
  onClose,
  summary,
  context,
  isLoading = false,
  userName,
  userEmail,
}: BoardSettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    if (!query) return settingsItems;
    return settingsItems.filter((item) =>
      `${item.label} ${item.description} ${item.group}`
        .toLocaleLowerCase("ru")
        .includes(query),
    );
  }, [search]);

  if (!open) return null;

  const activeItem =
    settingsItems.find((item) => item.id === tab) ?? settingsItems[0];
  const currentPlan = summary?.plan?.id ?? "free";

  return (
    <div
      className="fixed inset-0 z-[180] grid place-items-center bg-[#302d2a]/32 p-3 backdrop-blur-[7px] max-sm:p-0"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-settings-title"
        className="flex h-[min(760px,calc(100dvh-24px))] w-full max-w-[1080px] overflow-hidden rounded-[24px] border border-[#d4cec5] bg-[#fbfaf7] text-[#3d3832] shadow-[0_32px_110px_rgba(43,34,25,0.3)] max-sm:h-dvh max-sm:rounded-none max-sm:border-0"
      >
        <aside className="hidden w-[238px] shrink-0 flex-col border-r border-[#dcd6cc] bg-[#f1eee8] p-3 sm:flex">
          <div className="px-2 pb-4 pt-2">
            <p className="font-serif text-[18px] font-semibold tracking-[-0.02em] text-[#7d5428]">
              Timely
            </p>
            <p className="mt-0.5 text-[11px] text-[#8f877e]">Настройки</p>
          </div>

          <label className="relative mb-4 block">
            <span className="sr-only">Поиск по настройкам</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#928a80]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск"
              className="h-10 w-full rounded-[13px] border border-[#d8d1c8] bg-[#fbfaf7]/75 pl-9 pr-3 text-[12px] text-[#48413a] outline-none transition-colors placeholder:text-[#a39b91] focus:border-[#bd8b52] focus:bg-white"
            />
          </label>

          <nav
            className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]"
            aria-label="Разделы настроек"
          >
            {["Настройки", "AI и подписка"].map((group) => {
              const items = visibleItems.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <div key={group} className="mb-5">
                  <p className="mb-1.5 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9b9288]">
                    {group}
                  </p>
                  <div className="space-y-1">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <SettingsTabButton
                          key={item.id}
                          active={tab === item.id}
                          icon={<Icon className="h-4 w-4" />}
                          onClick={() => setTab(item.id)}
                        >
                          {item.label}
                        </SettingsTabButton>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!visibleItems.length && (
              <p className="px-3 py-5 text-center text-[11px] leading-5 text-[#958d83]">
                Ничего не найдено
              </p>
            )}
          </nav>

          <div className="rounded-[15px] border border-[#d9d2c8] bg-[#fbfaf7]/72 px-3 py-2.5">
            <p className="text-[9px] uppercase tracking-[0.12em] text-[#9a9187]">
              Текущий план
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="font-serif text-[16px] font-semibold text-[#815925]">
                {summary?.plan?.label ?? "Free"}
              </p>
              <Crown className="h-3.5 w-3.5 text-[#ad7634]" />
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#fbfaf7]">
          <header className="flex h-[74px] shrink-0 items-center justify-between border-b border-[#e0dbd3] px-4 sm:px-7">
            <div className="min-w-0">
              <h2
                id="board-settings-title"
                className="truncate font-serif text-[19px] font-semibold tracking-[-0.02em] text-[#39332d]"
              >
                {activeItem.label}
              </h2>
              <p className="mt-0.5 hidden truncate text-[10px] text-[#978f85] sm:block">
                {activeItem.description}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть настройки"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#8f877d] outline-none transition-colors hover:bg-[#eeeae3] hover:text-[#3d3832] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </header>

          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#e3ded6] px-3 py-2 [scrollbar-width:none] sm:hidden">
            {settingsItems.map((item) => (
              <MobileTab
                key={item.id}
                active={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </MobileTab>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
            {tab === "general" && (
              <GeneralSettings currentPlan={summary?.plan?.label ?? "Free"} />
            )}
            {tab === "account" && (
              <AccountSettings
                userName={userName}
                userEmail={userEmail}
                currentPlan={summary?.plan?.label ?? "Free"}
              />
            )}
            {tab === "privacy" && <PrivacySettings />}
            {tab === "usage" && (
              <UsageAnalyticsPanel
                summary={summary}
                context={context}
                isLoading={isLoading}
              />
            )}
            {tab === "plan" && (
              <PlanSettings
                currentPlan={currentPlan}
                isAdminGrant={Boolean(summary?.plan?.is_admin_grant)}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsTabButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
        active
          ? "bg-[#ded8cf] font-medium text-[#3f3933]"
          : "text-[#756e65] hover:bg-[#e8e3dc] hover:text-[#403a34]"
      }`}
    >
      <span className={active ? "text-[#966128]" : "text-[#8b847b]"}>
        {icon}
      </span>
      {children}
    </button>
  );
}

function MobileTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
        active
          ? "bg-[#403a34] text-white"
          : "border border-[#ddd7ce] bg-white/60 text-[#7d756c]"
      }`}
    >
      {children}
    </button>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="font-serif text-[17px] font-semibold text-[#403a34]">
          {title}
        </h3>
        <p className="mt-0.5 text-[10px] leading-4 text-[#968e84]">
          {description}
        </p>
      </div>
      <div className="overflow-hidden rounded-[18px] border border-[#ded8cf] bg-white/52">
        {children}
      </div>
    </section>
  );
}

function PreferenceRow({
  icon,
  title,
  detail,
  value,
  last = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex min-h-[72px] items-center gap-3 px-4 py-3 ${
        last ? "" : "border-b border-[#e6e1d9]"
      }`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[#f0e7db] text-[#9b682e]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium text-[#474039]">
          {title}
        </span>
        <span className="mt-0.5 block text-[10px] leading-4 text-[#9a9288]">
          {detail}
        </span>
      </span>
      <span className="shrink-0 rounded-full border border-[#ddd6cc] bg-[#fbfaf7] px-2.5 py-1 text-[10px] text-[#6f675e]">
        {value}
      </span>
    </div>
  );
}

function GeneralSettings({ currentPlan }: { currentPlan: string }) {
  return (
    <div className="space-y-7">
      <SettingsSection
        title="Рабочее пространство"
        description="Основные параметры доски и AI-панели."
      >
        <PreferenceRow
          icon={<Palette className="h-4 w-4" />}
          title="Оформление"
          detail="Единая светлая кофейная тема для всех разделов."
          value="Timely Light"
        />
        <PreferenceRow
          icon={<Database className="h-4 w-4" />}
          title="Сохранение"
          detail="Изменения доски сохраняются автоматически."
          value="Включено"
        />
        <PreferenceRow
          icon={<Gauge className="h-4 w-4" />}
          title="Текущий тариф"
          detail="Один лимит применяется ко всем AI-функциям."
          value={currentPlan}
          last
        />
      </SettingsSection>

      <SettingsSection
        title="AI и генерация"
        description="Технические параметры управляются сервером Timely."
      >
        <PreferenceRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Учёт запросов"
          detail="Токены и стоимость считаются после фактического ответа модели."
          value="Серверный"
          last
        />
      </SettingsSection>
    </div>
  );
}

function AccountSettings({
  userName,
  userEmail,
  currentPlan,
}: {
  userName?: string;
  userEmail?: string;
  currentPlan: string;
}) {
  const displayName = userName || "Пользователь Timely";
  const initial = displayName.trim().charAt(0).toUpperCase() || "T";

  return (
    <div className="space-y-7">
      <SettingsSection
        title="Профиль"
        description="Данные текущего аккаунта Timely."
      >
        <div className="flex items-center gap-4 px-4 py-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[15px] bg-[#efe1cf] font-serif text-[20px] font-semibold text-[#865a29]">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-serif text-[16px] font-semibold text-[#403a34]">
              {displayName}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-[#978f85]">
              {userEmail || "Аккаунт Timely"}
            </span>
          </span>
          <Link
            href="/dashboard/profile"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#d8d1c7] bg-[#fbfaf7] px-3 text-[10px] text-[#625b53] outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
          >
            Профиль
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Доступ"
        description="Уровень AI-возможностей для этого аккаунта."
      >
        <PreferenceRow
          icon={<Crown className="h-4 w-4" />}
          title="Тариф"
          detail="Определяет доступные лимиты контекста и генераций."
          value={currentPlan}
          last
        />
      </SettingsSection>
    </div>
  );
}

function PrivacySettings() {
  return (
    <div className="space-y-7">
      <SettingsSection
        title="Данные и безопасность"
        description="Как Timely обрабатывает запросы доски."
      >
        <PreferenceRow
          icon={<LockKeyhole className="h-4 w-4" />}
          title="API-ключи"
          detail="Ключи провайдеров не передаются и не хранятся в браузере."
          value="Защищено"
        />
        <PreferenceRow
          icon={<Database className="h-4 w-4" />}
          title="Учёт использования"
          detail="Сохраняются только технические метрики запросов и стоимости."
          value="Минимальный"
          last
        />
      </SettingsSection>
    </div>
  );
}

function PlanSettings({
  currentPlan,
  isAdminGrant,
}: {
  currentPlan: string;
  isAdminGrant: boolean;
}) {
  return (
    <div>
      {isAdminGrant && (
        <div className="mb-4 flex items-center gap-2 rounded-[14px] border border-[#d9bd93] bg-[#fff8ec] px-3.5 py-3 text-[11px] text-[#795425]">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Max выдан аккаунту администратора. Защитные лимиты остаются активными.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {plans.map((plan) => {
          const active = plan.id === currentPlan;
          return (
            <article
              key={plan.id}
              className={`relative rounded-[20px] border p-4 ${
                active
                  ? "border-[#c79556] bg-[#fff9ef] shadow-[0_8px_30px_rgba(129,87,36,0.09)]"
                  : "border-[#ded8cf] bg-white/55"
              }`}
            >
              {active && (
                <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-[#a76c27] text-white">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
              <p className="font-serif text-[20px] font-semibold">{plan.name}</p>
              <p className="mt-1 text-[10px] text-[#948c82]">{plan.note}</p>
              <p className="mt-5 font-serif text-[24px] font-semibold text-[#815925]">
                {plan.price}
                {plan.id !== "free" && (
                  <span className="ml-1 text-[10px] font-normal text-[#948c82]">
                    / мес.
                  </span>
                )}
              </p>
              <p className="mt-3 border-t border-[#e4ded5] pt-3 text-[11px] leading-5 text-[#6d655c]">
                {plan.limits}
              </p>
              <p className="mt-1 text-[9px] text-[#a09990]">
                Контекст, изображения и reasoning учитываются вместе.
              </p>
            </article>
          );
        })}
      </div>
    </div>
  );
}
