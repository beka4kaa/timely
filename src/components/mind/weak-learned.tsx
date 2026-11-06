"use client";

// Строка «Что сегодня изучил?»: человек пишет своими словами, разбор предлагает темы,
// а записываются они только после «Добавить» (CLAUDE.md §3.3).

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { useSmoothInput } from "@/components/shell/smooth-input";
import { plural } from "@/lib/mind-srs";
import { understand, type Understood } from "@/lib/understand";
import {
  buildDrafts,
  draftHasSubject,
  exactSubject,
  firstReviewFields,
  type TopicDraft,
  type WeakSubject,
  type WeakTopic,
} from "@/lib/weak-topics";
import {
  createSubject,
  createTopic,
  deleteSubject,
  deleteTopic,
  fetchSubjects,
  subjectsChanged,
  topicsChanged,
} from "@/lib/weak-topics-api";

const PLACEHOLDER = "Что сегодня изучил? Напиши своими словами, темы заполню сам";
const PLACEHOLDER_SHORT = "Что сегодня изучил?";
/** Сколько висит «Записал» с возможностью вернуть. */
const SAVED_MS = 20_000;
/** Выбор в списке предметов, после которого появляется поле для своего названия. */
const OTHER = "__other";

type Phase =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "preview"; drafts: TopicDraft[]; text: string; saving: boolean; failed: string | null }
  | { kind: "other"; understood: Exclude<Understood, { kind: "topics" }>; text: string }
  | { kind: "saved"; topics: WeakTopic[]; subjects: WeakSubject[]; skipped: number; undoing: boolean };

function SubjectPick({
  draft,
  subjects,
  onChange,
  onChosen,
}: {
  draft: TopicDraft;
  subjects: WeakSubject[];
  onChange: (patch: Pick<TopicDraft, "subjectId" | "newSubject">) => void;
  /** Выбор закончен: можно подставить его другим темам без предмета. */
  onChosen: (patch: Pick<TopicDraft, "subjectId" | "newSubject">) => void;
}) {
  // Своё название пишут сразу, если выбирать пока не из чего.
  const [typing, setTyping] = useState(subjects.length === 0);
  const newName = draft.newSubject.trim();
  const value = draft.subjectId || (newName ? `new:${newName}` : "");

  if (typing) {
    return (
      <input
        className="weak-subject-input"
        type="text"
        value={draft.newSubject}
        placeholder="Какой предмет?"
        aria-label={`Предмет для темы «${draft.title}»`}
        maxLength={120}
        autoFocus={subjects.length > 0}
        onChange={(event) => onChange({ subjectId: "", newSubject: event.target.value })}
        onBlur={(event) => onChosen({ subjectId: "", newSubject: event.target.value })}
      />
    );
  }

  return (
    <select
      className="weak-subject"
      value={value}
      aria-label={`Предмет для темы «${draft.title}»`}
      onChange={(event) => {
        const next = event.target.value;
        if (next === OTHER) {
          onChange({ subjectId: "", newSubject: "" });
          setTyping(true);
        } else if (next.startsWith("new:")) {
          onChosen({ subjectId: "", newSubject: next.slice(4) });
        } else {
          onChosen({ subjectId: next, newSubject: "" });
        }
      }}
    >
      {value ? null : <option value="">Выбери предмет</option>}
      {subjects.map((subject) => (
        <option key={subject.id} value={subject.id}>
          {subject.name}
        </option>
      ))}
      {newName ? <option value={`new:${newName}`}>{newName}, новый предмет</option> : null}
      <option value={OTHER}>Другой предмет…</option>
    </select>
  );
}

export function WeakLearned({
  subjects,
  topics,
  onAdded,
  onAsk,
}: {
  subjects: WeakSubject[];
  topics: WeakTopic[];
  /** Темы и предметы уже загружены. */
  onAdded: (ids: string[]) => void;
  onAsk: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [placeholder, setPlaceholder] = useState(PLACEHOLDER);
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const savedTimer = useRef<number | undefined>(undefined);

  useSmoothInput(inputRef);

  // На телефоне длинная подсказка не помещается.
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 640px)");
    const apply = () => setPlaceholder(phone.matches ? PLACEHOLDER_SHORT : PLACEHOLDER);
    apply();
    phone.addEventListener("change", apply);
    return () => phone.removeEventListener("change", apply);
  }, []);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const close = useCallback(() => {
    window.clearTimeout(savedTimer.current);
    setPhase({ kind: "idle" });
  }, []);

  const take = useCallback(
    async (text: string) => {
      window.clearTimeout(savedTimer.current);
      const token = ++run.current;
      setValue("");
      setPhase({ kind: "thinking" });
      mascot.thinkStart(text, () => {
        run.current++;
        setPhase({ kind: "idle" });
        setValue(text);
      });
      mascot.thought("Разбираю, что ты изучил");
      const understood = await understand(text, "topics");
      if (token !== run.current) return;
      const drafts = understood.kind === "topics" ? buildDrafts(understood.topics, subjects, topics) : [];
      if (drafts.length) {
        mascot.thinkEnd("Нашёл темы");
        setPhase({ kind: "preview", drafts, text, saving: false, failed: null });
        return;
      }
      mascot.thinkEnd();
      // Вопрос или просьба об уже записанном: это дело помощника, и второго нажатия тут не надо.
      if (understood.kind === "question") {
        setPhase({ kind: "idle" });
        onAsk(text);
        return;
      }
      setPhase({
        kind: "other",
        understood: understood.kind === "topics" ? { kind: "question" } : understood,
        text,
      });
    },
    [subjects, topics, onAsk],
  );

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const text = value.trim();
      if (text) void take(text);
    },
    [value, take],
  );

  /** Разбор ошибся: человек лучше знает, что это тема. */
  const asTopic = useCallback(
    (text: string) => {
      const title = text[0].toUpperCase() + text.slice(1);
      setPhase({
        kind: "preview",
        drafts: buildDrafts([{ title, subject: "" }], subjects, topics),
        text,
        saving: false,
        failed: null,
      });
    },
    [subjects, topics],
  );

  const patchDraft = useCallback((key: string, patch: Partial<TopicDraft>) => {
    setPhase((current) =>
      current.kind === "preview"
        ? { ...current, drafts: current.drafts.map((row) => (row.key === key ? { ...row, ...patch } : row)) }
        : current,
    );
  }, []);

  /** Выбрал предмет для одной темы: остальным без предмета, скорее всего, тот же. */
  const chooseSubject = useCallback((key: string, patch: Pick<TopicDraft, "subjectId" | "newSubject">) => {
    setPhase((current) => {
      if (current.kind !== "preview") return current;
      const chosen = patch.subjectId || patch.newSubject.trim();
      return {
        ...current,
        drafts: current.drafts.map((row) =>
          row.key === key || (chosen && !row.duplicate && !draftHasSubject(row)) ? { ...row, ...patch } : row,
        ),
      };
    });
  }, []);

  const dropDraft = useCallback((key: string) => {
    setPhase((current) => {
      if (current.kind !== "preview") return current;
      const drafts = current.drafts.filter((row) => row.key !== key);
      return drafts.length ? { ...current, drafts } : { kind: "idle" };
    });
  }, []);

  const save = useCallback(
    async (drafts: TopicDraft[], text: string) => {
      const writing = drafts.filter((row) => !row.duplicate);
      setPhase({ kind: "preview", drafts, text, saving: true, failed: null });

      // Предметы берём свежие: иначе разбор мог успеть раньше их загрузки, и тот же
      // предмет создался бы второй раз. Одно название, один запрос, даже если тем несколько.
      let known: WeakSubject[];
      try {
        known = await fetchSubjects();
      } catch {
        setPhase({
          kind: "preview",
          drafts,
          text,
          saving: false,
          failed: "Не получилось записать. Попробуй ещё раз.",
        });
        return;
      }
      const createdSubjects: WeakSubject[] = [];
      const subjectIdOf = async (draft: TopicDraft): Promise<string> => {
        if (draft.subjectId) return draft.subjectId;
        // Здесь только точное совпадение: новый предмет человек видел и подтвердил.
        const existing = exactSubject(known, draft.newSubject);
        if (existing) return existing.id;
        const created = await createSubject(draft.newSubject.trim());
        known.push(created);
        createdSubjects.push(created);
        return created.id;
      };

      const created: WeakTopic[] = [];
      const left: TopicDraft[] = [];
      const now = new Date();
      for (const draft of writing) {
        try {
          const subjectId = await subjectIdOf(draft);
          created.push(await createTopic({ name: draft.title, subjectId, ...firstReviewFields(now) }));
        } catch {
          left.push(draft);
        }
      }

      if (createdSubjects.length) {
        subjectsChanged((list) => [...list, ...createdSubjects]);
      }
      if (created.length) {
        topicsChanged((list) => [...list, ...created]);
        onAdded(created.map((row) => row.id));
        mascot.hop(0.6);
      }

      if (left.length) {
        // Записалось не всё: незаписанное остаётся здесь, можно нажать ещё раз.
        setPhase({
          kind: "preview",
          drafts: left,
          text,
          saving: false,
          failed: created.length
            ? `Записал ${created.length} из ${writing.length}. Остальное не прошло, попробуй ещё раз.`
            : "Не получилось записать. Попробуй ещё раз.",
        });
        return;
      }

      setPhase({
        kind: "saved",
        topics: created,
        subjects: createdSubjects,
        skipped: drafts.length - writing.length,
        undoing: false,
      });
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(close, SAVED_MS);
    },
    [onAdded, close],
  );

  const undo = useCallback(
    async (saved: Extract<Phase, { kind: "saved" }>) => {
      window.clearTimeout(savedTimer.current);
      setPhase({ ...saved, undoing: true });
      const results = await Promise.allSettled(saved.topics.map((row) => deleteTopic(row.id)));
      const removed = new Set(
        saved.topics.filter((_, index) => results[index].status === "fulfilled").map((row) => row.id),
      );
      topicsChanged((list) => list.filter((row) => !removed.has(row.id)));

      // Предмет, созданный этой же записью, уходит вместе с ней, если в нём больше ничего нет.
      if (removed.size === saved.topics.length) {
        const emptied = saved.subjects.filter(
          (subject) => !topics.some((row) => row.subject === subject.id && !removed.has(row.id)),
        );
        await Promise.allSettled(emptied.map((subject) => deleteSubject(subject.id)));
        const gone = new Set(emptied.map((subject) => subject.id));
        subjectsChanged((list) => list.filter((subject) => !gone.has(subject.id)));
        setPhase({ kind: "idle" });
      } else {
        setPhase({
          ...saved,
          topics: saved.topics.filter((row) => !removed.has(row.id)),
          undoing: false,
        });
      }
    },
    [topics],
  );

  return (
    <>
      <form className="ai-line glass" onSubmit={submit}>
        <span className="ti-host">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            aria-label="Что сегодня изучил"
            autoComplete="off"
          />
        </span>
        <button className="send" type="submit" aria-label="Отправить" disabled={phase.kind === "thinking"}>
          <Icon name="arrow-up" />
        </button>
      </form>

      {phase.kind === "thinking" ? (
        <div className="ai-out card" role="status">
          <p className="q-status shine">Думаю…</p>
        </div>
      ) : null}

      {phase.kind === "preview" ? (
        <PreviewCard
          phase={phase}
          subjects={subjects}
          onPatch={patchDraft}
          onChoose={chooseSubject}
          onDrop={dropDraft}
          onSave={() => void save(phase.drafts, phase.text)}
          onCancel={() => {
            setPhase({ kind: "idle" });
            // Разбор не угадал: текст возвращается, чтобы написать иначе.
            setValue((current) => current || phase.text);
          }}
        />
      ) : null}

      {phase.kind === "other" ? (
        <div className="ai-out card">
          <p className="q-say">
            {phase.understood.kind === "habit"
              ? `Похоже на привычку: «${phase.understood.name}».`
              : phase.understood.kind === "goal"
                ? `Похоже на цель: «${phase.understood.title}».`
                : "Похоже на вопрос, а не на тему."}
          </p>
          <div className="q-acts">
            {phase.understood.kind === "habit" ? (
              <Link className="btn btn-main" href="/dashboard/habits">
                К привычкам
              </Link>
            ) : phase.understood.kind === "goal" ? (
              <Link className="btn btn-main" href="/dashboard/goals">
                К целям
              </Link>
            ) : (
              <button
                className="btn btn-main"
                type="button"
                onClick={() => {
                  onAsk(phase.text);
                  close();
                }}
              >
                Спросить тьютора
              </button>
            )}
            <button className="btn btn-text" type="button" onClick={() => asTopic(phase.text)}>
              Записать как тему
            </button>
            <button className="btn btn-text" type="button" onClick={close}>
              Не надо
            </button>
          </div>
        </div>
      ) : null}

      {phase.kind === "saved" ? (
        <div className="ai-out card" role="status">
          <p className="q-say">
            {phase.topics.length
              ? `Записал ${phase.topics.length} ${plural(phase.topics.length, "тему", "темы", "тем")}. Первое повторение завтра.`
              : "Эти темы уже есть в списке, записывать нечего."}
            {phase.topics.length && phase.skipped
              ? ` Ещё ${phase.skipped} уже ${plural(phase.skipped, "была", "были", "были")} в списке.`
              : ""}
          </p>
          <div className="q-acts">
            {phase.topics.length ? (
              <button className="btn btn-text" type="button" disabled={phase.undoing} onClick={() => void undo(phase)}>
                Вернуть как было
              </button>
            ) : null}
            <button className="btn btn-text" type="button" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PreviewCard({
  phase,
  subjects,
  onPatch,
  onChoose,
  onDrop,
  onSave,
  onCancel,
}: {
  phase: Extract<Phase, { kind: "preview" }>;
  subjects: WeakSubject[];
  onPatch: (key: string, patch: Partial<TopicDraft>) => void;
  onChoose: (key: string, patch: Pick<TopicDraft, "subjectId" | "newSubject">) => void;
  onDrop: (key: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const writing = phase.drafts.filter((row) => !row.duplicate);
  const missing = writing.some((row) => !draftHasSubject(row));
  return (
    <div className="ai-out card">
      <p className="q-say">
        {writing.length ? "Запишу в повторение, первое завтра:" : "Эти темы уже есть в списке:"}
      </p>
      <ul className="q-diff weak-diff">
        {phase.drafts.map((draft) => (
          <li key={draft.key}>
            <span className="nm">{draft.title}</span>
            {draft.duplicate ? (
              <span className="chg">уже в списке</span>
            ) : (
              <span className="chg">
                <SubjectPick
                  draft={draft}
                  subjects={subjects}
                  onChange={(patch) => onPatch(draft.key, patch)}
                  onChosen={(patch) => onChoose(draft.key, patch)}
                />
                {" → "}
                <b>завтра</b>
              </span>
            )}
            <button
              className="icon-btn"
              type="button"
              aria-label={`Убрать «${draft.title}»`}
              title="Убрать"
              disabled={phase.saving}
              onClick={() => onDrop(draft.key)}
            >
              <Icon name="x" />
            </button>
          </li>
        ))}
      </ul>
      {phase.failed ? <p className="small-note weak-out-note danger" role="alert">{phase.failed}</p> : null}
      {missing ? <p className="small-note weak-out-note">Выбери предмет, чтобы записать.</p> : null}
      <div className="q-acts">
        {writing.length ? (
          <button className="btn btn-main" type="button" disabled={phase.saving || missing} onClick={onSave}>
            {phase.saving ? "Записываю…" : "Добавить"}
          </button>
        ) : null}
        <button className="btn btn-text" type="button" disabled={phase.saving} onClick={onCancel}>
          {writing.length ? "Не надо" : "Закрыть"}
        </button>
      </div>
    </div>
  );
}
