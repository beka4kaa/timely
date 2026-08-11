"use client";

// Дерево чатов: предмет — корешок книги, разговоры — записи под ним.
//
// Обычное файловое дерево с иконками папок в панель шириной в четверть экрана
// и не помещается, и звучит чужеродно: приложение говорит на языке книги —
// страница, знак §, поля. Поэтому предмет здесь корешок, а чаты сдвинуты за
// тонкую линейку полей — ту же `#dcd5c8`, что линейка в `ThinkingNote`. Иконок
// папок нет: отступ и линейка справляются сами.

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";

import type { SubjectChatSummary } from "@/lib/curriculum-api";

export interface TreeSubject {
  goalId: string;
  title: string;
  books: number;
}

// Больше восьми чатов прячутся за «Показать ещё»: в узкой панели длинный
// список читается хуже короткого с продолжением.
const VISIBLE_CHATS = 8;

export function ChatTree({
  subjects,
  chats,
  selectedGoalId,
  selectedChatId,
  onSelectChat,
  onSelectSubject,
  onCreate,
  onDelete,
}: {
  subjects: TreeSubject[];
  /** Чаты текущего предмета. У остальных известно только их число. */
  chats: SubjectChatSummary[];
  selectedGoalId: string | null;
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onSelectSubject: (goalId: string) => void;
  onCreate: () => void;
  onDelete: (chatId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const visible = expanded ? chats : chats.slice(0, VISIBLE_CHATS);

  return (
    <div className="text-[#49423a]">
      <div className="border-b border-[#e4e0d8] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
        Чаты
      </div>

      <div className="max-h-80 overflow-y-auto py-1">
        {!subjects.length && (
          <div className="px-3 py-4 text-[12px] text-[#8f887f]">
            Предметов пока нет
          </div>
        )}

        {subjects.map((subject) => {
          const open = subject.goalId === selectedGoalId;
          return (
            <div key={subject.goalId}>
              <button
                type="button"
                onClick={() => onSelectSubject(subject.goalId)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left transition-colors hover:bg-[#f1ede6]"
              >
                {open ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-[#a09890]" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-[#a09890]" />
                )}
                <span className="min-w-0 flex-1 truncate font-serif text-[12.5px] font-semibold text-[#37322c]">
                  {subject.title}
                </span>
                {!open && (
                  <span className="shrink-0 text-[10px] tabular-nums text-[#a09890]">
                    {subject.books ? "" : "без книг"}
                  </span>
                )}
              </button>

              {open && (
                <div className="ml-[18px] border-l border-[#dcd5c8] pl-1.5">
                  {!chats.length && (
                    <div className="px-2 py-1.5 text-[11px] text-[#a09890]">
                      Здесь пока пусто
                    </div>
                  )}
                  {visible.map((chat) => (
                    <div
                      key={chat.id}
                      className={`group flex items-center gap-1 rounded-[6px] pr-1 ${
                        chat.id === selectedChatId ? "bg-[#f4f0e9]" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectChat(chat.id)}
                        className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12px] text-[#4a433b] transition-colors hover:text-[#37322c]"
                      >
                        {chat.title || "Новый чат"}
                      </button>

                      {chat.id === selectedChatId && (
                        <Check className="h-3 w-3 shrink-0 text-[#8a7a5e]" />
                      )}

                      {confirmDeleteId === chat.id ? (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              onDelete(chat.id);
                              setConfirmDeleteId(null);
                            }}
                            aria-label="Удалить чат"
                            title="Удалить"
                            className="grid h-5 w-5 place-items-center rounded-full text-[#b0473e] transition-colors hover:bg-[#f6e4e1]"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            aria-label="Отменить удаление"
                            className="grid h-5 w-5 place-items-center rounded-full text-[#8f887f] transition-colors hover:bg-[#efece5]"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(chat.id)}
                          aria-label="Удалить чат"
                          title="Удалить чат"
                          // Удаление в два шага, как в истории чатов доски:
                          // разговор восстановить нельзя.
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#c2bcb2] opacity-0 transition-colors hover:bg-[#efece5] hover:text-[#8f887f] focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}

                  {chats.length > VISIBLE_CHATS && !expanded && (
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="px-2 py-1.5 text-[11px] text-[#a09890] transition-colors hover:text-[#61574c]"
                    >
                      Показать ещё {chats.length - VISIBLE_CHATS}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCreate}
        disabled={!selectedGoalId}
        className="flex w-full items-center gap-1.5 border-t border-[#e4e0d8] px-3 py-2 text-left text-[12px] text-[#6d665d] transition-colors hover:bg-[#f1ede6] hover:text-[#37322c] disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Новый чат
      </button>
    </div>
  );
}
