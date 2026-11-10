"use client";

// Настройки таймера прямо под ним: свой ритм, автостарт, звонок и уведомления.
// Всё хранится в браузере, там же, где выбранный ритм.

import { useEffect, useRef, useState } from "react";

import { ringBell, unlockBell } from "@/lib/pomodoro-bell";
import {
  checkRhythm,
  sessionsWord,
  type Rhythm,
  type RhythmDraft,
  type RhythmErrors,
} from "@/lib/pomodoro-cycle";
import { askNoticePermission, noticePermission, type NoticePermission } from "@/lib/pomodoro-notify";
import { cn } from "@/lib/utils";
import { selectRhythm, usePomodoroStore } from "@/stores/pomodoro-store";

const FIELDS: Array<{ key: keyof Rhythm; label: string; unit: (value: string) => string }> = [
  { key: "focus", label: "Фокус", unit: () => "мин" },
  { key: "brk", label: "Перерыв", unit: () => "мин" },
  { key: "long", label: "Длинный перерыв", unit: () => "мин" },
  // Строкой с длинным перерывом: «Длинный перерыв 30 мин, каждые 4 сессии».
  { key: "every", label: "Каждые", unit: (value) => sessionsWord(Number(value) || 0) },
];

function toDraft(rhythm: Rhythm): RhythmDraft {
  return {
    focus: String(rhythm.focus),
    brk: String(rhythm.brk),
    long: String(rhythm.long),
    every: String(rhythm.every),
  };
}

function sameRhythm(a: Rhythm, b: Rhythm): boolean {
  return a.focus === b.focus && a.brk === b.brk && a.long === b.long && a.every === b.every;
}

export function TimerSettings({ id }: { id: string }) {
  const rhythm = usePomodoroStore(selectRhythm);
  const setCustom = usePomodoroStore((state) => state.setCustom);

  return (
    <section className="fp-set card" id={id} aria-label="Свой ритм и настройки таймера">
      <RhythmFields rhythm={rhythm} onCommit={setCustom} />
      <AutoStartLines />
      <SoundLines />
      <NoticeLine />
    </section>
  );
}

/** Свой ритм: четыре числа, проверяются, когда поле отпускаешь или жмёшь Enter. */
function RhythmFields({ rhythm, onCommit }: { rhythm: Rhythm; onCommit: (rhythm: Rhythm) => void }) {
  const [draft, setDraft] = useState<RhythmDraft>(() => toDraft(rhythm));
  const [errors, setErrors] = useState<RhythmErrors>({});

  // Ритм поменялся снаружи, кнопкой над панелью: поля показывают его. Сравниваем числа,
  // а не объект: запись из другой вкладки приносит тот же ритм новым объектом, и
  // недописанное поле не должно сбрасываться.
  const rhythmKey = `${rhythm.focus}/${rhythm.brk}/${rhythm.long}/${rhythm.every}`;
  const latest = useRef(rhythm);
  latest.current = rhythm;
  useEffect(() => {
    setDraft(toDraft(latest.current));
    setErrors({});
  }, [rhythmKey]);

  const commit = () => {
    const result = checkRhythm(draft);
    setErrors(result.errors);
    if (result.rhythm && !sameRhythm(result.rhythm, rhythm)) onCommit(result.rhythm);
  };

  return (
    <fieldset className="fp-rhythm">
      <legend>Свой ритм</legend>
      <div className="fp-rhythm-grid">
        {FIELDS.map(({ key, label, unit }) => {
          const errorId = `fp-err-${key}`;
          return (
            <label key={key} className={cn("fp-num", errors[key] && "is-bad")}>
              <span>{label}</span>
              <span className="fp-num-in">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  value={draft[key]}
                  aria-label={`${label}, ${unit(draft[key])}`}
                  aria-invalid={errors[key] ? true : undefined}
                  aria-describedby={errors[key] ? errorId : undefined}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value.replace(/\D/g, "") })}
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commit();
                    }
                  }}
                />
                <small>{unit(draft[key])}</small>
              </span>
              {errors[key] ? (
                <em id={errorId} role="alert">
                  {errors[key]}
                </em>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Toggle({
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

function AutoStartLines() {
  const autoBreak = usePomodoroStore((state) => state.autoBreak);
  const autoFocus = usePomodoroStore((state) => state.autoFocus);
  const setPrefs = usePomodoroStore((state) => state.setPrefs);
  return (
    <>
      <div className="set-line">
        <div>
          Сам начинать перерыв<small>Без клика, сразу после фокуса</small>
        </div>
        <Toggle on={autoBreak} label="Сам начинать перерыв" onChange={(value) => setPrefs({ autoBreak: value })} />
      </div>
      <div className="set-line">
        <div>
          Сам начинать фокус<small>Без клика, сразу после перерыва</small>
        </div>
        <Toggle on={autoFocus} label="Сам начинать фокус" onChange={(value) => setPrefs({ autoFocus: value })} />
      </div>
    </>
  );
}

function SoundLines() {
  const sound = usePomodoroStore((state) => state.sound);
  const volume = usePomodoroStore((state) => state.volume);
  const setPrefs = usePomodoroStore((state) => state.setPrefs);
  const stopTest = useRef<(() => void) | null>(null);

  useEffect(() => () => stopTest.current?.(), []);

  const test = () => {
    unlockBell();
    stopTest.current?.();
    stopTest.current = ringBell(volume, 1);
  };

  return (
    <>
      <div className="set-line">
        <div>
          Звук<small>Звонит, пока не нажмёшь «Тихо», но не дольше двух минут</small>
        </div>
        <Toggle
          on={sound}
          label="Звонок в конце фазы"
          onChange={(value) => {
            if (value) unlockBell();
            setPrefs({ sound: value });
          }}
        />
      </div>
      <div className="fp-vol">
        <input
          type="range"
          min={5}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          aria-label="Громкость звонка"
          disabled={!sound}
          onChange={(event) => setPrefs({ volume: Number(event.target.value) / 100 })}
        />
        <button className="btn btn-line" type="button" disabled={!sound} onClick={test}>
          Проверить звук
        </button>
      </div>
    </>
  );
}

/** Разрешение браузера и его смена: в настройках сайта его могли выдать или отозвать. */
function useNoticePermission(): [NoticePermission | null, (value: NoticePermission) => void] {
  const [permission, setPermission] = useState<NoticePermission | null>(null);

  useEffect(() => {
    setPermission(noticePermission());
    let status: PermissionStatus | null = null;
    const update = () => setPermission(noticePermission());
    navigator.permissions
      ?.query({ name: "notifications" })
      .then((result) => {
        status = result;
        status.addEventListener("change", update);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener("change", update);
  }, []);

  return [permission, setPermission];
}

function NoticeLine() {
  const notify = usePomodoroStore((state) => state.notify);
  const setPrefs = usePomodoroStore((state) => state.setPrefs);
  const [permission, setPermission] = useNoticePermission();

  const on = notify && permission === "granted";

  const change = async (next: boolean) => {
    if (!next) {
      setPrefs({ notify: false });
      return;
    }
    setPrefs({ notify: true, notifyAsked: true });
    setPermission(await askNoticePermission());
  };

  let hint = "Придут, пока вкладка с Timely открыта";
  if (permission === "unsupported") hint = "Этот браузер не умеет показывать уведомления";
  if (permission === "denied") hint = "Запрещены в настройках браузера. Разреши их там";

  return (
    <div className="set-line">
      <div>
        Уведомления<small>{hint}</small>
      </div>
      <Toggle
        on={on}
        label="Уведомление в конце фазы"
        disabled={permission === null || permission === "unsupported" || permission === "denied"}
        onChange={(next) => void change(next)}
      />
    </div>
  );
}
