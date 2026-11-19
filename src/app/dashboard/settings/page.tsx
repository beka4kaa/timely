"use client";

// Настройки отдельной страницей: то же, что в окне, для ссылок и меню «Ещё» на телефоне.

import { useEffect, useState } from "react";

import { SettingsPanel } from "@/components/settings/settings-panel";
import type { SettingsSection } from "@/stores/settings-dialog";

const KNOWN: SettingsSection[] = ["profile", "pomodoro", "slime"];

export default function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>("profile");

  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("section");
    if (asked && (KNOWN as string[]).includes(asked)) setSection(asked as SettingsSection);
  }, []);

  return (
    <div className="content view st-page">
      <SettingsPanel section={section} onPick={setSection} />
    </div>
  );
}
