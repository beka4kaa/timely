"use client";

// Настройки: только то, что на самом деле работает.
//
// Стиля помощи, длины занятия, «не беспокоить», тумблеров видимости, памяти тьютора,
// родительского контура и удаления аккаунта на бэкенде пока нет, поэтому этих строк здесь нет.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { initialsOf } from "@/components/shell/sidebar";
import { REMIND_MASCOT_KEY, REMIND_PUSH_KEY } from "@/components/shell/view-tracker";
import { setChatPrefs, useChatPrefs } from "@/lib/chat-prefs";
import { useMe } from "@/lib/contest-api";

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
            Выбор модели<small>В поле чата: GLM 5.3 или 5.3 Flash и уровень рассуждения</small>
          </div>
          <Switch
            on={prefs.showPicker}
            label="Показывать выбор модели"
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

export default function SettingsPage() {
  const { data: session } = useSession();
  const { me, loading: meLoading } = useMe();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const known = session?.user?.name || me?.name || null;
  const name = known ?? (meLoading ? "\u00a0" : "Ученик");
  const email = session?.user?.email || me?.email || "";
  const isAdmin = Boolean(me?.is_admin || me?.is_staff);
  const noAccount = !meLoading && !me;

  return (
    <div className="content view">
      <Link className="back" href="/dashboard/profile">
        Профиль
      </Link>
      <header className="head">
        <h1 className="title">Настройки</h1>
      </header>

      <div className="account">
        <span className="avatar big" aria-hidden="true">
          {known || !meLoading ? initialsOf(name) : null}
        </span>
        <div>
          {name}
          {email ? <small>{email}</small> : null}
        </div>
        <button className="btn btn-text" type="button" onClick={() => signOut({ callbackUrl: "/auth/signin" })}>
          Выйти
        </button>
      </div>

      <div className="sets card">
        <Reminders />
        <ChatSection />

        <section className="set">
          <h2>Кто меня видит</h2>
          <div className="set-body">
            <div className="set-line">
              <div>
                Рейтинг
                <small>
                  {noAccount
                    ? "Тебя там пока нет, поэтому другим ничего не видно"
                    : "Другие ученики видят имя пользователя, страну, баллы и рейтинг по предметам"}
                </small>
              </div>
            </div>
            {noAccount ? null : (
              <div className="set-line">
                <div>
                  Группы<small>Создатель группы может добавить тебя по имени или номеру. Таблицу видят только участники</small>
                </div>
              </div>
            )}
            <p className="small-note">Почту, описание, дни и часы фокуса другие ученики не видят.</p>
          </div>
        </section>

        <section className="set">
          <h2>Оформление</h2>
          <div className="set-body">
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
          </div>
        </section>
      </div>

      {isAdmin ? (
        <p className="set-admin">
          <Link className="link" href="/dashboard/admin">
            Админ-панель
          </Link>
        </p>
      ) : null}
    </div>
  );
}
