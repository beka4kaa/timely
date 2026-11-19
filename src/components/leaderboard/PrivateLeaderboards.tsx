"use client"

// Мои группы: таблицы для друзей и класса. Видят их только участники, и каждый вступил сам,
// по коду от создателя. Добавить другого человека нельзя, поэтому поиска учеников здесь нет.

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { toast } from "sonner"

import { ConfirmingAction } from "@/components/curriculum/catalog-menu"
import { Icon } from "@/components/shell/icons"
import { initialsOf } from "@/components/shell/sidebar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  createPrivateBoard,
  deletePrivateBoard,
  joinPrivateBoard,
  leavePrivateBoard,
  listPrivateBoards,
  removeBoardMember,
  resetBoardCode,
  type LeaderboardUser,
  type PrivateBoard,
} from "@/lib/contest-api"
import { plural, t } from "@/lib/i18n"
import { countryName, grouped } from "@/lib/rating-view"

function members(count: number) {
  return plural(count, "{n} участник", "{n} участника", "{n} участников")
}

function errorText(error: unknown) {
  return error instanceof Error ? t(error.message) : t("попробуй ещё раз")
}

/* ─────────────── Новая группа и вступление: одно поле и кнопка ─────────────── */
function OneFieldDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  note,
  submitLabel,
  emptyError,
  onSubmit,
  onDone,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  title: string
  label: string
  placeholder: string
  note: string
  submitLabel: string
  emptyError: string
  onSubmit: (value: string) => Promise<PrivateBoard>
  onDone: (board: PrivateBoard) => void
}) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) setValue("")
  }, [open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) {
      toast.error(emptyError)
      return
    }
    setSaving(true)
    try {
      onDone(await onSubmit(value.trim()))
      onOpenChange(false)
    } catch (error) {
      toast.error(t("Не получилось: {error}", { error: errorText(error) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3">
            <Input
              aria-label={label}
              placeholder={placeholder}
              value={value}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="small-note">{note}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Отмена")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("Секунду…") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────── Код группы: его видит только создатель ─────────────── */
function InviteCode({ board, onChanged }: { board: PrivateBoard; onChanged: (board: PrivateBoard) => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(board.invite_code ?? "")
      toast.success(t("Код скопирован"))
    } catch {
      toast.error(t("Не скопировалось. Выдели код и скопируй сам."))
    }
  }

  return (
    <section className="rb-code card" aria-label={t("Код группы")}>
      <div>
        <p className="rb-code-v">{board.invite_code}</p>
        <p className="small-note">{t("Отправь код тем, кого зовёшь. Вступают только сами.")}</p>
      </div>
      <div className="rb-code-tools rb-do">
        <button className="btn btn-line" type="button" onClick={copy}>
          {t("Скопировать")}
        </button>
        <ConfirmingAction
          label={t("Новый код")}
          confirm={t("Старый перестанет работать")}
          onRun={async () => onChanged(await resetBoardCode(board.id))}
        />
      </div>
    </section>
  )
}

/* ─────────────── Таблица группы ─────────────── */
function BoardDetail({
  board,
  meId,
  onBack,
  onChanged,
  onGone,
}: {
  board: PrivateBoard
  meId: number | null
  onBack: () => void
  onChanged: (board: PrivateBoard) => void
  onGone: (id: number) => void
}) {
  const ranked = useMemo(
    () => [...board.members].sort((a, b) => b.overall_elo - a.overall_elo || a.id - b.id),
    [board.members],
  )
  const isOwner = board.owner === meId

  return (
    <div className="lb-main">
      <button className="back" type="button" onClick={onBack}>
        {t("Все группы")}
      </button>
      <div className="lb-head rb-group-head">
        <h2>{board.name}</h2>
        <span>{members(ranked.length)}</span>
      </div>
      {isOwner && board.invite_code ? <InviteCode board={board} onChanged={onChanged} /> : null}
      <ol>
        {ranked.map((user: LeaderboardUser, index) => {
          const mine = user.id === meId
          const cells = (
            <>
              <span className="n">{index + 1}</span>
              <span className="av" aria-hidden="true">
                {initialsOf(user.username)}
              </span>
              <span className="who">
                <b>{mine ? t("Ты") : user.username}</b>
                {countryName(user.country_code) ? <small>{countryName(user.country_code)}</small> : null}
              </span>
              <span className="m tr">{user.id === board.owner ? t("создатель") : ""}</span>
              <span className="p">{grouped(user.overall_elo)}</span>
            </>
          )
          return (
            <li key={user.id} className={isOwner && !mine ? "rb-member rb-do" : undefined}>
              {mine ? (
                <Link className="lr rb-row is-me glass" href="/dashboard/profile">
                  {cells}
                </Link>
              ) : (
                // Ссылки на профиль нет: участник мог не показывать себя в общем рейтинге.
                <div className="lr rb-row">{cells}</div>
              )}
              {isOwner && !mine ? (
                <ConfirmingAction
                  label={t("Убрать")}
                  confirm={t("Точно?")}
                  onRun={async () => onChanged(await removeBoardMember(board.id, user.id))}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
      <div className="rb-group-foot rb-do">
        {isOwner ? (
          <ConfirmingAction
            label={t("Удалить группу")}
            confirm={t("Точно удалить для всех?")}
            onRun={async () => {
              await deletePrivateBoard(board.id)
              onGone(board.id)
            }}
          />
        ) : (
          <ConfirmingAction
            label={t("Выйти из группы")}
            confirm={t("Точно выйти?")}
            onRun={async () => {
              await leavePrivateBoard(board.id)
              onGone(board.id)
            }}
          />
        )}
      </div>
    </div>
  )
}

/* ─────────────── Список групп ─────────────── */
export function PrivateLeaderboards({ meId }: { meId: number | null }) {
  const [boards, setBoards] = useState<PrivateBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    listPrivateBoards()
      .then(setBoards)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const put = (board: PrivateBoard) =>
    setBoards((rows) =>
      rows.some((row) => row.id === board.id)
        ? rows.map((row) => (row.id === board.id ? board : row))
        : [board, ...rows],
    )
  const open = (board: PrivateBoard) => {
    put(board)
    setActiveId(board.id)
  }

  const active = boards.find((board) => board.id === activeId) ?? null
  if (active) {
    return (
      <BoardDetail
        board={active}
        meId={meId}
        onBack={() => setActiveId(null)}
        onChanged={put}
        onGone={(id) => {
          setActiveId(null)
          setBoards((rows) => rows.filter((row) => row.id !== id))
        }}
      />
    )
  }

  return (
    <section aria-label={t("Мои группы")}>
      <div className="rb-groups-head">
        <h2 className="sec">{t("Мои группы")}</h2>
        <div className="rb-groups-tools">
          <button className="btn btn-text" type="button" onClick={() => setJoinOpen(true)}>
            {t("Вступить по коду")}
          </button>
          <button className="btn btn-line" type="button" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" />
            {t("Новая группа")}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="small-note" role="status">
          {t("Загружаю группы…")}
        </p>
      ) : failed ? (
        <section className="ct-note card" role="alert">
          <h2>{t("Группы не загрузились")}</h2>
          <p>{t("Проверь связь и попробуй ещё раз.")}</p>
          <button className="btn btn-line" type="button" onClick={load}>
            {t("Повторить")}
          </button>
        </section>
      ) : boards.length === 0 ? (
        <section className="ct-note card">
          <h2>{t("Групп пока нет")}</h2>
          <p>{t("Создай группу с друзьями или классом и соревнуйтесь только между собой. Если друг уже создал, попроси у него код.")}</p>
        </section>
      ) : (
        <ul className="rb-groups">
          {boards.map((board) => (
            <li key={board.id}>
              <button className="rb-group card" type="button" onClick={() => setActiveId(board.id)}>
                <b>{board.name}</b>
                <span className="rb-faces" aria-hidden="true">
                  {board.members.slice(0, 5).map((member) => (
                    <span key={member.id} className="av">
                      {initialsOf(member.username)}
                    </span>
                  ))}
                </span>
                <small>{members(board.members.length)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}

      <OneFieldDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("Новая группа")}
        label={t("Название группы")}
        placeholder={t("Например, 9 «Б»")}
        note={t("Участников позовёшь кодом: он появится в группе.")}
        submitLabel={t("Создать")}
        emptyError={t("Назови группу")}
        onSubmit={createPrivateBoard}
        onDone={open}
      />
      <OneFieldDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        title={t("Вступить в группу")}
        label={t("Код группы")}
        placeholder={t("Код от создателя группы")}
        note={t("Участники увидят твоё имя пользователя, страну и баллы. Выйти можно в любой момент.")}
        submitLabel={t("Вступить")}
        emptyError={t("Введи код")}
        onSubmit={joinPrivateBoard}
        onDone={open}
      />
    </section>
  )
}
