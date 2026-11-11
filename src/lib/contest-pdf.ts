// PDF задач контеста: скачать с токеном и загрузить из админки.
//
// Обычная ссылка не несёт токен, поэтому файл приходит запросом, а браузер сохраняет его
// через временную ссылку на blob. `authFetch` всегда ставит JSON-заголовок, поэтому
// загрузка идёт через `fetch` с заголовками входа и `FormData`.
"use client";

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch, backendAuthHeaders } from "@/lib/auth-fetch";
import { contestReply, type ContestFileInfo } from "@/lib/contest-api";

async function saveBlob(response: Response, fileName: string): Promise<void> {
  if (!response.ok) await contestReply(response);
  const blob = await response.blob();
  const link = document.createElement("a");
  const href = URL.createObjectURL(blob);
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export async function downloadContestPdf(
  contestId: number,
  taskId: number,
  kind: "statement" | "solution",
  fileName: string,
): Promise<void> {
  const response = await authFetch(`${BACKEND_URL}/api/contests/${contestId}/tasks/${taskId}/${kind}/`);
  await saveBlob(response, fileName);
}

export async function downloadAdminPdf(fileId: number, fileName: string): Promise<void> {
  const response = await authFetch(`${BACKEND_URL}/api/admin/contest-files/${fileId}/`);
  await saveBlob(response, fileName);
}

export async function uploadContestPdf(file: File): Promise<ContestFileInfo> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${BACKEND_URL}/api/admin/contest-files/`, {
    method: "POST",
    headers: await backendAuthHeaders(),
    body: form,
  });
  return contestReply<ContestFileInfo>(response);
}
