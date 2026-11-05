"use client"

// Мои группы: таблицы для друзей и класса. Видят их только участники.

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/shell/icons"
import { initialsOf } from "@/components/shell/sidebar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  addBoardMember,
  createPrivateBoard,
  listPrivateBoards,
  searchUsers,
  type LeaderboardUser,
  type PrivateBoard,
  type UserSearchResult,
} from "@/lib/contest-api"
import { ru } from "@/lib/contest-view"
import { countryName, grouped } from "@/lib/rating-view"

function members(count: number) {
  return `${count} ${ru(count, "участник", "участника", "участников")}`
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "попробуй ещё раз"
}

/* ─────────────── Новая группа ─────────────── */
function CreateBoardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  onCreated: (board: PrivateBoard) => void
}) {
  const [name, setName] = useState("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Map<number, UserSearchResult>>(new Map())
  const [saving, setSaving] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) {
      setName("")
      setQuery("")
      setResults([])
      setSelected(new Map())
    }
  }, [open])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounce.current = setTimeout(() => {
      searchUsers(query.trim())
        .then(setResults)
        .catch((error) => toast.error(`Поиск не удался: ${errorText(error)}`))
        .finally(() => setSearching(false))
    }, 280)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query])

  const toggle = (user: UserSearchResult) =>
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(user.id)) next.delete(user.id)
      else next.set(user.id, user)
      return next
    })

  const create = async () => {
    if (!name.trim()) {
      toast.error("Назови группу")
      return
    }
    setSaving(true)
    try {
      let board = await createPrivateBoard(name.trim())
      for (const user of Array.from(selected.values())) {
        board = await addBoardMember(board.id, { userId: user.id })
      }
      toast.success(`Группа «${board.name}» создана`)
      onCreated(board)
      onOpenChange(false)
    } catch (error) {
      toast.error(`Не получилось: ${errorText(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая группа</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <Input
            aria-label="Название группы"
            placeholder="Например, 9 «Б»"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          {selected.size > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selected.values()).map((user) => (
                <span key={user.id} className="q-chip">
                  <span>{user.username}</span>
                  <button type="button" aria-label={`Убрать ${user.username}`} onClick={() => toggle(user)}>
                    <Icon name="x" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <Input
            aria-label="Найти ученика"
            placeholder="Имя пользователя или номер"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="pg-found">
            {searching ? (
              <p className="small-note">Ищу…</p>
            ) : results.length === 0 ? (
              <p className="small-note">{query.trim() ? "Никого не нашлось" : "Начни вводить имя или номер"}</p>
            ) : (
              results.map((user) => {
                const on = selected.has(user.id)
                return (
                  <button
                    key={user.id}
                    type="button"
                    className="pg-pick"
                    aria-pressed={on}
                    onClick={() => toggle(user)}
                  >
                    <span className="av" aria-hidden="true">
                      {initialsOf(user.username)}
                    </span>
                    <span className="pg-pick-who">
                      <b>{user.username}</b>
                      <small>
                        № {user.id}, {grouped(user.overall_elo)} {ru(user.overall_elo, "балл", "балла", "баллов")}
                      </small>
                    </span>
                    {on ? <Icon name="check" /> : null}
                  </button>
                )
              })
            )}
          </div>
          <p className="small-note">Тебя добавим в группу сами. Найти можно тех, кто показывает себя в рейтинге.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving ? "Создаю…" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ─────────────── Таблица группы ─────────────── */
function BoardDetail({
  board,
  meId,
  onBack,
}: {
  board: PrivateBoard
  meId: number | null
  onBack: () => void
}) {
  const ranked = useMemo(
    () => [...board.members].sort((a, b) => b.overall_elo - a.overall_elo || a.id - b.id),
    [board.members],
  )

  return (
    <div className="lb-main">
      <button className="back" type="button" onClick={onBack}>
        Все группы
      </button>
      <div className="lb-head rb-group-head">
        <h2>{board.name}</h2>
        <span>{members(ranked.length)}</span>
      </div>
      <ol>
        {ranked.map((user: LeaderboardUser, index) => {
          const mine = user.id === meId
          return (
            <li key={user.id}>
              <Link
                className={mine ? "lr rb-row is-me glass" : "lr rb-row"}
                href={mine ? "/dashboard/profile" : `/dashboard/profile/${user.id}`}
              >
                <span className="n">{index + 1}</span>
                <span className="av" aria-hidden="true">
                  {initialsOf(user.username)}
                </span>
                <span className="who">
                  <b>{mine ? "Ты" : user.username}</b>
                  {countryName(user.country_code) ? <small>{countryName(user.country_code)}</small> : null}
                </span>
                <span className="m tr">{user.id === board.owner ? "создатель" : ""}</span>
                <span className="p">{grouped(user.overall_elo)}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* ─────────────── Список групп ─────────────── */
export function PrivateLeaderboards({ meId }: { meId: number | null }) {
  const [boards, setBoards] = useState<PrivateBoard[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
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

  const active = boards.find((board) => board.id === activeId) ?? null
  if (active) return <BoardDetail board={active} meId={meId} onBack={() => setActiveId(null)} />

  return (
    <section aria-label="Мои группы">
      <div className="rb-groups-head">
        <h2 className="sec">Мои группы</h2>
        <button className="btn btn-line" type="button" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" />
          Новая группа
        </button>
      </div>

      {loading ? (
        <p className="small-note" role="status">
          Загружаю группы…
        </p>
      ) : failed ? (
        <section className="ct-note card" role="alert">
          <h2>Группы не загрузились</h2>
          <p>Проверь связь и попробуй ещё раз.</p>
          <button className="btn btn-line" type="button" onClick={load}>
            Повторить
          </button>
        </section>
      ) : boards.length === 0 ? (
        <section className="ct-note card">
          <h2>Групп пока нет</h2>
          <p>Создай группу с друзьями или классом и соревнуйтесь только между собой.</p>
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

      <CreateBoardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(board) => {
          load()
          setActiveId(board.id)
        }}
      />
    </section>
  )
}
