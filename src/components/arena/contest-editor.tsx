"use client";

// Редактор контеста в админке. Слева форма: тир, рисунок, название, описание, даты
// в календаре, задачи с PDF, ответом и баллами. Справа плашка, какой её увидят ученики,
// и куда она встанет в сетке. Черновик сохраняется как угодно, публикация проверяет
// правила; сервер проверяет их ещё раз сам.

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import {
  ContestApiError,
  createAdminContest,
  deleteAdminContest,
  listAdminContests,
  publishAdminContest,
  unpublishAdminContest,
  updateAdminContest,
  type AdminContest,
  type ContestFileInfo,
  type ContestProblem,
} from "@/lib/contest-api";
import {
  MAX_TASKS,
  draftFromAdmin,
  draftToInput,
  durationLabel,
  emptyDraft,
  emptyTask,
  pointsBudget,
  publishBlockers,
  type ContestDraft,
  type TaskDraft,
} from "@/lib/contest-form";
import { layoutContests } from "@/lib/contest-layout";
import { downloadAdminPdf, uploadContestPdf } from "@/lib/contest-pdf";
import { ARTS, TIERS, canSetTier, tierMeta } from "@/lib/contest-tiers";
import { adminBadge, contestStateAt, plaqueOf, type Plaque } from "@/lib/contest-view";
import { invalidateResources, useResource } from "@/lib/resource-cache";

import { ContestArt } from "./contest-art";
import { ContestCard } from "./contest-plaques";
import { DateTimeField } from "./date-time-field";
import { TierEmblem } from "./tier-emblem";

export const ADMIN_CONTESTS_KEY = "compete:admin-contests";

function FileIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M20 21H4" />
    </svg>
  );
}

function FileSlot({ file, busy, disabled, empty, missing, onPick, onOpen }: {
  file: ContestFileInfo | null;
  busy: boolean;
  disabled: boolean;
  empty: string;
  missing?: boolean;
  onPick: (file: File) => void;
  onOpen: (file: ContestFileInfo) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const picker = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      hidden
      onChange={(event) => {
        const picked = event.target.files?.[0];
        event.target.value = "";
        if (picked) onPick(picked);
      }}
    />
  );
  if (busy) {
    return <span className="file-slot is-busy">Загружаю…</span>;
  }
  if (!file) {
    return (
      <>
        {picker}
        <button
          className={`file-slot is-empty${missing ? " is-missing" : ""}`}
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <UploadIcon />
          {empty}
        </button>
      </>
    );
  }
  return (
    <span className="file-slot">
      {picker}
      <button className="file-name" type="button" title="Открыть PDF" onClick={() => onOpen(file)}>
        <FileIcon />
        <span>{file.name}</span>
      </button>
      {disabled ? null : (
        <button className="file-swap" type="button" title="Заменить PDF" aria-label="Заменить PDF" onClick={() => input.current?.click()}>
          <UploadIcon />
        </button>
      )}
    </span>
  );
}

function Problems({ items }: { items: ContestProblem[] }) {
  if (!items.length) return null;
  return (
    <ul className="ed-problems" role="alert">
      {items.map((item, index) => (
        <li key={`${item.code}-${index}`}>{item.message}</li>
      ))}
    </ul>
  );
}

export function ContestEditor({ initial, canTopTiers, now }: {
  initial?: AdminContest;
  canTopTiers: boolean;
  now: Date;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<AdminContest | undefined>(initial);
  const [draft, setDraft] = useState<ContestDraft>(() => (initial ? draftFromAdmin(initial) : emptyDraft(new Date())));
  const [busy, setBusy] = useState<"save" | "publish" | "unpublish" | "delete" | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [problems, setProblems] = useState<ContestProblem[]>([]);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const others = useResource(ADMIN_CONTESTS_KEY, listAdminContests, { ttl: 60_000 });

  const locked = Boolean(saved?.locked);
  const ended = saved ? contestStateAt(saved, now) === "ended" : false;
  const tier = tierMeta(draft.tier);
  const budget = pointsBudget(draft);
  const blockers = publishBlockers(draft, now, canTopTiers);
  const published = Boolean(saved?.is_published);

  const plaque: Plaque = {
    id: saved?.id ?? 0,
    title: draft.title.trim() || "Название контеста",
    description: draft.description,
    start_time: draft.start.toISOString(),
    end_time: draft.end.toISOString(),
    tier: draft.tier,
    art: draft.art,
    taskCount: draft.tasks.length,
    points: budget.total,
  };
  const where = useMemo(() => {
    const rows: Plaque[] = (others.data ?? [])
      .filter((row) => row.is_published && row.id !== saved?.id)
      .map(plaqueOf);
    rows.push(plaque);
    const layout = layoutContests(rows, now);
    if (layout.hero === plaque) return "Встанет билетом наверху: это ближайший контест.";
    if (layout.next.some((slot) => slot.contest === plaque)) return "Встанет карточкой в ряд следующих контестов.";
    return "Встанет в прошедшие.";
    // plaque собирается заново на каждый рендер, а важны только эти поля.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others.data, saved?.id, draft.start.getTime(), draft.end.getTime(), now]);

  const problemsAt = (field: string) => problems.filter((item) => item.field === field);
  const otherProblems = problems.filter(
    (item) => !["title", "dates", "tier", "art", "tasks"].includes(item.field) && !item.field.startsWith("tasks."),
  );

  const update = (patch: Partial<ContestDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const updateTask = (key: string, patch: Partial<TaskDraft>) =>
    setDraft((current) => ({ ...current, tasks: current.tasks.map((task) => (task.key === key ? { ...task, ...patch } : task)) }));

  function fail(error: unknown, fallback: string) {
    if (error instanceof ContestApiError) {
      setProblems(error.problems);
      setMessage(error.problems.length ? { text: "Проверь отмеченные места.", error: true } : { text: error.message, error: true });
    } else {
      setMessage({ text: fallback, error: true });
    }
  }

  function refreshLists() {
    invalidateResources(ADMIN_CONTESTS_KEY);
    invalidateResources("compete:admin-contest:");
    invalidateResources("compete:contests");
  }

  async function upload(task: TaskDraft, kind: "statement" | "solution", file: File) {
    setUploading(`${task.key}:${kind}`);
    setMessage(null);
    try {
      const info = await uploadContestPdf(file);
      updateTask(task.key, { [kind]: info });
    } catch (error) {
      fail(error, "PDF не загрузился. Попробуй ещё раз.");
    } finally {
      setUploading(null);
    }
  }

  async function open(file: ContestFileInfo) {
    try {
      await downloadAdminPdf(file.id, file.name);
    } catch (error) {
      fail(error, "PDF не открылся.");
    }
  }

  async function persist(): Promise<AdminContest | null> {
    setProblems([]);
    try {
      const input = draftToInput(draft);
      const result = saved ? await updateAdminContest(saved.id, input) : await createAdminContest(input);
      setSaved(result);
      setDraft(draftFromAdmin(result));
      refreshLists();
      return result;
    } catch (error) {
      fail(error, "Не получилось сохранить. Проверь связь.");
      return null;
    }
  }

  async function save() {
    setBusy("save");
    setMessage(null);
    const result = await persist();
    setBusy(null);
    if (!result) return;
    if (!saved) router.replace(`/dashboard/admin/contests/${result.id}`);
    else setMessage({ text: "Сохранено." });
  }

  async function publish() {
    setBusy("publish");
    setMessage(null);
    const stored = await persist();
    if (stored) {
      try {
        const result = await publishAdminContest(stored.id);
        setSaved(result);
        refreshLists();
        setMessage({ text: "Контест опубликован. Ученики уже видят его в сетке." });
        if (!saved) router.replace(`/dashboard/admin/contests/${result.id}`);
      } catch (error) {
        fail(error, "Не получилось опубликовать.");
      }
    }
    setBusy(null);
  }

  async function unpublish() {
    if (!saved) return;
    setBusy("unpublish");
    setMessage(null);
    try {
      const result = await unpublishAdminContest(saved.id);
      setSaved(result);
      refreshLists();
      setMessage({ text: "Контест снова черновик." });
    } catch (error) {
      fail(error, "Не получилось снять с публикации.");
    }
    setBusy(null);
  }

  async function remove() {
    if (!saved || !window.confirm("Удалить контест вместе с задачами и PDF? Вернуть его будет нельзя.")) return;
    setBusy("delete");
    try {
      await deleteAdminContest(saved.id);
      refreshLists();
      router.push("/dashboard/admin");
    } catch (error) {
      fail(error, "Не получилось удалить.");
      setBusy(null);
    }
  }

  const status = saved ? adminBadge(saved, now) : "Новый";

  return (
    <div className="ed">
      <section className="card ed-form" aria-label="Контест">
        <div className="ed-head">
          <h2>{saved ? "Контест" : "Новый контест"}</h2>
          <span className="ed-status">{status}</span>
        </div>
        {locked ? (
          <p className="ed-locked">Контест уже начался: задачи, ответы, баллы, тир и начало не меняются.</p>
        ) : null}

        <span className="ed-label">Тир</span>
        <div className="tier-picks" role="group" aria-label="Тир контеста">
          {TIERS.map((item) => {
            const allowed = canSetTier({ is_staff: canTopTiers }, item.tier);
            return (
              <button
                key={item.tier}
                className={`tier-pick ${item.className}`}
                type="button"
                aria-pressed={draft.tier === item.tier}
                disabled={locked || !allowed}
                title={allowed ? undefined : "Этот тир ставит только владелец"}
                onClick={() => update({ tier: item.tier })}
              >
                <TierEmblem tier={item.tier} />
                <b>{item.name}</b>
                <small>до {item.cap}</small>
              </button>
            );
          })}
        </div>
        <Problems items={problemsAt("tier")} />

        <span className="ed-label">Рисунок</span>
        <div className={`art-picks ${tier.className}`} role="group" aria-label="Рисунок плашки">
          {ARTS.map((item) => (
            <button
              key={item.name}
              className="art-pick"
              type="button"
              aria-pressed={draft.art === item.name}
              aria-label={item.label}
              title={item.label}
              onClick={() => update({ art: item.name })}
            >
              <ContestArt art={item.name} size="mini" />
            </button>
          ))}
        </div>
        <Problems items={problemsAt("art")} />

        <label className="ed-label" htmlFor="contest-title">
          Название
        </label>
        <input
          id="contest-title"
          className="ed-in"
          value={draft.title}
          maxLength={120}
          placeholder="Например, Осенний кубок по математике"
          onChange={(event) => update({ title: event.target.value })}
        />
        <Problems items={problemsAt("title")} />

        <label className="ed-label" htmlFor="contest-description">
          Описание
        </label>
        <textarea
          id="contest-description"
          className="ed-in"
          rows={3}
          maxLength={2000}
          value={draft.description}
          placeholder="Для кого контест, сколько задач и что можно использовать"
          onChange={(event) => update({ description: event.target.value })}
        />

        <div className="ed-two">
          <DateTimeField label="Начало" value={draft.start} disabled={locked} onChange={(start) => update({ start })} />
          <DateTimeField label="Конец" value={draft.end} disabled={ended} onChange={(end) => update({ end })} />
        </div>
        <p className="ed-hint">{durationLabel(draft.start, draft.end)}</p>
        <Problems items={problemsAt("dates")} />

        <span className="ed-label">Задачи</span>
        <div className="tk-head" aria-hidden="true">
          <span />
          <span>Условие, PDF</span>
          <span>Правильный ответ</span>
          <span>Баллы</span>
          <span>Решение, PDF</span>
          <span />
        </div>
        <ol className="tk-list">
          {draft.tasks.map((task, index) => (
            <li key={task.key} className="tk">
              <span className="no">{index + 1}</span>
              <FileSlot
                file={task.statement}
                busy={uploading === `${task.key}:statement`}
                disabled={locked}
                empty="Загрузить PDF"
                missing={!task.statement}
                onPick={(file) => upload(task, "statement", file)}
                onOpen={open}
              />
              <input
                className="ed-in"
                value={task.answer}
                disabled={locked}
                maxLength={300}
                placeholder="Ответ, например 3/4; 0,75"
                aria-label={`Правильный ответ задачи ${index + 1}`}
                onChange={(event) => updateTask(task.key, { answer: event.target.value })}
              />
              <input
                className="ed-in"
                type="number"
                min={1}
                inputMode="numeric"
                value={Number.isFinite(task.points) ? task.points : ""}
                disabled={locked}
                aria-label={`Баллы задачи ${index + 1}`}
                onChange={(event) => updateTask(task.key, { points: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
              />
              <FileSlot
                file={task.solution}
                busy={uploading === `${task.key}:solution`}
                disabled={false}
                empty="Добавить"
                onPick={(file) => upload(task, "solution", file)}
                onOpen={open}
              />
              <button
                className="tk-x"
                type="button"
                disabled={locked}
                aria-label={`Убрать задачу ${index + 1}`}
                onClick={() => update({ tasks: draft.tasks.filter((row) => row.key !== task.key) })}
              >
                ×
              </button>
              {task.legacyText ? <p className="tk-legacy">Старое условие: {task.legacyText}</p> : null}
              <div className="tk-problems">
                <Problems items={problemsAt(`tasks.${index + 1}`)} />
              </div>
            </li>
          ))}
        </ol>
        <button
          className="btn btn-text"
          type="button"
          disabled={locked || draft.tasks.length >= MAX_TASKS}
          onClick={() => update({ tasks: [...draft.tasks, emptyTask()] })}
        >
          Добавить задачу
        </button>
        <Problems items={problemsAt("tasks")} />

        <div className={`budget${budget.over ? " is-over" : ""}`}>
          <div className="budget-row">
            <b>
              {budget.total} из {budget.cap} баллов
            </b>
            <span>
              <TierEmblem tier={draft.tier} />
              {tier.name}
            </span>
          </div>
          <div className="budget-bar">
            <i style={{ width: `${Math.round(budget.share * 100)}%` }} />
          </div>
          {budget.over ? (
            <p>
              На {budget.over} больше, чем даёт {tier.name.toLowerCase()}. Убавь баллы или выбери тир выше.
            </p>
          ) : null}
        </div>

        <Problems items={otherProblems} />
        {!published && blockers.length ? (
          <ul className="ed-blockers" aria-label="Что мешает опубликовать">
            {blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {message ? (
          <p className={`ed-message${message.error ? " is-error" : ""}`} role={message.error ? "alert" : "status"}>
            {message.text}
          </p>
        ) : null}

        <div className="ed-actions">
          {saved?.can_delete ? (
            <button className="btn btn-text ed-delete" type="button" disabled={busy !== null} onClick={remove}>
              Удалить
            </button>
          ) : null}
          {published && !locked ? (
            <button className="btn btn-line" type="button" disabled={busy !== null} onClick={unpublish}>
              Снять с публикации
            </button>
          ) : null}
          <button className="btn btn-line" type="button" disabled={busy !== null} onClick={save}>
            {busy === "save" ? "Сохраняю…" : published ? "Сохранить" : "Сохранить черновик"}
          </button>
          {published ? null : (
            <button className="btn btn-main" type="button" disabled={busy !== null || blockers.length > 0} onClick={publish}>
              {busy === "publish" ? "Публикую…" : "Опубликовать"}
            </button>
          )}
        </div>
      </section>

      <aside className="ed-preview">
        <h3>Так увидят ученики</h3>
        <ContestCard plaque={plaque} now={now} draft={!published} />
        <p className="small-note">{where}</p>
      </aside>
    </div>
  );
}
