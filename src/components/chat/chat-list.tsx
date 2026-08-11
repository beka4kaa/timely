"use client";

// История разговоров: все чаты всех предметов одной лентой по дням.
//
// В панели чаты разложены по предметам, потому что предмет там выбран сверху и
// служит папкой. На странице папок нет: ученик помнит не «в каком предмете я
// это спрашивал», а «это было вчера». Поэтому здесь группы по дню, а предмет
// виден в поле ввода.
//
// Переименование появляется впервые: `updateChat(id, {title})` на бэкенде готов
// давно, кнопки не было нигде — название придумывала модель и изменить его было
// нельзя.

import { useEffect, useRef, useState } from "react";
import { Check, PanelLeftClose, Pencil, Plus, Trash2, X } from "lucide-react";

import { groupChatsByDay } from "@/lib/chat-groups";
import type { SubjectChatSummary } from "@/lib/curriculum-api";

export function ChatList({
  chats,
  activeId,
  loading,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onCollapse,
}: {
  chats: SubjectChatSummary[];
  activeId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape убирает поле, и оно теряет фокус. Без этой пометки уход фокуса
  // сохранил бы то, от чего ученик только что отказался.
  const cancelled = useRef(false);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  const groups = groupChatsByDay(chats);

  const commit = () => {
    if (editingId && draft.trim()) onRename(editingId, draft);
    setEditingId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fbfaf7] text-[#37322c]">
      <div className="flex h-[46px] shrink-0 items-center gap-1 border-b border-[#dedbd4] px-2.5">
        <button
          type="button"
          onClick={onCreate}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[#e0dcd4] bg-[#f4f1ea] px-2.5 py-1 text-[12px] font-medium text-[#6d665d] outline-none transition-colors hover:border-[#c5a474] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          Новый чат
        </button>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Свернуть историю"
          title="Свернуть историю"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {loading && !chats.length && (
          <p className="px-2 py-3 text-[12px] text-[#a09890]">Загружаю…</p>
        )}
        {!loading && !chats.length && (
          <p className="px-2 py-3 text-[12px] leading-[1.5] text-[#a09890]">
            Разговоров пока нет. Спросите что-нибудь — он появится здесь.
          </p>
        )}

        {groups.map((group) => (
          <div key={group.key} className="mb-2">
            <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a09890]">
              {group.label}
            </div>

            {group.rows.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-center gap-0.5 rounded-[8px] pr-1 transition-colors ${
                  chat.id === activeId ? "bg-[#f1ede6]" : "hover:bg-[#f4f1ea]"
                }`}
              >
                {editingId === chat.id ? (
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                      if (cancelled.current) {
                        cancelled.current = false;
                        return;
                      }
                      commit();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                      }
                      if (event.key === "Escape") {
                        cancelled.current = true;
                        setEditingId(null);
                      }
                    }}
                    maxLength={200}
                    className="min-w-0 flex-1 rounded-[6px] border border-[#c9a16c] bg-white px-2 py-1 text-[12.5px] text-[#37322c] outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(chat.id)}
                    className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                      chat.id === activeId
                        ? "font-medium text-[#37322c]"
                        : "text-[#4a433b] hover:text-[#37322c]"
                    }`}
                  >
                    {chat.title || "Новый чат"}
                  </button>
                )}

                {confirmDeleteId === chat.id ? (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(chat.id);
                        setConfirmDeleteId(null);
                      }}
                      aria-label="Подтвердить удаление"
                      title="Удалить"
                      className="grid h-6 w-6 place-items-center rounded-full text-[#b0473e] transition-colors hover:bg-[#f6e4e1]"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      aria-label="Отменить удаление"
                      className="grid h-6 w-6 place-items-center rounded-full text-[#8f887f] transition-colors hover:bg-[#efece5]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : (
                  editingId !== chat.id && (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(chat.title || "");
                          setEditingId(chat.id);
                        }}
                        aria-label="Переименовать чат"
                        title="Переименовать"
                        className="grid h-6 w-6 place-items-center rounded-full text-[#c2bcb2] transition-colors hover:bg-[#efece5] hover:text-[#8f887f]"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(chat.id)}
                        aria-label="Удалить чат"
                        title="Удалить чат"
                        // Удаление в два шага, как в дереве чатов панели:
                        // разговор восстановить нельзя.
                        className="grid h-6 w-6 place-items-center rounded-full text-[#c2bcb2] transition-colors hover:bg-[#efece5] hover:text-[#8f887f]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  )
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
