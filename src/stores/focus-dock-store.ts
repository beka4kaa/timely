// Где сейчас показан таймер фокуса.
//
// Таймер один, а мест для него два: пилюля в шапке и панель внутри карточки
// «Сейчас». Пока карточка на экране, таймер живёт в ней, а пилюля прячется —
// два одинаковых обратных отсчёта рядом читались бы как два разных таймера.

import { create } from "zustand";

interface FocusDockState {
  /** Таймер виден в карточке «Сейчас» — пилюле в шапке незачем его повторять. */
  docked: boolean;
  setDocked: (docked: boolean) => void;
}

export const useFocusDock = create<FocusDockState>((set) => ({
  docked: false,
  setDocked: (docked) => set({ docked }),
}));
