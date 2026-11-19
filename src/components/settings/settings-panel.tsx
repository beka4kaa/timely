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
import { setChatPrefs, useChatPrefs } from "@/lib/chat-prefs";
import { updateMe, useMe, type Me } from "@/lib/contest-api";
import type { SettingsSection } from "@/stores/settings-dialog";

const THEMES = [
  { key: "system", title: "Как в системе" },
  { key: "light", title: "Светлая" },
  { key: "dark", title: "Тёмная" },
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
      <h2>Чат с тьютором</h2>
      <div className="set-body">
        <div className="set-line">
          <div>
            Насколько глубоко думать<small>В поле чата: Instant, Medium или High</small>
          </div>
          <Switch
            on={prefs.showPicker}
            label="Показывать выбор Instant, Medium, High"
            onChange={(value) => setChatPrefs({ showPicker: value })}
          />
        </div>
        <div className="set-line">
          <div>
            Контекст и токены
            <small>Окно контекста в поле чата, токены и цена под ответами</small>
          </div>
          <Switch
            on={prefs.showUsage}
            label="Показывать контекст и токены"
            onChange={(value) => setChatPrefs({ showUsage: value })}
          />
        </div>
        <p className="small-note">
          <Link className="link" href="/privacy">
            Что видит тьютор и куда уходят данные
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
    if (mascotOn) mascot.remind("Пора повторить", "Так выглядит напоминание", go);
    if (!pushOn) return;
    try {
      const note = new Notification("Пора повторить", { body: "Так выглядит напоминание", icon: "/logo.svg" });
      note.onclick = () => {
        window.focus();
        go();
      };
    } catch {
      // На телефоне браузер показывает уведомления только из установленного приложения.
      setProblem("Здесь браузер не показывает уведомления из вкладки.");
    }
  };

  let pushHint = "Придут, пока Timely открыт в браузере";
  if (permission === "unsupported") pushHint = "Этот браузер не умеет показывать уведомления";
  if (permission === "denied") pushHint = "Запрещены в настройках браузера. Разреши их там";

  return (
    <section className="set">
      <h2>Напоминания</h2>
      <div className="set-body">
        <div className="set-line">
          <div>
            Через слайма<small>Плашка над ним, когда пора повторить тему</small>
          </div>
          <Switch on={mascotOn} label="Напоминать через слайма" onChange={setMascotOn} />
        </div>
        <div className="set-line">
          <div>
            Уведомления<small>{pushHint}</small>
          </div>
          <Switch
            on={pushOn}
            label="Присылать уведомления браузера"
            disabled={permission === "unsupported" || permission === "denied" || permission === null}
            onChange={(next) => void togglePush(next)}
          />
        </div>
        <div className="ntf" aria-label="Как выглядит уведомление">
          <svg className="ntf-ic" viewBox="0 0 172 122" aria-hidden="true">
            <use href="#art-slime" />
          </svg>
          <div>
            <b>Пора повторить</b>
            <span>Одна тема ждёт повторения</span>
          </div>
          <small>сейчас</small>
        </div>
        <button className="btn btn-line" type="button" disabled={!mascotOn && !pushOn} onClick={tryIt}>
          Пробное уведомление
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
  if (!me) return loading ? " " : "Не загрузилось. Обнови страницу";
  const seen = `«${me.public_username}», страну, баллы и рейтинг по предметам`;
  return me.show_in_leaderboard
    ? `Другие ученики видят ${seen}`
    : `Сейчас тебя видишь только ты. Если включишь, другие увидят ${seen}`;
}

/** Согласие хранит сервер, поэтому тумблер меняется только после его ответа. */
function WhoSeesMe({ me, loading, setMe }: { me: Me | null; loading: boolean; setMe: (me: Me) => void }) {
  const [saving, setSaving] = useState(false);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      setMe(await updateMe({ show_in_leaderboard: next }));
    } catch {
      toast.error("Не сохранилось. Попробуй ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="set">
      <h2>Кто меня видит</h2>
      <div className="set-body">
        <div className="set-line">
          <div>
            Показывать меня в рейтинге
            <small>{ratingHint(me, loading)}</small>
          </div>
          {me ? (
            <Switch
              on={me.show_in_leaderboard}
              label="Показывать меня в рейтинге"
              disabled={saving}
              onChange={(next) => void toggle(next)}
            />
          ) : null}
        </div>
        <div className="set-line">
          <div>
            Группы
            <small>
              В группу вступают только сами, по коду от её создателя. Таблицу видят только участники, а показ в рейтинге
              на группы не влияет
            </small>
          </div>
        </div>
        <p className="small-note">Почту, описание, дни и часы фокуса другие ученики не видят.</p>
      </div>
    </section>
  );
}


function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="tabs" role="group" aria-label="Тема">
      {THEMES.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={mounted && theme === item.key}
          onClick={() => setTheme(item.key)}
        >
          {item.title}
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
    <div className="acc-pick" role="radiogroup" aria-label="Цвет акцента">
      {ACCENTS.map((item) => (
        <button
          key={item.key}
          className="acc-dot"
          type="button"
          role="radio"
          aria-checked={accent === item.key}
          aria-label={item.name}
          title={item.name}
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
  const name = known ?? (meLoading ? "\u00a0" : "Ученик");
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
          Открыть профиль
        </Link>
      </div>
      <WhoSeesMe me={me} loading={meLoading} setMe={setMe} />
      <section className="set">
        <h2>Оформление</h2>
        <div className="set-body">
          <ThemePicker />
          <div className="set-line">
            <div>
              Цвет акцента<small>Кнопка отправки, переключатели и выбранное</small>
            </div>
            <AccentPicker />
          </div>
        </div>
      </section>
      <section className="set">
        <h2>Выход</h2>
        <div className="set-body">
          <button className="btn btn-line" type="button" onClick={() => signOut({ callbackUrl: "/auth/signin" })}>
            Выйти из аккаунта
          </button>
        </div>
      </section>
      {isAdmin ? (
        <p className="set-admin">
          <Link className="link" href="/dashboard/admin">
            Админ-панель
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
  { key: "profile", title: "Профиль", icon: "user", lead: "Аккаунт, кто тебя видит, тема и цвет" },
  { key: "pomodoro", title: "Помодоро", icon: "timer", lead: "Ритм таймера, звонок и уведомления" },
  { key: "slime", title: "Слайм", icon: "chat", lead: "Чат с тьютором и напоминания" },
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
      <nav className="st-nav" aria-label="Разделы настроек">
        <p className="st-title">Настройки</p>
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="nav-item"
            aria-current={item.key === current.key ? "page" : undefined}
            onClick={() => onPick(item.key)}
          >
            <Icon name={item.icon} />
            <span className="nav-text">{item.title}</span>
          </button>
        ))}
      </nav>
      <div className="st-main">
        <header className="st-head">
          <div>
            <h2>{current.title}</h2>
            <p>{current.lead}</p>
          </div>
          {onClose ? (
            <button className="icon-btn st-close" type="button" aria-label="Закрыть настройки" onClick={onClose}>
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
