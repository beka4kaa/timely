"use client";

// Дата и время контеста: нажатие открывает календарь месяца и время под ним.
// Окно парит над формой, поэтому оно из стекла. Время местное: на сервер уходит UTC.

import * as Popover from "@radix-ui/react-popover";
import { enGB, ru } from "date-fns/locale";
import { useState } from "react";
import { DayPicker } from "react-day-picker";

import { getLocale, t } from "@/lib/i18n";
import { contestDate } from "@/lib/contest-view";

const QUICK_TIMES = ["09:00", "10:00", "11:00", "12:00", "15:00", "18:00"];

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function withTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(date);
  next.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return next;
}

function withDay(date: Date, day: Date): Date {
  const next = new Date(day);
  next.setHours(date.getHours(), date.getMinutes(), 0, 0);
  return next;
}

function CalendarIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function DateTimeField({ label, value, onChange, disabled }: {
  label: string;
  value: Date;
  onChange: (next: Date) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(value);
  const time = hhmm(value);

  return (
    <div className="dt-field">
      <span className="ed-label">{label}</span>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setMonth(value);
        }}
      >
        <Popover.Trigger asChild disabled={disabled}>
          <button className={`dt-btn${open ? " is-open" : ""}`} type="button" aria-label={`${label}: ${contestDate(value.toISOString())}`}>
            <CalendarIcon />
            <span>{contestDate(value.toISOString())}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="dt-pop timely-dashboard-shell" align="start" sideOffset={6} collisionPadding={12}>
            <DayPicker
              mode="single"
              required
              locale={getLocale() === "en" ? enGB : ru}
              weekStartsOn={1}
              showOutsideDays
              month={month}
              onMonthChange={setMonth}
              selected={value}
              onSelect={(day) => day && onChange(withDay(value, day))}
              classNames={{
                root: "dt-cal",
                months: "dt-months",
                month: "dt-month",
                month_caption: "dt-caption",
                caption_label: "dt-caption-label",
                nav: "dt-nav",
                button_previous: "dt-nav-btn",
                button_next: "dt-nav-btn",
                chevron: "dt-chevron",
                month_grid: "dt-grid",
                weekdays: "dt-weekdays",
                weekday: "dt-weekday",
                week: "dt-week",
                day: "dt-day",
                day_button: "dt-day-btn",
                selected: "is-selected",
                today: "is-today",
                outside: "is-outside",
                disabled: "is-disabled",
              }}
            />
            <div className="dt-times" role="group" aria-label={t("Время")}>
              {QUICK_TIMES.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  aria-pressed={quick === time}
                  onClick={() => onChange(withTime(value, quick))}
                >
                  {quick}
                </button>
              ))}
              <input
                className="dt-own"
                type="time"
                value={time}
                aria-label={t("Своё время")}
                onChange={(event) => event.target.value && onChange(withTime(value, event.target.value))}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
