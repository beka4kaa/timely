// Темы и предметы для страницы «Слабые темы».
//
// Ходим через обработчики в `src/app/api`: они подставляют токен и переводят поля между
// camelCase и snake_case. `/api/subjects/reorder` и `/api/subtopics/{id}/review` сломаны,
// их здесь нет намеренно.

import { WEAK_TOPICS_KEY } from "@/components/now/now-resources";
import { invalidateResources } from "@/lib/resource-cache";
import type { ReviewRating } from "@/types/mind";
import type { WeakSubject, WeakSubtopic, WeakTopic } from "@/lib/weak-topics";

export const WEAK_PAGE_TOPICS_KEY = "weak:topics";
export const WEAK_PAGE_SUBJECTS_KEY = "weak:subjects";

/**
 * Прокси отвечает 200 и тогда, когда Django ответил ошибкой: тело при этом не список.
 * Без этой проверки отказ выглядел бы как «тем пока нет».
 */
async function listFrom<T>(response: Response, what: string): Promise<T[]> {
  if (!response.ok) throw new Error(`${what} не загрузились (${response.status})`);
  const body = (await response.json()) as T[] | { results?: T[] };
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.results)) return body.results;
  throw new Error(`${what} не загрузились`);
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Запрос не прошёл (${response.status})`);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function fetchAllTopics(): Promise<WeakTopic[]> {
  return listFrom<WeakTopic>(await fetch("/api/topics?filter=all"), "Темы");
}

export async function fetchSubjects(): Promise<WeakSubject[]> {
  return listFrom<WeakSubject>(await fetch("/api/subjects"), "Предметы");
}

export function createSubject(name: string): Promise<WeakSubject> {
  return send("/api/subjects", "POST", { name });
}

export function renameSubject(id: string, name: string): Promise<WeakSubject> {
  return send(`/api/subjects/${encodeURIComponent(id)}`, "PATCH", { name });
}

export function deleteSubject(id: string): Promise<void> {
  return send(`/api/subjects/${encodeURIComponent(id)}`, "DELETE");
}

export function createTopic(fields: { name: string; subjectId: string } & Partial<WeakTopic> & { studyState?: string }): Promise<WeakTopic> {
  return send("/api/topics", "POST", fields);
}

export function patchTopic(id: string, fields: Partial<WeakTopic>): Promise<WeakTopic> {
  return send(`/api/topics/${encodeURIComponent(id)}`, "PATCH", fields);
}

export function deleteTopic(id: string): Promise<void> {
  return send(`/api/topics/${encodeURIComponent(id)}`, "DELETE");
}

export function reviewTopic(id: string, rating: ReviewRating): Promise<WeakTopic> {
  return send(`/api/topics/${encodeURIComponent(id)}/review`, "POST", { rating });
}

export function createSubtopic(topicId: string, title: string): Promise<WeakSubtopic> {
  return send("/api/subtopics", "POST", { topic: topicId, title });
}

export function deleteSubtopic(id: string): Promise<void> {
  return send(`/api/subtopics/${encodeURIComponent(id)}`, "DELETE");
}

/**
 * Темы поменялись. `patch` правит то, что уже на экране: перезагрузка может и упасть.
 * Счётчик в левой панели и главная читают свой список, он тоже устарел.
 */
export function topicsChanged(patch?: (list: WeakTopic[]) => WeakTopic[]) {
  invalidateResources<WeakTopic[]>(WEAK_PAGE_TOPICS_KEY, patch);
  invalidateResources(WEAK_TOPICS_KEY);
}

export function subjectsChanged(patch?: (list: WeakSubject[]) => WeakSubject[]) {
  invalidateResources<WeakSubject[]>(WEAK_PAGE_SUBJECTS_KEY, patch);
}

/** Строка заменяется ответом сервера. */
export function replaceTopic(updated: WeakTopic) {
  topicsChanged((list) => list.map((topic) => (topic.id === updated.id ? updated : topic)));
}
