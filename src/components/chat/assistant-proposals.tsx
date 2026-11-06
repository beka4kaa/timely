"use client";

// Карточки под ответом: что помощник предлагает поменять и кнопка, которая это применяет.
//
// Одни и те же в мини-окне и в чате. Расписание показывают карточки помощника по плану, там
// уже есть diff, ритм и занятое время; остальным хватает простого списка. Несколько предложений
// в одном ответе идут одной карточкой: ученик решает один раз, в конце.

import { useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { CommitmentsCard, RevisionCard, StudyWindowsCard } from "@/components/studyplan/revision-cards";

import { applyAll, dismissAll, undoAll } from "./assistant-batch";
import {
  batchRows,
  canUndoProposal,
  proposalDoneText,
  proposalHeading,
  proposalRows,
  proposalSummary,
  type AssistantProposal,
} from "./assistant-proposal";
import {
  applyProposal,
  dismissProposal,
  isStaleProposalError,
  proposalFailureText,
  undoProposal,
} from "./assistant-proposal-actions";

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
      {proposals.length > 1 ? (
        <BatchCard proposals={proposals} onChange={onChange} />
      ) : (
        <ProposalCard proposal={proposals[0]} onChange={onChange} />
      )}
    </div>
  );
}

const nothing = () => undefined;
const STALE_TEXT = "Это предложение устарело: расписание уже поменялось.";

function BatchCard({ proposals, onChange }: { proposals: AssistantProposal[]; onChange: ProposalChange }) {
  const [busy, setBusy] = useState(false);
  const [applyFailed, setApplyFailed] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const waiting = proposals.filter((item) => !item.state);
  const applied = proposals.filter((item) => item.state === "applied");
  const staleOnes = proposals.filter((item) => item.state === "stale");

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setApplyFailed(null);
    setFailed(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const accept = () =>
    run(async () => {
      const failure = await applyAll(proposals, applyProposal, onChange, isStaleProposalError);
      if (failure) setApplyFailed(proposalFailureText(failure.error, proposalSummary(failure.proposal)));
      else if (waiting.length) mascot.hop(0.7);
    });
  const dismiss = () =>
    run(async () => {
      const failure = await dismissAll(proposals, dismissProposal, onChange, isStaleProposalError);
      if (failure) setFailed(proposalFailureText(failure.error, "Отменить не получилось. Попробуй ещё раз."));
    });
  const revert = () =>
    run(async () => {
      const failure =
        (await undoAll(proposals, undoProposal, onChange, isStaleProposalError)) ??
        // Что ещё ждало решения, после отмены уже не нужно.
        (await dismissAll(proposals, dismissProposal, onChange, isStaleProposalError));
      if (failure) setFailed(proposalFailureText(failure.error, "Вернуть не получилось. Попробуй ещё раз."));
    });

  if (!waiting.length && !applied.length) {
    if (proposals.some((item) => item.state === "undone")) return <p className="q-status">Вернул как было.</p>;
    return staleOnes.length ? <p className="q-status">{STALE_TEXT}</p> : null;
  }

  const canRevert = applied.some(canUndoProposal);
  const revertButton = (
    <button className="btn btn-text" type="button" disabled={busy} onClick={() => void revert()}>
      Вернуть как было
    </button>
  );
  const dismissButton = (
    <button className="btn btn-text" type="button" disabled={busy} onClick={() => void dismiss()}>
      Не надо
    </button>
  );
  const plain = waiting.filter((item) => !["revision", "commitments", "study_windows"].includes(item.kind));

  return (
    <div className="a-prop a-batch">
      {applied.map((item) => (
        <p className="q-status" key={item.id}>
          {proposalDoneText(item)}
        </p>
      ))}
      {staleOnes.map((item) => (
        <p className="q-status" key={item.id}>
          Устарело: {proposalSummary(item)}. Расписание уже поменялось.
        </p>
      ))}
      {waiting.length && applyFailed ? (
        <>
          <p className="q-status" role="alert">
            {applied.length ? `Применено ${applied.length} из ${applied.length + waiting.length}. ` : ""}Не вышло: {applyFailed}
          </p>
          <div className="q-acts">
            <button className="btn btn-main" type="button" disabled={busy} onClick={() => void accept()}>
              Повторить
            </button>
            {canRevert ? revertButton : dismissButton}
            {/* Применённое может и остаться: от сбоя отказывается только то, что не вышло. */}
            {applied.length ? (
              <button className="btn btn-text" type="button" disabled={busy} onClick={() => void dismiss()}>
                Оставить как есть
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {waiting.length && !applyFailed ? (
        <>
          <p className="q-status">Сделаю так:</p>
          {plain.length ? (
            <ul className="q-diff">
              {plain.flatMap(batchRows).map((row, index) => (
                <li key={`${index}-${row.name}`}>
                  <span className="nm">{row.name}</span>
                  {row.note ? <span className="chg">{row.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {waiting.map((item) => (
            <SpecialRows key={item.id} proposal={item} busy={busy} />
          ))}
          <div className="q-acts">
            <button className="btn btn-main" type="button" disabled={busy} onClick={() => void accept()}>
              Применить
            </button>
            {dismissButton}
          </div>
        </>
      ) : null}
      {!waiting.length && canRevert ? <div className="q-acts">{revertButton}</div> : null}
      {failed ? (
        <p className="q-status" role="alert">
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/** Расписание рисует своё: там diff устроен сложнее, чем строка. Кнопка у карточки одна на всех. */
function SpecialRows({ proposal, busy }: { proposal: AssistantProposal; busy: boolean }) {
  if (proposal.kind === "revision") {
    return <RevisionCard revision={proposal.revision} timeZone={proposal.time_zone} busy={busy} hideActions onDecide={nothing} />;
  }
  if (proposal.kind === "commitments") {
    return <CommitmentsCard items={proposal.items} busy={busy} hideActions onAccept={nothing} onDismiss={nothing} />;
  }
  if (proposal.kind === "study_windows") {
    return (
      <StudyWindowsCard
        proposal={{ windows: proposal.windows, replace: proposal.replace, current: proposal.current }}
        busy={busy}
        hideActions
        onAccept={nothing}
        onDismiss={nothing}
      />
    );
  }
  return null;
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
      else setFailed(proposalFailureText(error, failure));
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
    return <p className="q-status">{STALE_TEXT}</p>;
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
