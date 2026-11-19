// Окно настроек открывается откуда угодно: из меню аккаунта, шестерёнкой у таймера.
// Само окно одно и живёт в каркасе кабинета.

import { create } from "zustand";

export type SettingsSection = "profile" | "pomodoro" | "slime";

interface SettingsDialogState {
  open: boolean;
  section: SettingsSection;
  show: (section?: SettingsSection) => void;
  hide: () => void;
  pick: (section: SettingsSection) => void;
}

export const useSettingsDialog = create<SettingsDialogState>((set) => ({
  open: false,
  section: "profile",
  show: (section) => set((state) => ({ open: true, section: section ?? state.section })),
  hide: () => set({ open: false }),
  pick: (section) => set({ section }),
}));

export const openSettings = (section?: SettingsSection) => useSettingsDialog.getState().show(section);
