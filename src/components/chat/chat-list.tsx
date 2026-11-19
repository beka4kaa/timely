"use client";

// Список разговоров группами: сначала общие, дальше по предметам. Новый чат начинается
// кнопкой с ручкой над перепиской, а не отсюда.
//
// Рисуется дважды: порталом в левую панель и в нижнем листе на телефоне, где панели нет.
// Переименование и удаление тихие: на широком экране значки появляются у строки при
// наведении, на телефоне за кнопкой «ещё», потому что наводить там нечем.

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { buildChatFolders, type FolderSubject } from "@/lib/chat-folders";
import type { SubjectChatSummary } from "@/lib/curriculum-api";

import { chatTitle } from "./chat-title";


export function ChatList({
  chats,
  subjects,
  activeId,
  loading,
  failed,
  onRetry,
  onOpen,
  onRename,
  onDelete,
}: {
  chats: SubjectChatSummary[];
  subjects: FolderSubject[];
  activeId: string | null;
  /** Пока не приехали предметы, групп не построить: всё свалилось бы в «Общие». */
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [askingId, setAskingId] = useState<string | null>(null);

  const folders = buildChatFolders(chats, subjects);

  return (
    <>
      {failed ? (
        <p className="chat-hint">
          {t("Чаты не загрузились.")}{" "}
          <button className="link" type="button" onClick={onRetry}>
            {t("Ещё раз")}
          </button>
        </p>
      ) : !folders.length && !loading ? (
        <p className="chat-hint">{t("Здесь появятся твои разговоры.")}</p>
      ) : null}

      {!failed && !loading
        ? folders.map((folder) => (
            <div className="nav-group" key={folder.goalId ?? "none"}>
              <div className="nav-label">{t(folder.title)}</div>
              {folder.chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  editing={editingId === chat.id}
                  revealed={revealedId === chat.id}
                  asking={askingId === chat.id}
                  onOpen={() => onOpen(chat.id)}
                  onReveal={() =>
                    setRevealedId((current) => (current === chat.id ? null : chat.id))
                  }
                  onEdit={() => {
                    setRevealedId(null);
                    setEditingId(chat.id);
                  }}
                  onEditEnd={(title) => {
                    setEditingId(null);
                    if (title !== null) onRename(chat.id, title);
                  }}
                  onAsk={() => {
                    setRevealedId(null);
                    setAskingId(chat.id);
                  }}
                  onAskEnd={(confirmed) => {
                    setAskingId(null);
                    if (confirmed) onDelete(chat.id);
                  }}
                />
              ))}
            </div>
          ))
        : null}
    </>
  );
}

function ChatRow({
  chat,
  active,
  editing,
  revealed,
  asking,
  onOpen,
  onReveal,
  onEdit,
  onEditEnd,
  onAsk,
  onAskEnd,
}: {
  chat: SubjectChatSummary;
  active: boolean;
  editing: boolean;
  revealed: boolean;
  asking: boolean;
  onOpen: () => void;
  onReveal: () => void;
  onEdit: () => void;
  /** Новое имя или `null`, если ученик передумал. */
  onEditEnd: (title: string | null) => void;
  onAsk: () => void;
  onAskEnd: (confirmed: boolean) => void;
}) {
  const title = chatTitle(chat.title);
  const noRef = useRef<HTMLButtonElement>(null);

  // Разговор не восстановить, поэтому удаление в два шага, и фокус на безопасном ответе.
  useEffect(() => {
    if (asking) noRef.current?.focus({ preventScroll: true });
  }, [asking]);

  if (editing) return <RenameField title={chat.title} onEnd={onEditEnd} />;

  if (asking) {
    return (
      <div
        className="chat-row chat-asking"
        onKeyDown={(event) => {
          if (event.key === "Escape") onAskEnd(false);
        }}
      >
        <span className="chat-ask">{t("Удалить чат?")}</span>
        <button className="chat-answer" type="button" onClick={() => onAskEnd(true)}>
          {t("Да")}
        </button>
        <button className="chat-answer" type="button" ref={noRef} onClick={() => onAskEnd(false)}>
          {t("Нет")}
        </button>
      </div>
    );
  }

  return (
    <div className="chat-row" data-revealed={revealed || undefined}>
      <a
        className="chat-link"
        href={`/dashboard/chat?chat=${chat.id}`}
        aria-current={active ? "true" : undefined}
        title={title}
        onClick={(event) => {
          // Новая вкладка и средняя кнопка работают как у обычной ссылки: адрес открывает
          // этот же разговор.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onOpen();
        }}
      >
        {title}
      </a>
      <span className="chat-tools">
        <button
          className="chat-tool chat-tool-edit"
          type="button"
          aria-label={t("Переименовать чат «{title}»", { title })}
          title={t("Переименовать")}
          onClick={onEdit}
        >
          <Icon name="pencil" />
        </button>
        <button
          className="chat-tool chat-tool-edit"
          type="button"
          aria-label={t("Удалить чат «{title}»", { title })}
          title={t("Удалить")}
          onClick={onAsk}
        >
          <Icon name="x" />
        </button>
        <button
          className="chat-tool chat-tool-more"
          type="button"
          aria-label={t("Действия с чатом «{title}»", { title })}
          aria-expanded={revealed}
          onClick={onReveal}
        >
          <Icon name="more" />
        </button>
      </span>
    </div>
  );
}

function RenameField({
  title,
  onEnd,
}: {
  title: string;
  onEnd: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(title);
  const fieldRef = useRef<HTMLInputElement>(null);
  // Escape убирает поле, и оно теряет фокус. Без этой пометки уход фокуса сохранил бы то,
  // от чего ученик только что отказался.
  const finished = useRef(false);

  useEffect(() => {
    fieldRef.current?.select();
  }, []);

  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onEnd(value?.trim() ? value : null);
  };

  return (
    <div className="chat-row">
      <input
        ref={fieldRef}
        className="chat-rename"
        value={draft}
        maxLength={200}
        aria-label={t("Название чата")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(draft);
          }
          if (event.key === "Escape") finish(null);
        }}
      />
    </div>
  );
}
