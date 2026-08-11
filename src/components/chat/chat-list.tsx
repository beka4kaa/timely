"use client";

// История разговоров: папки предметов, внутри — чаты.
//
// Раньше здесь была лента по дням. Для одного предмета это работало, для пяти
// нет: «вчера» не отвечает на вопрос «это была физика или алгебра», и разговоры
// перемешивались. Предмет — естественная папка: своя книга, свои цитаты, свой
// контекст ответа.
//
// Вид взят у дерева чатов в панели (`tutor-rail/chat-tree.tsx`): тот же шеврон,
// тот же отступ за линейку полей `#dcd5c8`, тот же размер строки. Иконок папок
// нет — отступ и линейка справляются сами. Скопирован ВИД, а не код: там
// компактный выбор внутри всплывающего окна на один предмет, здесь навигация во
// всю высоту с переименованием, удалением и созданием внутри папки. Общего у
// них — две строки разметки, а расходятся требования почти во всём.
//
// Переименование появилось здесь впервые: `updateChat(id, {title})` на бэкенде
// готов давно, кнопки не было нигде.

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { buildChatFolders, type FolderSubject } from "@/lib/chat-folders";
import type { SubjectChatSummary } from "@/lib/curriculum-api";

export function ChatList({
  chats,
  subjects,
  activeId,
  activeGoalId,
  loading,
  onOpen,
  onCreate,
  onCreateIn,
  onRename,
  onDelete,
  onCollapse,
}: {
  chats: SubjectChatSummary[];
  subjects: FolderSubject[];
  activeId: string | null;
  /** Предмет открытого разговора: его папка раскрывается сама. */
  activeGoalId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  /** Новый разговор внутри папки: заодно переключает книгу. */
  onCreateIn: (goalId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape убирает поле, и оно теряет фокус. Без этой пометки уход фокуса
  // сохранил бы то, от чего ученик только что отказался.
  const cancelled = useRef(false);

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  // Разговор открылся или сменилась книга — его папка раскрывается. Именно
  // событием, а не правилом «активную всегда держать открытой»: иначе шеврон
  // текущей папки перестал бы работать.
  useEffect(() => {
    setClosed((prev) => {
      const key = activeGoalId ?? "none";
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, [activeGoalId, activeId]);

  const folders = buildChatFolders(chats, subjects);

  // Раскрыто по умолчанию: закрывать всё при первом заходе значило бы прятать
  // единственное содержимое колонки. Хранится, наоборот, множество ЗАКРЫТЫХ —
  // так новая папка появляется открытой, а не потерянной.
  const isOpen = (key: string) => !closed.has(key);
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const commit = () => {
    if (editingId && draft.trim()) onRename(editingId, draft);
    setEditingId(null);
  };

  const startRename = (chat: SubjectChatSummary) => {
    setDraft(chat.title || "");
    setEditingId(chat.id);
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
        {loading && !folders.length && (
          <p className="px-2 py-3 text-[12px] text-[#a09890]">Загружаю…</p>
        )}
        {!loading && !folders.length && (
          <p className="px-2 py-3 text-[12px] leading-[1.5] text-[#a09890]">
            Предметов пока нет. Загрузите книгу в разделе «Предметы» — или
            спросите без книги, разговор появится здесь.
          </p>
        )}

        {folders.map((folder) => {
          const key = folder.goalId ?? "none";
          const open = isOpen(key);

          return (
            <div key={key} className="mb-0.5">
              {/* ── Папка ──────────────────────────────────────────────── */}
              <div className="group/folder flex items-center gap-0.5 rounded-[8px] pr-1 transition-colors hover:bg-[#f4f1ea]">
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1.5 text-left outline-none"
                >
                  {open ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-[#a09890]" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-[#a09890]" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-serif text-[12.5px] font-semibold text-[#37322c]">
                    {folder.title}
                  </span>
                  {/* Число разговоров, а не число книг: в списке чатов важно,
                      сколько их. «Без книг» сказано в выборе книги. */}
                  {!!folder.chats.length && (
                    <span className="shrink-0 text-[10px] tabular-nums text-[#a09890]">
                      {folder.chats.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onCreateIn(folder.goalId)}
                  aria-label={`Новый чат: ${folder.title}`}
                  title="Новый чат по этому предмету"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[#c2bcb2] opacity-0 outline-none transition-colors hover:bg-[#efede8] hover:text-[#8f887f] focus-visible:opacity-100 group-hover/folder:opacity-100"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              {/* ── Разговоры внутри ───────────────────────────────────── */}
              {open && (
                <div className="ml-[13px] border-l border-[#dcd5c8] pl-1.5">
                  {!folder.chats.length && (
                    <div className="px-2 py-1.5 text-[11px] text-[#a09890]">
                      Здесь пока пусто
                    </div>
                  )}

                  {folder.chats.map((chat) => (
                    <div
                      key={chat.id}
                      className={`group flex items-center gap-0.5 rounded-[8px] pr-1 transition-colors ${
                        chat.id === activeId
                          ? "bg-[#f1ede6]"
                          : "hover:bg-[#f4f1ea]"
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
                              onClick={() => startRename(chat)}
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
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
