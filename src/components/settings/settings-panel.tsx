"use client";

// Настройки одним окном: слева разделы, справа их строки. То же самое открывается
// отдельной страницей /settings, на телефоне — во весь экран.
//
// Только то, что на самом деле работает: стиля помощи, памяти тьютора, родительского
// контура и удаления аккаунта на бэкенде пока нет, поэтому этих строк здесь нет.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PomodoroSettings } from "@/components/pomodoro/timer-settings";
import { Icon, type IconName } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { initialsOf } from "@/components/shell/sidebar";
import { REMIND_MASCOT_KEY, REMIND_PUSH_KEY } from "@/components/shell/view-tracker";
import { ACCENTS, DEFAULT_ACCENT, applyAccent, readAccent, type AccentKey } from "@/lib/accent";
import { LOCALES, getLocale, msg, switchLocale, t } from "@/lib/i18n";
import { setChatPrefs, useChatPrefs } from "@/lib/chat-prefs";
import { updateMe, useMe, type Me } from "@/lib/contest-api";
import type { SettingsSection } from "@/stores/settings-dialog";

const THEMES = [
  { key: "system", title: msg("Как в системе") },
  { key: "light", title: msg("Светлая") },
  { key: "dark", title: msg("Тёмная") },
];

/** Тумблер в localStorage: значения "1" и "0" читает каркас. */
function useFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [on, setOn] = useState(fallback);
  useEffect(() => {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) setOn(value === "1");
    } catch {
      // Хранилище закрыто: тумблер живёт до перезагрузки.
    }
  }, [key]);
  const set = useCallback(
    (value: boolean) => {
      setOn(value);
      try {
        window.localStorage.setItem(key, value ? "1" : "0");
      } catch {
        // То же самое.
      }
    },
    [key],
  );
  return [on, set];
}

function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      className="switch"
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

type Permission = NotificationPermission | "unsupported";

/** Что показывать в чате. Сама модель выбирается в поле ввода, рядом с вопросом. */
function ChatSection() {
  const prefs = useChatPrefs();
  return (
    <section className="set">
      <h2>{t("Чат с тьютором")}</h2>
      <div className="set-body">
        <div className="set-line">
          <div>
            {t("Насколько глубоко думать")}
            <small>{t("В поле чата: Instant, Medium или High")}</small>
          </div>
          <Switch
            on={prefs.showPicker}
            label={t("Показывать выбор Instant, Medium, High")}
            onChange={(value) => setChatPrefs({ showPicker: value })}
          />
        </div>
        <div className="set-line">
          <div>
            {t("Контекст и токены")}
            <small>{t("Окно контекста в поле чата, токены и цена под ответами")}</small>
          </div>
          <Switch
            on={prefs.showUsage}
            label={t("Показывать контекст и токены")}
            onChange={(value) => setChatPrefs({ showUsage: value })}
          />
        </div>
        <p className="small-note">
          <Link className="link" href="/privacy">
            {t("Что видит тьютор и куда уходят данные")}
          </Link>
        </p>
      </div>
    </section>
  );
}

function Reminders() {
  const router = useRouter();
  const [mascotOn, setMascotOn] = useFlag(REMIND_MASCOT_KEY, true);
  const [pushFlag, setPushFlag] = useFlag(REMIND_PUSH_KEY, false);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const pushOn = pushFlag && permission === "granted";

  const togglePush = async (next: boolean) => {
    setProblem(null);
    if (!next) {
      setPushFlag(false);
      return;
    }
    if (permission === "unsupported" || permission === null) return;
    const answer = await Notification.requestPermission();
    setPermission(answer);
    setPushFlag(answer === "granted");
  };

  const tryIt = () => {
    setProblem(null);
    const go = () => router.push("/dashboard/weaknesses");
    if (mascotOn) mascot.remind(t("Пора повторить"), t("Так выглядит напоминание"), go);
    if (!pushOn) return;
    try {
      const note = new Notification(t("Пора повторить"), { body: t("Так выглядит напоминание"), icon: "/logo.svg" });
      note.onclick = () => {
        window.focus();
        go();
      };
    } catch {
      // На телефоне браузер показывает уведомления только из установленного приложения.
      setProblem(t("Здесь браузер не показывает уведомления из вкладки."));
    }
  };

  let pushHint = t("Придут, пока Timely открыт в браузере");
  if (permission === "unsupported") pushHint = t("Этот браузер не умеет показывать уведомления");
  if (permission === "denied") pushHint = t("Запрещены в настройках браузера. Разреши их там");

  return (
    <section className="set">
      <h2>{t("Напоминания")}</h2>
      <div className="set-body">
        <div className="set-line">
          <div>
            {t("Через слайма")}
            <small>{t("Плашка над ним, когда пора повторить тему")}</small>
          </div>
          <Switch on={mascotOn} label={t("Напоминать через слайма")} onChange={setMascotOn} />
        </div>
        <div className="set-line">
          <div>
            {t("Уведомления")}
            <small>{pushHint}</small>
          </div>
          <Switch
            on={pushOn}
            label={t("Присылать уведомления браузера")}
            disabled={permission === "unsupported" || permission === "denied" || permission === null}
            onChange={(next) => void togglePush(next)}
          />
        </div>
        <div className="ntf" aria-label={t("Как выглядит уведомление")}>
          <svg className="ntf-ic" viewBox="0 0 172 122" aria-hidden="true">
            <use href="#art-slime" />
          </svg>
          <div>
            <b>{t("Пора повторить")}</b>
            <span>{t("Одна тема ждёт повторения")}</span>
          </div>
          <small>{t("сейчас")}</small>
        </div>
        <button className="btn btn-line" type="button" disabled={!mascotOn && !pushOn} onClick={tryIt}>
          {t("Пробное уведомление")}
        </button>
        {problem ? (
          <p className="small-note" role="status">
            {problem}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ratingHint(me: Me | null, loading: boolean): string {
  if (!me) return loading ? " " : t("Не загрузилось. Обнови страницу");
  const name = me.public_username;
  return me.show_in_leaderboard
    ? t("Другие ученики видят «{name}», страну, баллы и рейтинг по предметам", { name })
    : t("Сейчас тебя видишь только ты. Если включишь, другие увидят «{name}», страну, баллы и рейтинг по предметам", {
        name,
      });
}

/** Согласие хранит сервер, поэтому тумблер меняется только после его ответа. */
function WhoSeesMe({ me, loading, setMe }: { me: Me | null; loading: boolean; setMe: (me: Me) => void }) {
  const [saving, setSaving] = useState(false);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      setMe(await updateMe({ show_in_leaderboard: next }));
    } catch {
      toast.error(t("Не сохранилось. Попробуй ещё раз."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="set">
      <h2>{t("Кто меня видит")}</h2>
      <div className="set-body">
        <div className="set-line">
          <div>
            {t("Показывать меня в рейтинге")}
            <small>{ratingHint(me, loading)}</small>
          </div>
          {me ? (
            <Switch
              on={me.show_in_leaderboard}
              label={t("Показывать меня в рейтинге")}
              disabled={saving}
              onChange={(next) => void toggle(next)}
            />
          ) : null}
        </div>
        <div className="set-line">
          <div>
            {t("Группы")}
            <small>
              {t(
                "В группу вступают только сами, по коду от её создателя. Таблицу видят только участники, а показ в рейтинге на группы не влияет",
              )}
            </small>
          </div>
        </div>
        <p className="small-note">{t("Почту, описание, дни и часы фокуса другие ученики не видят.")}</p>
      </div>
    </section>
  );
}


function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="tabs" role="group" aria-label={t("Тема оформления")}>
      {THEMES.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={mounted && theme === item.key}
          onClick={() => setTheme(item.key)}
        >
          {t(item.title)}
        </button>
      ))}
    </div>
  );
}

/**
 * Язык интерфейса. Названия языков на них самих, чтобы свой язык узнавался на любом экране.
 * Смена перезагружает страницу: так перерисуется всё, и уже посчитанные строки тоже.
 */
function LanguagePicker() {
  const current = getLocale();
  return (
    <div className="tabs" role="group" aria-label={t("Язык")}>
      {LOCALES.map((item) => (
        <button
          key={item.key}
          type="button"
          lang={item.key}
          aria-pressed={current === item.key}
          onClick={() => switchLocale(item.key)}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}

/** Цвет акцента: кнопка отправки, переключатели, выбранное и отметки «сегодня». */
function AccentPicker() {
  const [accent, setAccent] = useState<AccentKey>(DEFAULT_ACCENT);
  useEffect(() => setAccent(readAccent()), []);
  return (
    <div className="acc-pick" role="radiogroup" aria-label={t("Цвет акцента")}>
      {ACCENTS.map((item) => (
        <button
          key={item.key}
          className="acc-dot"
          type="button"
          role="radio"
          aria-checked={accent === item.key}
          aria-label={t(item.name)}
          title={t(item.name)}
          data-accent={item.key}
          onClick={() => {
            applyAccent(item.key);
            setAccent(item.key);
          }}
        >
          <Icon name="check" />
        </button>
      ))}
    </div>
  );
}

function ProfileSettings() {
  const { data: session } = useSession();
  const { me, loading: meLoading, setMe } = useMe();
  const known = session?.user?.name || me?.name || null;
  const name = known ?? (meLoading ? "\u00a0" : t("Ученик"));
  const email = session?.user?.email || me?.email || "";
  const isAdmin = Boolean(me?.is_admin || me?.is_staff);

  return (
    <>
      <div className="account">
        <span className="avatar big" aria-hidden="true">
          {known || !meLoading ? initialsOf(name) : null}
        </span>
        <div>
          {name}
          {email ? <small>{email}</small> : null}
        </div>
        <Link className="btn btn-line" href="/dashboard/profile">
          {t("Открыть профиль")}
        </Link>
      </div>
      <WhoSeesMe me={me} loading={meLoading} setMe={setMe} />
      <section className="set">
        <h2>{t("Язык и оформление")}</h2>
        <div className="set-body">
          <div className="set-line">
            <div>
              {t("Язык")}
              <small>{t("Меню, кнопки и ответы тьютора")}</small>
            </div>
            <LanguagePicker />
          </div>
          <ThemePicker />
          <div className="set-line">
            <div>
              {t("Цвет акцента")}
              <small>{t("Кнопка отправки, переключатели и выбранное")}</small>
            </div>
            <AccentPicker />
          </div>
        </div>
      </section>
      <section className="set">
        <h2>{t("Выход")}</h2>
        <div className="set-body">
          <button className="btn btn-line" type="button" onClick={() => signOut({ callbackUrl: "/auth/signin" })}>
            {t("Выйти из аккаунта")}
          </button>
        </div>
      </section>
      {isAdmin ? (
        <p className="set-admin">
          <Link className="link" href="/dashboard/admin">
            {t("Админ-панель")}
          </Link>
        </p>
      ) : null}
    </>
  );
}

function SlimeSettings() {
  return (
    <>
      <ChatSection />
      <Reminders />
    </>
  );
}

const SECTIONS: { key: SettingsSection; title: string; icon: IconName; lead: string }[] = [
  { key: "profile", title: msg("Профиль"), icon: "user", lead: msg("Аккаунт, кто тебя видит, язык, тема и цвет") },
  { key: "pomodoro", title: msg("Помодоро"), icon: "timer", lead: msg("Ритм таймера, звонок и уведомления") },
  { key: "slime", title: msg("Слайм"), icon: "chat", lead: msg("Чат с тьютором и напоминания") },
];

export function SettingsPanel({
  section,
  onPick,
  onClose,
}: {
  section: SettingsSection;
  onPick: (section: SettingsSection) => void;
  /** Есть только в окне: на странице закрывать нечего. */
  onClose?: () => void;
}) {
  const current = SECTIONS.find((item) => item.key === section) ?? SECTIONS[0];
  return (
    <div className="st">
      <nav className="st-nav" aria-label={t("Разделы настроек")}>
        <p className="st-title">{t("Настройки")}</p>
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="nav-item"
            aria-current={item.key === current.key ? "page" : undefined}
            onClick={() => onPick(item.key)}
          >
            <Icon name={item.icon} />
            <span className="nav-text">{t(item.title)}</span>
          </button>
        ))}
      </nav>
      <div className="st-main">
        <header className="st-head">
          <div>
            <h2>{t(current.title)}</h2>
            <p>{t(current.lead)}</p>
          </div>
          {onClose ? (
            <button className="icon-btn st-close" type="button" aria-label={t("Закрыть настройки")} onClick={onClose}>
              <Icon name="x" />
            </button>
          ) : null}
        </header>
        <div className="st-body" key={current.key}>
          {current.key === "profile" ? <ProfileSettings /> : null}
          {current.key === "pomodoro" ? <PomodoroSettings /> : null}
          {current.key === "slime" ? <SlimeSettings /> : null}
        </div>
      </div>
    </div>
  );
}
