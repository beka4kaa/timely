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
