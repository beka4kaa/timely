"use client";

// Карточки под ответом: что помощник предлагает поменять и кнопка, которая это применяет.
//
// Одни и те же в мини-окне и в чате. Расписание показывают карточки помощника по плану, там
// уже есть diff, ритм и занятое время; остальным хватает простого списка.

import { useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { CommitmentsCard, RevisionCard, StudyWindowsCard } from "@/components/studyplan/revision-cards";

import {
  canUndoProposal,
  proposalDoneText,
  proposalHeading,
  proposalRows,
  type AssistantProposal,
} from "./assistant-proposal";
import { applyProposal, dismissProposal, isStaleProposalError, undoProposal } from "./assistant-proposal-actions";

export type ProposalChange = (id: string, patch: Partial<AssistantProposal>) => void;

export function AssistantProposals({
  proposals,
  onChange,
}: {
  proposals: AssistantProposal[] | undefined;
  onChange: ProposalChange;
}) {
  if (!proposals?.length) return null;
  return (
    <div className="a-props">
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} onChange={onChange} />
      ))}
    </div>
  );
}

function ProposalCard({ proposal, onChange }: { proposal: AssistantProposal; onChange: ProposalChange }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /** Запись идёт один раз за нажатие. Устаревшее предложение кнопок больше не показывает. */
  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setFailed(null);
    try {
      await action();
    } catch (error) {
      if (isStaleProposalError(error)) onChange(proposal.id, { state: "stale" });
      else setFailed(failure);
    } finally {
      setBusy(false);
    }
  };

  const accept = () =>
    run(async () => {
      const undo = await applyProposal(proposal);
      onChange(proposal.id, { state: "applied", undo });
      mascot.hop(0.7);
    }, "Применить не получилось. Попробуй ещё раз.");
  const dismiss = () =>
    run(async () => {
      await dismissProposal(proposal);
      onChange(proposal.id, { state: "dismissed" });
    }, "Отменить не получилось. Попробуй ещё раз.");
  const revert = () =>
    run(async () => {
      await undoProposal(proposal);
      onChange(proposal.id, { state: "undone" });
    }, "Вернуть не получилось. Попробуй ещё раз.");

  const error = failed ? (
    <p className="q-status" role="alert">
      {failed}
    </p>
  ) : null;

  if (proposal.state === "dismissed") return null;
  if (proposal.state === "stale") {
    return <p className="q-status">Это предложение устарело: расписание уже поменялось.</p>;
  }
  if (proposal.state === "undone") return <p className="q-status">Вернул как было.</p>;
  if (proposal.state === "applied") {
    return (
      <div className="a-prop">
        <p className="q-status">{proposalDoneText(proposal)}</p>
        {canUndoProposal(proposal) ? (
          <div className="q-acts">
            <button className="btn btn-text" type="button" disabled={busy} onClick={() => void revert()}>
              Вернуть как было
            </button>
          </div>
        ) : null}
        {error}
      </div>
    );
  }

  if (proposal.kind === "revision") {
    return (
      <div className="a-prop">
        <RevisionCard
          revision={proposal.revision}
          timeZone={proposal.time_zone}
          busy={busy}
          onDecide={(_, yes) => void (yes ? accept() : dismiss())}
        />
        {error}
      </div>
    );
  }
  if (proposal.kind === "commitments") {
    return (
      <div className="a-prop">
        <CommitmentsCard items={proposal.items} busy={busy} onAccept={() => void accept()} onDismiss={() => void dismiss()} />
        {error}
      </div>
    );
  }
  if (proposal.kind === "study_windows") {
    return (
      <div className="a-prop">
        <StudyWindowsCard
          proposal={{ windows: proposal.windows, replace: proposal.replace, current: proposal.current }}
          busy={busy}
          onAccept={() => void accept()}
          onDismiss={() => void dismiss()}
        />
        {error}
      </div>
    );
  }

  return (
    <div className="a-prop">
      <p className="q-status">{proposalHeading(proposal)}</p>
      <ul className="q-diff">
        {proposalRows(proposal).map((row) => (
          <li key={`${row.name}-${row.note}`}>
            <span className="nm">{row.name}</span>
            {row.note ? <span className="chg">{row.note}</span> : null}
          </li>
        ))}
      </ul>
      <div className="q-acts">
        <button className="btn btn-main" type="button" disabled={busy} onClick={() => void accept()}>
          Применить
        </button>
        <button className="btn btn-text" type="button" disabled={busy} onClick={() => void dismiss()}>
          Не надо
        </button>
      </div>
      {error}
    </div>
  );
}
