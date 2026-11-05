"use client";

// Короткое сообщение внизу, как в прототипе, с кнопкой «Вернуть», если есть что вернуть.

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface WeakNote {
  text: string;
  action?: { label: string; run: () => void };
  /** Что-то не получилось: читается сразу, а не в свою очередь. */
  failed?: boolean;
}

export type WeakNotify = (note: WeakNote) => void;

const NOTE_MS = 6000;

export function useWeakNote() {
  const [note, setNote] = useState<WeakNote | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setNote(null);
  }, []);

  const notify = useCallback<WeakNotify>((next) => {
    window.clearTimeout(timer.current);
    setNote(next);
    timer.current = window.setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { note, notify, dismiss };
}

export function WeakNoteView({ note, onClose }: { note: WeakNote | null; onClose: () => void }) {
  if (!note) return null;
  return (
    <div
      className={cn("t-toast weak-note", note.action && "has-action", note.failed && "failed")}
      role={note.failed ? "alert" : "status"}
    >
      <span>{note.text}</span>
      {note.action ? (
        <button
          className="btn btn-line"
          type="button"
          onClick={() => {
            note.action?.run();
            onClose();
          }}
        >
          {note.action.label}
        </button>
      ) : null}
    </div>
  );
}
