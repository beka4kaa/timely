// Цели на сервере: обычный CRUD. `bulk_sync` здесь нет намеренно: это полная замена,
// и все цели, которых нет в запросе, он отправляет в архив.

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";

import { mapGoal, type Goal, type GoalScope, type Tone } from "./goal-logic";

const BASE = `${BACKEND_URL}/api/goals`;

async function readGoal(response: Response): Promise<Goal> {
  if (!response.ok) throw new Error(`goals: ${response.status}`);
  return mapGoal(await response.json());
}

export async function listGoals(): Promise<Goal[]> {
  const response = await authFetch(`${BASE}/`);
  if (!response.ok) throw new Error(`goals: ${response.status}`);
  const rows: unknown = await response.json();
  return Array.isArray(rows) ? rows.map(mapGoal) : [];
}

export interface GoalFields {
  title?: string;
  scope?: GoalScope;
  tone?: Tone;
  dueDate?: string | null;
  lessons?: string[];
  status?: string;
  progress?: number;
  isMain?: boolean;
}

export async function createGoal(fields: GoalFields & { title: string }): Promise<Goal> {
  return readGoal(
    await authFetch(`${BASE}/`, {
      method: "POST",
      body: JSON.stringify({ type: "goal", status: "active", ...fields }),
    }),
  );
}

export async function updateGoal(id: string, fields: GoalFields): Promise<Goal> {
  return readGoal(await authFetch(`${BASE}/${id}/`, { method: "PATCH", body: JSON.stringify(fields) }));
}

export async function moveGoalProgress(id: string, progress: number): Promise<Goal> {
  return readGoal(
    await authFetch(`${BASE}/${id}/progress/`, { method: "PATCH", body: JSON.stringify({ progress }) }),
  );
}
