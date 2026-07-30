// Глобальное состояние помодоро-таймера.
//
// Таймер живёт в сторе, а не в компоненте страницы, потому что обратный отсчёт
// показывается в шапке на всех страницах дашборда и не должен сбрасываться при
// переходе между разделами.
//
// Отсчёт ведётся от абсолютного дедлайна (`endsAt`), а не декрементом счётчика:
// в свёрнутой вкладке браузер троттлит `setInterval`, и посекундное уменьшение
// начало бы отставать от реального времени.

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_PRESET_INDEX,
  MIN_LOGGED_SECONDS,
  type FocusSessionPayload,
  type PomodoroPhase,
  phaseDurationSeconds,
  presetAt,
} from "@/lib/pomodoro";

const STORAGE_KEY = "timely:pomodoro:v3";

/** Сессия, дождавшаяся отправки на бэкенд. */
export interface PendingSession extends FocusSessionPayload {
  /** Локальный идентификатор, чтобы убрать запись из очереди после отправки. */
  localId: string;
}

interface PomodoroState {
  presetIdx: number;
  phase: PomodoroPhase;
  running: boolean;
  /** Момент окончания текущей фазы, epoch ms. Заполнен, только когда идёт отсчёт. */
  endsAt: number | null;
  /** Остаток на паузе, секунды. */
  remainingWhenPaused: number;
  /** Когда фаза началась по стенным часам — уходит в `started_at` сессии. */
  phaseStartedAt: number | null;
  cycles: number;
  pending: PendingSession[];
  /** Тик от `PomodoroSync`; не персистится. */
  nowTs: number;
  /** Растёт после каждой удачной отправки — сигнал странице обновить данные. */
  syncedAt: number;

  toggle: () => void;
  reset: () => void;
  skip: () => void;
  choosePreset: (index: number) => void;
  completePhase: (natural: boolean) => void;
  tick: () => void;
  /** Убирает отправленные сессии из очереди и будит подписчиков. */
  dropPending: (localIds: string[]) => void;
}

function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Остаток текущей фазы в секундах. */
export function selectRemaining(state: PomodoroState): number {
  if (state.running && state.endsAt !== null) {
    return Math.max(0, Math.ceil((state.endsAt - state.nowTs) / 1000));
  }
  return state.remainingWhenPaused;
}

/** Длина текущей фазы в секундах. */
export function selectPlanned(state: PomodoroState): number {
  return phaseDurationSeconds(state.presetIdx, state.phase);
}

/** Сколько уже отработано в текущей фазе. */
export function selectElapsed(state: PomodoroState): number {
  return Math.max(0, selectPlanned(state) - selectRemaining(state));
}

/** Таймер начат, если идёт отсчёт или фаза уже частично пройдена. */
export function selectHasStarted(state: PomodoroState): boolean {
  return state.running || selectElapsed(state) > 0;
}

export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      presetIdx: DEFAULT_PRESET_INDEX,
      phase: "focus",
      running: false,
      endsAt: null,
      remainingWhenPaused: phaseDurationSeconds(DEFAULT_PRESET_INDEX, "focus"),
      phaseStartedAt: null,
      cycles: 0,
      pending: [],
      nowTs: 0,
      syncedAt: 0,

      toggle: () => {
        const state = get();
        const now = Date.now();

        if (state.running) {
          set({
            running: false,
            endsAt: null,
            remainingWhenPaused: selectRemaining({ ...state, nowTs: now }),
          });
          return;
        }

        set({
          running: true,
          nowTs: now,
          endsAt: now + state.remainingWhenPaused * 1000,
          phaseStartedAt: state.phaseStartedAt ?? now,
        });
      },

      reset: () => {
        const state = get();
        set({
          running: false,
          endsAt: null,
          remainingWhenPaused: selectPlanned(state),
          phaseStartedAt: null,
        });
      },

      skip: () => get().completePhase(false),

      choosePreset: (index) => {
        set({
          presetIdx: index,
          phase: "focus",
          running: false,
          endsAt: null,
          remainingWhenPaused: phaseDurationSeconds(index, "focus"),
          phaseStartedAt: null,
          cycles: 0,
        });
      },

      completePhase: (natural) => {
        const state = get();
        const now = Date.now();
        const preset = presetAt(state.presetIdx);
        const planned = selectPlanned(state);
        const worked = Math.min(
          planned,
          Math.max(0, planned - selectRemaining({ ...state, nowTs: now })),
        );

        const pending =
          worked >= MIN_LOGGED_SECONDS
            ? state.pending.concat({
                localId: makeLocalId(),
                kind: state.phase,
                started_at: new Date(state.phaseStartedAt ?? now).toISOString(),
                seconds: Math.round(worked),
                planned_seconds: planned,
                preset_focus_min: preset.focus,
                preset_break_min: preset.brk,
              })
            : state.pending;

        const nextPhase: PomodoroPhase =
          state.phase === "focus" ? "break" : "focus";
        const nextPlanned = phaseDurationSeconds(state.presetIdx, nextPhase);

        set({
          pending,
          phase: nextPhase,
          cycles: state.phase === "focus" ? state.cycles + 1 : state.cycles,
          // Фаза, дошедшая до нуля сама, сразу запускает следующую;
          // нажатие «Дальше» оставляет таймер на паузе.
          running: natural,
          nowTs: now,
          endsAt: natural ? now + nextPlanned * 1000 : null,
          remainingWhenPaused: nextPlanned,
          phaseStartedAt: natural ? now : null,
        });
      },

      tick: () => {
        const state = get();
        const now = Date.now();
        set({ nowTs: now });

        if (!state.running || state.endsAt === null) return;
        if (now >= state.endsAt) {
          get().completePhase(true);
        }
      },

      dropPending: (localIds) => {
        if (!localIds.length) return;
        const drop = new Set(localIds);
        set({
          pending: get().pending.filter((item) => !drop.has(item.localId)),
          syncedAt: Date.now(),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        presetIdx: state.presetIdx,
        phase: state.phase,
        running: state.running,
        endsAt: state.endsAt,
        remainingWhenPaused: state.remainingWhenPaused,
        phaseStartedAt: state.phaseStartedAt,
        cycles: state.cycles,
        pending: state.pending,
      }),
      onRehydrateStorage: () => (state) => {
        // После перезагрузки страницы сразу подтягиваем реальное «сейчас»,
        // иначе первый кадр покажет остаток на момент сохранения.
        state?.tick();
      },
    },
  ),
);
