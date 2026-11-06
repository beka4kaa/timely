// Одна кнопка на несколько предложений: запись по очереди и отмена в обратном порядке.
//
// Решение по каждому предложению сохраняется сразу: если связь оборвётся на третьем из четырёх,
// первые два останутся применёнными, а повтор не запишет их во второй раз.

import { canUndoProposal, type AssistantProposal, type ProposalUndo } from "./assistant-proposal";
import type { ProposalChange } from "./assistant-proposals";

export interface BatchFailure {
  proposal: AssistantProposal;
  error: unknown;
}

/**
 * Предложение опоздало: записи больше нет или на него уже ответили. Часть API сообщает статус
 * полем, часть только в тексте ошибки, поэтому смотрим на оба.
 */
export function isStaleError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { isStale, isClosed, status, message } = error as {
    isStale?: boolean;
    isClosed?: boolean;
    status?: unknown;
    message?: unknown;
  };
  if (isStale || isClosed) return true;
  return typeof status === "number" ? status === 404 : /\b404\b/.test(String(message ?? ""));
}

/** Пишет то, что ещё ждёт. Устаревшее пропускает, на первом сбое останавливается. */
export async function applyAll(
  proposals: AssistantProposal[],
  apply: (proposal: AssistantProposal) => Promise<ProposalUndo>,
  onChange: ProposalChange,
  isStale: (error: unknown) => boolean,
): Promise<BatchFailure | null> {
  for (const proposal of proposals) {
    if (proposal.state) continue;
    try {
      onChange(proposal.id, { state: "applied", undo: await apply(proposal) });
    } catch (error) {
      if (!isStale(error)) return { proposal, error };
      onChange(proposal.id, { state: "stale" });
    }
  }
  return null;
}

/** Отменяет применённое с конца: сначала то, что опиралось на предыдущее. */
export async function undoAll(
  proposals: AssistantProposal[],
  undo: (proposal: AssistantProposal) => Promise<void>,
  onChange: ProposalChange,
  isStale: (error: unknown) => boolean,
): Promise<BatchFailure | null> {
  for (const proposal of [...proposals].reverse()) {
    if (proposal.state !== "applied" || !canUndoProposal(proposal)) continue;
    try {
      await undo(proposal);
      onChange(proposal.id, { state: "undone" });
    } catch (error) {
      if (!isStale(error)) return { proposal, error };
      onChange(proposal.id, { state: "stale" });
    }
  }
  return null;
}

/** «Не надо»: только то, что ещё ждёт решения. */
export async function dismissAll(
  proposals: AssistantProposal[],
  dismiss: (proposal: AssistantProposal) => Promise<void>,
  onChange: ProposalChange,
  isStale: (error: unknown) => boolean,
): Promise<BatchFailure | null> {
  for (const proposal of proposals) {
    if (proposal.state) continue;
    try {
      await dismiss(proposal);
      onChange(proposal.id, { state: "dismissed" });
    } catch (error) {
      if (!isStale(error)) return { proposal, error };
      onChange(proposal.id, { state: "stale" });
    }
  }
  return null;
}
