"use client";

// Список тем по сроку повторения. Правка живёт за «⋯» у строки, чтобы список оставался
// списком: повторить сейчас, переименовать, подтемы, статус, архив, удалить.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { DueMark } from "@/components/mind/due-mark";
import { cn } from "@/lib/utils";
import {
  REVIEW_GROUPS,
  isDue,
  topicsInGroup,
  whenLabel,
  type WeakSubject,
  type WeakTopic,
} from "@/lib/weak-topics";
import {
  createSubtopic,
  deleteSubtopic,
  deleteTopic,
  patchTopic,
  replaceTopic,
  topicsChanged,
} from "@/lib/weak-topics-api";
import type { TopicStatus } from "@/types/mind";

import type { WeakNotify } from "./weak-note";

const STATUSES: Array<{ value: TopicStatus; label: string }> = [
  { value: "NOT_STARTED", label: "ещё не начал" },
  { value: "MEDIUM", label: "знаю немного" },
  { value: "SUCCESS", label: "знаю хорошо" },
  { value: "MASTERED", label: "усвоено" },
];

function SubtopicEditor({ topic, notify }: { topic: WeakTopic; notify: WeakNotify }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const subtopics = topic.subtopics ?? [];

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      const created = await createSubtopic(topic.id, clean);
      setTitle("");
      topicsChanged((list) =>
        list.map((row) =>
          row.id === topic.id ? { ...row, subtopics: [...(row.subtopics ?? []), created] } : row,
        ),
      );
    } catch {
      notify({ text: "Не получилось добавить подтему", failed: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSubtopic(id);
      topicsChanged((list) =>
        list.map((row) =>
          row.id === topic.id
            ? { ...row, subtopics: (row.subtopics ?? []).filter((sub) => sub.id !== id) }
            : row,
        ),
      );
    } catch {
      notify({ text: "Не получилось удалить подтему", failed: true });
    }
  };

  return (
    <div className="tp-subs">
      {subtopics.length ? (
        <ul>
          {subtopics.map((sub) => (
            <li key={sub.id}>
              <span>{sub.title}</span>
              <button
                className="icon-btn"
                type="button"
                aria-label={`Удалить подтему «${sub.title}»`}
                title="Удалить"
                onClick={() => void remove(sub.id)}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={add}>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Новая подтема"
          aria-label={`Новая подтема темы «${topic.name}»`}
          maxLength={255}
        />
        <button className="btn btn-text" type="submit" disabled={busy || !title.trim()}>
          Добавить
        </button>
      </form>
    </div>
  );
}

function TopicRow({
  topic,
  now,
  open,
  fresh,
  onToggle,
  onAsk,
  onPull,
  notify,
}: {
  topic: WeakTopic;
  now: Date;
  open: boolean;
  fresh: boolean;
  onToggle: () => void;
  onAsk: (topic: WeakTopic) => void;
  onPull: (topic: WeakTopic) => void;
  notify: WeakNotify;
}) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(topic.name);
  const [busy, setBusy] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  // Enter и Esc снимают фокус с поля: потом приходит blur, и второй раз сохранять не надо.
  const settled = useRef(false);
  const due = isDue(topic, now);

  useEffect(() => {
    if (!open) setMode("view");
  }, [open]);

  useEffect(() => {
    if (mode !== "rename") return;
    settled.current = false;
    setName(topic.name);
    renameRef.current?.focus();
    renameRef.current?.select();
    // Только при входе в правку: новое имя с сервера не должно затирать ввод.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const endRename = useCallback(() => {
    setMode("view");
    window.requestAnimationFrame(() => moreRef.current?.focus());
  }, []);

  const saveName = async () => {
    if (settled.current) return;
    settled.current = true;
    const clean = name.trim();
    if (!clean || clean === topic.name) {
      endRename();
      return;
    }
    setBusy(true);
    try {
      replaceTopic(await patchTopic(topic.id, { name: clean }));
    } catch {
      notify({ text: "Не получилось переименовать тему", failed: true });
    } finally {
      setBusy(false);
      endRename();
    }
  };

  const update = async (fields: Partial<WeakTopic>, failure: string) => {
    setBusy(true);
    try {
      replaceTopic(await patchTopic(topic.id, fields));
    } catch {
      notify({ text: failure, failed: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteTopic(topic.id);
      topicsChanged((list) => list.filter((row) => row.id !== topic.id));
      notify({ text: "Тема удалена" });
    } catch {
      notify({ text: "Не получилось удалить тему", failed: true });
      setBusy(false);
    }
  };

  const label = `Тема: ${topic.name}`;
  const when = topic.archived ? "в архиве" : whenLabel(topic.nextReviewAt, now);
  const subject = topic.subjectName ?? "";

  return (
    <li className={cn("tp-row", open && "is-open")}>
      {mode === "rename" ? (
        <form
          className="tp tp-edit"
          data-attach={label}
          onSubmit={(event) => {
            event.preventDefault();
            void saveName();
          }}
        >
          <DueMark due={due} />
          <input
            ref={renameRef}
            type="text"
            value={name}
            disabled={busy}
            maxLength={255}
            aria-label="Название темы"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                settled.current = true;
                endRename();
              }
            }}
          />
          <span className="m s">{subject}</span>
          <span className="m w">{when}</span>
        </form>
      ) : (
        <button
          className={cn("tp", fresh && "fresh", topic.archived && "is-archived")}
          type="button"
          data-attach={label}
          onClick={() => onAsk(topic)}
        >
          <DueMark due={due} />
          <span className="tp-name">{topic.name}</span>
          <span className="m s">{subject}</span>
          <span className="m w">{when}</span>
        </button>
      )}

      <button
        ref={moreRef}
        className="icon-btn tpw-more"
        type="button"
        aria-label={`Действия с темой «${topic.name}»`}
        aria-expanded={open}
        title="Действия"
        onClick={onToggle}
      >
        <Icon name="more" />
      </button>

      {open ? (
        <div className="tp-acts">
          {mode === "delete" ? (
            <div className="tp-bar" role="alert">
              <span className="small-note">Удалить тему вместе с подтемами? Вернуть её не получится.</span>
              <button className="btn btn-text danger" type="button" disabled={busy} onClick={() => void remove()}>
                Удалить
              </button>
              <button className="btn btn-text" type="button" disabled={busy} onClick={() => setMode("view")}>
                Не надо
              </button>
            </div>
          ) : (
            <div className="tp-bar">
              {topic.archived ? (
                <button
                  className="btn btn-text"
                  type="button"
                  disabled={busy}
                  onClick={() => void update({ archived: false }, "Не получилось вернуть тему")}
                >
                  Вернуть из архива
                </button>
              ) : (
                <>
                  <button
                    className="btn btn-text"
                    type="button"
                    onClick={() => {
                      onPull(topic);
                      onToggle();
                    }}
                  >
                    Повторить сейчас
                  </button>
                  <button className="btn btn-text" type="button" onClick={() => setMode("rename")}>
                    Переименовать
                  </button>
                  <label className="tp-know">
                    <span>Как знаю:</span>
                    <select
                      value={topic.status}
                      disabled={busy}
                      onChange={(event) =>
                        void update(
                          { status: event.target.value as TopicStatus },
                          "Не получилось поменять статус",
                        )
                      }
                    >
                      {STATUSES.map((row) => (
                        <option key={row.value} value={row.value}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn btn-text"
                    type="button"
                    disabled={busy}
                    onClick={() => void update({ archived: true }, "Не получилось убрать в архив")}
                  >
                    В архив
                  </button>
                </>
              )}
              <button className="btn btn-text danger" type="button" onClick={() => setMode("delete")}>
                Удалить
              </button>
            </div>
          )}
          {topic.archived ? null : <SubtopicEditor topic={topic} notify={notify} />}
        </div>
      ) : null}
    </li>
  );
}

export function WeakList({
  topics,
  subjects,
  now,
  freshIds,
  onAsk,
  onPull,
  notify,
}: {
  topics: WeakTopic[];
  subjects: WeakSubject[];
  now: Date;
  freshIds: Set<string>;
  onAsk: (topic: WeakTopic) => void;
  onPull: (topic: WeakTopic) => void;
  notify: WeakNotify;
}) {
  const [wanted, setWanted] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const active = useMemo(() => topics.filter((topic) => !topic.archived), [topics]);
  const archived = useMemo(() => topics.filter((topic) => topic.archived), [topics]);

  // Вкладки только у предметов, где есть что показать.
  const tabs = useMemo(() => {
    const names = new Map<string, string>();
    for (const topic of active) {
      if (topic.subject && !names.has(topic.subject)) names.set(topic.subject, topic.subjectName ?? "");
    }
    const order = new Map(subjects.map((subject, index) => [subject.id, index]));
    return Array.from(names, ([id, name]) => ({ id, name })).sort(
      (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
    );
  }, [active, subjects]);

  const filter = tabs.some((tab) => tab.id === wanted) ? wanted : "";
  const shown = filter ? active.filter((topic) => topic.subject === filter) : active;
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  const row = (topic: WeakTopic) => (
    <TopicRow
      key={topic.id}
      topic={topic}
      now={now}
      open={openId === topic.id}
      fresh={freshIds.has(topic.id)}
      onToggle={() => toggle(topic.id)}
      onAsk={onAsk}
      onPull={onPull}
      notify={notify}
    />
  );

  return (
    <>
      {tabs.length > 1 ? (
        <div className="tabs weak-tabs" role="group" aria-label="Предмет">
          <button type="button" aria-pressed={!filter} onClick={() => setWanted("")}>
            Все
          </button>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" aria-pressed={filter === tab.id} onClick={() => setWanted(tab.id)}>
              {tab.name}
            </button>
          ))}
        </div>
      ) : null}

      {REVIEW_GROUPS.map((group) => {
        const rows = topicsInGroup(shown, group.key, now);
        if (!rows.length) return null;
        return (
          <section className="weak-sec" key={group.key}>
            <h2 className={cn("sec", group.key === "late" && "late")}>{group.title}</h2>
            <ul className="card">{rows.map(row)}</ul>
          </section>
        );
      })}

      {archived.length ? (
        <details className="weak-sec weak-archive">
          <summary>В архиве: {archived.length}</summary>
          <ul className="card">{archived.map(row)}</ul>
        </details>
      ) : null}
    </>
  );
}
