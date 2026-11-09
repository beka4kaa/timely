"use client";

// Школьное расписание для карточек тьютора. Страница редактора ходит сюда же, в `/api/diary/template`.

import { dataChanged } from "@/lib/data-changed";
import { invalidateResources } from "@/lib/resource-cache";
import type { TemplateLessonSlot, WeeklyTemplate } from "@/types/diary";

const TEMPLATE_URL = "/api/diary/template";

async function saved(response: Response): Promise<WeeklyTemplate> {
  if (!response.ok) throw new Error(`Расписание не сохранилось (${response.status})`);
  return response.json() as Promise<WeeklyTemplate>;
}

function send(method: "POST" | "PUT", body: unknown): Promise<Response> {
  return fetch(TEMPLATE_URL, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function activeTemplate(): Promise<WeeklyTemplate | null> {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error(`Расписание не загрузилось (${response.status})`);
  return ((await response.json()) as { active: WeeklyTemplate | null }).active;
}

export async function saveTemplateSlots(id: string, slots: TemplateLessonSlot[]): Promise<WeeklyTemplate> {
  return saved(await send("PUT", { id, slots }));
}

/** Новое расписание сразу становится действующим. */
export async function createActiveTemplate(slots: TemplateLessonSlot[]): Promise<WeeklyTemplate> {
  return saved(await send("POST", { name: "Школьное расписание", slots }));
}

export async function removeTemplate(id: string): Promise<void> {
  const response = await fetch(`${TEMPLATE_URL}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Расписание не удалилось (${response.status})`);
}

/**
 * Неделя без записей сама соберётся из нового расписания при следующем чтении. `POST /api/diary/week`
 * здесь не нужен и опасен: он сбрасывает оценки и задания недели.
 */
export function timetableChanged(): void {
  invalidateResources("now:diary:");
  dataChanged("diary");
  dataChanged("timetable");
}
