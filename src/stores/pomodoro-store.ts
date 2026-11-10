// Глобальное состояние помодоро-таймера.
//
// Таймер живёт в сторе, а не в компоненте страницы, потому что обратный отсчёт,
// звонок и заголовок вкладки работают на всех страницах дашборда и не должны
// сбрасываться при переходе между разделами.
//
// Отсчёт ведётся от абсолютного дедлайна (`endsAt`), а не декрементом счётчика:
// в свёрнутой вкладке браузер троттлит таймеры, и посекундное уменьшение начало бы
// отставать от реального времени. Сами переходы между фазами описаны чистыми
// функциями в `pomodoro-cycle.ts`, здесь только время, очередь сессий и хранение.

import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";

import { CUSTOM_PRESET, DEFAULT_PRESET_INDEX, type FocusSessionPayload, type Rhythm } from "@/lib/pomodoro";
import {
  advanceCore,
  dismissCore,
  finishCore,
  focusCore,
  freshCore,
  isRhythm,
  mergeSaved,
  migrateSaved,
  pauseCore,
  plannedOf,
  remainingOf,
  replanCore,
  resetCore,
  rhythmOf,
  startCore,
  type TimerCore,
} from "@/lib/pomodoro-cycle";

export const POMODORO_STORAGE_KEY = "timely:pomodoro:v3";
/** 1: длинные перерывы, свой ритм, звонок и уведомления. */
export const POMODORO_STORAGE_VERSION = 1;

/** Сессия, дождавшаяся отправки на бэкенд. */
export interface PendingSession extends FocusSessionPayload {
  /** Локальный идентификатор, чтобы убрать запись из очереди после отправки. */
  localId: string;
}

/** Настройки таймера. Живут в браузере, как и выбранный ритм. */
export interface PomodoroPrefs {
  /** Свой ритм. `null`, пока ученик его не задавал. */
  custom: Rhythm | null;
  autoBreak: boolean;
  autoFocus: boolean;
  sound: boolean;
  /** Громкость звонка, 0..1. */
  volume: number;
  notify: boolean;
  /** Разрешение на уведомления уже спрашивали по «Начать»: второй раз не пристаём. */
  notifyAsked: boolean;
}

interface PomodoroState extends TimerCore, PomodoroPrefs {
  /** Индекс в `PRESETS` или `CUSTOM_PRESET`. */
  presetIdx: number;
  pending: PendingSession[];
  /** Тик от `PomodoroSync`; не персистится. */
  nowTs: number;
  /**
   * Растёт после каждой удачной отправки — сигнал странице обновить данные. Хранится
   * вместе с таймером: отправляет ведущая вкладка, а обновиться должны все.
   */
  syncedAt: number;
  /** Конец какой фазы уже показан уведомлением. Общий для вкладок, чтобы не было второго. */
  notifiedAt: number | null;
  /** Эта вкладка ведёт таймер: заканчивает фазы, отправляет сессии и шлёт уведомления. */
  leader: boolean;

  toggle: () => void;
  reset: () => void;
  skip: () => void;
  /** Ритм из готовых. Идущая фаза не сбрасывается: её прошедшее время сохраняется. */
  choosePreset: (index: number) => void;
  /** «Своё»: последний свой ритм или, в первый раз, копия текущего. */
  chooseCustom: () => void;
  setCustom: (rhythm: Rhythm) => void;
  /** «Фокус на N мин» с главной: выбрать ритм, перейти на фокус и сразу начать. */
  startFocus: (index: number) => void;
  /** «Тихо»: звонок и мигание прекращаются, следующая фаза ждёт клика. */
  dismissAlarm: () => void;
  markNotified: (at: number) => void;
  setPrefs: (prefs: Partial<Omit<PomodoroPrefs, "custom">>) => void;
  setLeader: (leader: boolean) => void;
  tick: () => void;
  /** Убирает отправленные сессии из очереди и будит подписчиков. */
  dropPending: (localIds: string[]) => void;
}

function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function coreOf(state: TimerCore): TimerCore {
  return {
    phase: state.phase,
    running: state.running,
    endsAt: state.endsAt,
    remainingWhenPaused: state.remainingWhenPaused,
    phaseRhythm: state.phaseRhythm,
    phaseStartedAt: state.phaseStartedAt,
    done: state.done,
    idleSince: state.idleSince,
    alarm: state.alarm,
  };
}

/** Ритм, по которому идёт таймер. Ссылка стабильна, пока ритм не меняли. */
export function selectRhythm(state: PomodoroState): Rhythm {
  return rhythmOf(state.presetIdx, state.custom);
}

/** Остаток текущей фазы в секундах. */
export function selectRemaining(state: PomodoroState): number {
  return remainingOf(state, state.nowTs);
}

/** Длина текущей фазы в секундах: по ритму, с которым она началась. */
export function selectPlanned(state: PomodoroState): number {
  return plannedOf(state);
}

/** Сколько уже отработано в текущей фазе. */
export function selectElapsed(state: PomodoroState): number {
  return Math.max(0, selectPlanned(state) - selectRemaining(state));
}

/** Таймер начат, если идёт отсчёт или фаза уже частично пройдена. */
export function selectHasStarted(state: PomodoroState): boolean {
  return state.running || selectElapsed(state) > 0;
}

/** Фаза кончилась и ждёт клика: звонок, «Тихо» и мигающий заголовок. */
export function selectWaiting(state: PomodoroState): boolean {
  return state.alarm !== null && !state.alarm.auto;
}

const DEFAULT_RHYTHM = rhythmOf(DEFAULT_PRESET_INDEX, null);

/**
 * localStorage, который пишет только настоящие изменения.
 *
 * Тик каждую секунду меняет `nowTs`, а сохраняемая часть остаётся той же. Обычное
 * хранилище переписывало бы её каждую секунду, и вкладка, ещё не получившая чужую
 * запись, затирала бы её своим старым состоянием. Здесь запись повторяет то, что
 * вкладка уже видела, и поэтому просто пропускается.
 */
function sharedStorage<S>(): PersistStorage<S> {
  let known: string | null = null;
  return {
    getItem: (name) => {
      try {
        known = window.localStorage.getItem(name);
        return known ? JSON.parse(known) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        const raw = JSON.stringify(value);
        if (raw === known) return;
        known = raw;
        window.localStorage.setItem(name, raw);
      } catch {
        // Приватный режим или нет места: таймер идёт, просто не переживёт перезагрузку.
      }
    },
    removeItem: (name) => {
      try {
        known = null;
        window.localStorage.removeItem(name);
      } catch {
        // То же.
      }
    },
  };
}


export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => {
      /** Новый ритм: нетронутая фаза сразу берёт новую длину, начатая доходит в своей. */
      const applyRhythm = (presetIdx: number, custom: Rhythm | null) => {
        const state = get();
        set({ presetIdx, custom, ...replanCore(coreOf(state), rhythmOf(presetIdx, custom)), nowTs: Date.now() });
      };

      /** Конец фазы: новое состояние и, если было что, сессия в очередь на сервер. */
      const commit = (result: { core: TimerCore; log: FocusSessionPayload | null }, now: number) => {
        const pending = get().pending;
        set({
          ...result.core,
          pending: result.log ? pending.concat({ ...result.log, localId: makeLocalId() }) : pending,
          nowTs: now,
        });
      };

      return {
        presetIdx: DEFAULT_PRESET_INDEX,
        ...freshCore(DEFAULT_RHYTHM),
        custom: null,
        autoBreak: false,
        autoFocus: false,
        sound: true,
        volume: 1,
        notify: true,
        notifyAsked: false,
        pending: [],
        nowTs: 0,
        syncedAt: 0,
        notifiedAt: null,
        leader: false,

        toggle: () => {
          const state = get();
          const now = Date.now();
          const core = coreOf(state);
          set({
            ...(state.running ? pauseCore(core, now) : startCore(core, selectRhythm(state), now)),
            nowTs: now,
          });
        },

        reset: () => {
          const state = get();
          const now = Date.now();
          set({ ...resetCore(coreOf(state), selectRhythm(state), now), nowTs: now });
        },

        skip: () => {
          const state = get();
          const now = Date.now();
          commit(finishCore(coreOf(state), selectRhythm(state), state, now, false), now);
        },

        choosePreset: (index) => applyRhythm(index, get().custom),

        chooseCustom: () => {
          const state = get();
          applyRhythm(CUSTOM_PRESET, isRhythm(state.custom) ? state.custom : { ...selectRhythm(state) });
        },

        setCustom: (rhythm) => applyRhythm(CUSTOM_PRESET, rhythm),

        startFocus: (index) => {
          applyRhythm(index, get().custom);
          const state = get();
          const now = Date.now();
          const rhythm = selectRhythm(state);
          set({ ...startCore(focusCore(coreOf(state), rhythm, now), rhythm, now), nowTs: now });
        },

        dismissAlarm: () => {
          const core = coreOf(get());
          const next = dismissCore(core);
          if (next !== core) set(next);
        },

        markNotified: (at) => {
          if (get().notifiedAt !== at) set({ notifiedAt: at });
        },

        setPrefs: (prefs) => set(prefs),

        setLeader: (leader) => {
          if (get().leader !== leader) set({ leader });
        },

        tick: () => {
          const state = get();
          const now = Date.now();
          // Фазы заканчивает только ведущая вкладка, иначе две вкладки записали бы
          // одну сессию дважды. Остальные просто показывают время и ждут синхронизации.
          if (!state.leader) {
            set({ nowTs: now });
            return;
          }
          const core = coreOf(state);
          const result = advanceCore(core, selectRhythm(state), state, now);
          if (result.core === core && !result.log) {
            set({ nowTs: now });
            return;
          }
          commit(result, now);
        },

        dropPending: (localIds) => {
          if (!localIds.length) return;
          const drop = new Set(localIds);
          set({
            pending: get().pending.filter((item) => !drop.has(item.localId)),
            syncedAt: Date.now(),
          });
        },
      };
    },
    {
      name: POMODORO_STORAGE_KEY,
      version: POMODORO_STORAGE_VERSION,
      storage: sharedStorage(),
      migrate: (persisted, version) => migrateSaved(persisted, version) as unknown as PomodoroState,
      merge: (persisted, current) => mergeSaved(persisted, current),
      partialize: (state) => ({
        presetIdx: state.presetIdx,
        custom: state.custom,
        phase: state.phase,
        running: state.running,
        endsAt: state.endsAt,
        remainingWhenPaused: state.remainingWhenPaused,
        phaseRhythm: state.phaseRhythm,
        phaseStartedAt: state.phaseStartedAt,
        done: state.done,
        idleSince: state.idleSince,
        alarm: state.alarm,
        pending: state.pending,
        syncedAt: state.syncedAt,
        notifiedAt: state.notifiedAt,
        autoBreak: state.autoBreak,
        autoFocus: state.autoFocus,
        sound: state.sound,
        volume: state.volume,
        notify: state.notify,
        notifyAsked: state.notifyAsked,
      }),
      onRehydrateStorage: () => (state) => {
        // После перезагрузки страницы и после записи из другой вкладки сразу подтягиваем
        // реальное «сейчас», иначе первый кадр покажет остаток на момент сохранения.
        state?.tick();
      },
    },
  ),
);
