"use client";

// Настройки таймера в окне настроек: ритм, автостарт, звонок и уведомления.
// Всё хранится в браузере, там же, где выбранный ритм.

import { useEffect, useRef, useState } from "react";

import { BELL_SOUNDS, bellSoundOf, ringBell, unlockBell, type BellSound } from "@/lib/pomodoro-bell";
import {
  checkRhythm,
  sessionsWord,
  type Rhythm,
  type RhythmDraft,
  type RhythmErrors,
} from "@/lib/pomodoro-cycle";
import { askNoticePermission, noticePermission, type NoticePermission } from "@/lib/pomodoro-notify";
import { Icon } from "@/components/shell/icons";
import { msg, plural, t } from "@/lib/i18n";
import { CUSTOM_PRESET, PRESETS } from "@/lib/pomodoro";
import { cn } from "@/lib/utils";
import { selectRhythm, usePomodoroStore } from "@/stores/pomodoro-store";

const FIELDS: Array<{ key: keyof Rhythm; label: string; unit: (value: string) => string }> = [
  { key: "focus", label: msg("Фокус"), unit: () => t("мин") },
  { key: "brk", label: msg("Перерыв"), unit: () => t("мин") },
  { key: "long", label: msg("Длинный перерыв"), unit: () => t("мин") },
  // Строкой с длинным перерывом: «Длинный перерыв 30 мин, каждые 4 сессии».
  { key: "every", label: msg("Каждые"), unit: (value) => sessionsWord(Number(value) || 0) },
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

/** «каждые 3 блока», «после каждого блока»: как часто приходит длинный отдых. */
function everyWords(every: number): string {
  if (every <= 1) return t("после каждого блока");
  return plural(every, "каждые {n} блок", "каждые {n} блока", "каждые {n} блоков");
}

/** «25 мин фокус, 5 мин отдых. Длинный отдых 15 мин каждые 4 блока». */
export function rhythmWords(rhythm: Rhythm): string {
  return t("{focus} мин фокус, {brk} мин отдых. Длинный отдых {long} мин {every}", {
    focus: rhythm.focus,
    brk: rhythm.brk,
    long: rhythm.long,
    every: everyWords(rhythm.every),
  });
}

/** Раздел «Помодоро» в окне настроек: сначала ритм, потом поведение таймера. */
export function PomodoroSettings() {
  const presetIdx = usePomodoroStore((state) => state.presetIdx);
  const rhythm = usePomodoroStore(selectRhythm);
  const choosePreset = usePomodoroStore((state) => state.choosePreset);
  const chooseCustom = usePomodoroStore((state) => state.chooseCustom);
  const setCustom = usePomodoroStore((state) => state.setCustom);
  const isCustom = presetIdx === CUSTOM_PRESET;

  return (
    <>
      <section className="set">
        <h2>{t("Ритм")}</h2>
        <div className="set-body">
          <RhythmSelect
            presetIdx={presetIdx}
            rhythm={rhythm}
            onPreset={choosePreset}
            onCustom={chooseCustom}
          />
          {isCustom ? <RhythmFields rhythm={rhythm} onCommit={setCustom} /> : null}
          <p className="small-note">{t("Если таймер уже идёт, новый ритм начнётся со следующего блока.")}</p>
        </div>
      </section>
      <section className="set">
        <h2>{t("Запуск")}</h2>
        <div className="set-body">
          <AutoStartLines />
        </div>
      </section>
      <section className="set">
        <h2>{t("Звонок")}</h2>
        <div className="set-body">
          <SoundLines />
          <NoticeLine />
        </div>
      </section>
    </>
  );
}

/** Выпадающий список настроек: закрывается выбором, кликом мимо и Escape, стрелки ходят по пунктам. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      wrapRef.current?.querySelector<HTMLElement>(".st-select")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    wrapRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onItemsKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  const pick = (run: () => void) => {
    run();
    setOpen(false);
  };

  return { open, setOpen, wrapRef, onItemsKey, pick };
}

/**
 * Выбор ритма выпадающим списком: на экране одна строка с текущим ритмом, остальные
 * открываются по нажатию. Закрывается выбором, кликом мимо и Escape.
 */
function RhythmSelect({
  presetIdx,
  rhythm,
  onPreset,
  onCustom,
}: {
  presetIdx: number;
  rhythm: Rhythm;
  onPreset: (index: number) => void;
  onCustom: () => void;
}) {
  const { open, setOpen, wrapRef, onItemsKey, pick } = useDropdown();
  const isCustom = presetIdx === CUSTOM_PRESET;

  return (
    <div className="st-select-wrap" ref={wrapRef}>
      <button
        className="st-select"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <b>{isCustom ? t("Свой") : `${rhythm.focus} / ${rhythm.brk}`}</b>
          <small>{rhythmWords(rhythm)}</small>
        </span>
        <Icon name="chev-d" className="st-select-chev" />
      </button>
      {open ? (
        <div className="menu st-menu" role="listbox" aria-label={t("Ритм таймера")} onKeyDown={onItemsKey}>
          {PRESETS.map((preset, index) => (
            <button
              key={preset.note}
              className="menu-item two"
              type="button"
              role="option"
              aria-checked={presetIdx === index}
              aria-selected={presetIdx === index}
              onClick={() => pick(() => onPreset(index))}
            >
              <b>
                {preset.focus} / {preset.brk}
              </b>
              <small>{rhythmWords(preset)}</small>
              <Icon name="check" className="menu-ok" />
            </button>
          ))}
          <button
            className="menu-item two"
            type="button"
            role="option"
            aria-checked={isCustom}
            aria-selected={isCustom}
            onClick={() => pick(onCustom)}
          >
            <b>{t("Свой")}</b>
            <small>{t("Задать свои минуты")}</small>
            <Icon name="check" className="menu-ok" />
          </button>
        </div>
      ) : null}
    </div>
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
      <legend className="sr-only">{t("Свой ритм")}</legend>
      <div className="fp-rhythm-grid">
        {FIELDS.map(({ key, label, unit }) => {
          const errorId = `fp-err-${key}`;
          return (
            <label key={key} className={cn("fp-num", errors[key] && "is-bad")}>
              <span>{t(label)}</span>
              <span className="fp-num-in">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  value={draft[key]}
                  aria-label={`${t(label)}, ${unit(draft[key])}`}
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
          {t("Сам начинать перерыв")}
          <small>{t("Без клика, сразу после фокуса")}</small>
        </div>
        <Toggle on={autoBreak} label={t("Сам начинать перерыв")} onChange={(value) => setPrefs({ autoBreak: value })} />
      </div>
      <div className="set-line">
        <div>
          {t("Сам начинать фокус")}
          <small>{t("Без клика, сразу после перерыва")}</small>
        </div>
        <Toggle on={autoFocus} label={t("Сам начинать фокус")} onChange={(value) => setPrefs({ autoFocus: value })} />
      </div>
    </>
  );
}

/** Какой звук звенит: выпадающий список, выбор сразу проигрывается один раз. */
function SoundSelect({ value, disabled, onPick }: { value: BellSound; disabled: boolean; onPick: (sound: BellSound) => void }) {
  const { open, setOpen, wrapRef, onItemsKey, pick } = useDropdown();
  const current = BELL_SOUNDS.find((item) => item.key === value) ?? BELL_SOUNDS[0];
  return (
    <div className="st-select-wrap" ref={wrapRef}>
      <button
        className="st-select"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("Звук звонка: {name}", { name: t(current.name) })}
        disabled={disabled}
        onClick={() => setOpen((shown) => !shown)}
      >
        <span>
          <b>{t(current.name)}</b>
          <small>{t(current.note)}</small>
        </span>
        <Icon name="chev-d" className="st-select-chev" />
      </button>
      {open ? (
        <div className="menu st-menu" role="listbox" aria-label={t("Звук звонка")} onKeyDown={onItemsKey}>
          {BELL_SOUNDS.map((item) => (
            <button
              key={item.key}
              className="menu-item two"
              type="button"
              role="option"
              aria-checked={item.key === value}
              aria-selected={item.key === value}
              onClick={() => pick(() => onPick(item.key))}
            >
              <b>{t(item.name)}</b>
              <small>{t(item.note)}</small>
              <Icon name="check" className="menu-ok" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SoundLines() {
  const sound = usePomodoroStore((state) => state.sound);
  const bellSound = usePomodoroStore((state) => bellSoundOf(state.bellSound));
  const volume = usePomodoroStore((state) => state.volume);
  const setPrefs = usePomodoroStore((state) => state.setPrefs);
  const stopTest = useRef<(() => void) | null>(null);

  useEffect(() => () => stopTest.current?.(), []);

  const play = (which: BellSound) => {
    unlockBell();
    stopTest.current?.();
    stopTest.current = ringBell(volume, 1, which, "break");
  };
  const test = () => play(bellSound);

  return (
    <>
      <div className="set-line">
        <div>
          {t("Звук")}
          <small>{t("Звонит, пока не нажмёшь куда угодно, но не дольше двух минут")}</small>
        </div>
        <Toggle
          on={sound}
          label={t("Звонок в конце фазы")}
          onChange={(value) => {
            if (value) unlockBell();
            setPrefs({ sound: value });
          }}
        />
      </div>
      <div className="set-line">
        <div>{t("Какой звук")}</div>
        <SoundSelect
          value={bellSound}
          disabled={!sound}
          onPick={(next) => {
            setPrefs({ bellSound: next });
            play(next);
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
          aria-label={t("Громкость звонка")}
          disabled={!sound}
          onChange={(event) => setPrefs({ volume: Number(event.target.value) / 100 })}
        />
        <button className="btn btn-line" type="button" disabled={!sound} onClick={test}>
          {t("Проверить звук")}
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

  let hint = t("Придут, пока вкладка с Timely открыта");
  if (permission === "unsupported") hint = t("Этот браузер не умеет показывать уведомления");
  if (permission === "denied") hint = t("Запрещены в настройках браузера. Разреши их там");

  return (
    <div className="set-line">
      <div>
        {t("Уведомления")}
        <small>{hint}</small>
      </div>
      <Toggle
        on={on}
        label={t("Уведомление в конце фазы")}
        disabled={permission === null || permission === "unsupported" || permission === "denied"}
        onChange={(next) => void change(next)}
      />
    </div>
  );
}
